'use strict';

/**
 * FN-1102: Claude Vision parts-invoice extraction handler.
 *
 * Accepts a vendor parts-invoice as either an image (jpeg/png/webp/gif) or a
 * PDF (base64) and uses Claude Sonnet 4 vision to extract:
 *   - vendor + invoiceNumber (with per-field confidence)
 *   - lineItems[] with sku/description/qty/unitCost/manufacturer
 *     (each with per-field confidence)
 *
 * Returns 422 AI_INVOICE_UNREADABLE when the AI cannot find vendor or line
 * items, so the caller can show a friendly retry prompt instead of a generic
 * 500.
 *
 * Pattern note: client is dep-injected (deps.anthropic) for testability;
 * production code path falls back to a lazy-init Anthropic SDK client.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const SUPPORTED_PDF_TYPE = 'application/pdf';

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

function buildPartsInvoicePrompt() {
  return `You are a parts-invoice data extraction specialist for a fleet maintenance system called FleetNeuron.

You will be given an image or PDF of a vendor parts invoice (NAPA, O'Reilly, Carquest, RushTruckCenters, etc.).

## Your Task

Extract the vendor identity and EVERY line item, returning a JSON object with the schema below.

### Output JSON Schema

{
  "vendor": "<vendor / supplier name as it appears on the invoice>",
  "invoiceNumber": "<invoice or order number, or empty string>",
  "confidence": {
    "vendor": <0.0 to 1.0>,
    "invoiceNumber": <0.0 to 1.0>
  },
  "lineItems": [
    {
      "sku": "<part number / SKU as printed, or empty string if not visible>",
      "description": "<part description>",
      "qty": <number>,
      "unitCost": <number>,
      "manufacturer": "<brand / manufacturer if listed, or empty string>",
      "category": "<one of: Brakes | Filters | Electrical | Fluids | Engine | Tires | Body | Other, or null>",
      "confidence": {
        "sku": <0.0 to 1.0>,
        "description": <0.0 to 1.0>,
        "qty": <0.0 to 1.0>,
        "unitCost": <0.0 to 1.0>,
        "manufacturer": <0.0 to 1.0>,
        "category": <0.0 to 1.0>
      }
    }
  ],
  "warnings": ["<any extraction uncertainties>"]
}

## Rules

1. Extract EVERY parts line item as a separate entry. Skip non-part lines (subtotal, tax, shipping, total, core charge unless attached to a SKU).
2. qty and unitCost MUST be numbers (not strings). Strip $ and commas. If qty is missing assume 1; if unitCost is missing use 0 and set confidence.unitCost = 0.
3. Confidence scores are 0.0 to 1.0. Use < 0.7 when the field is blurry, ambiguous, hand-written, partially obscured, or inferred rather than read.
4. If a field is genuinely not present on the invoice (e.g. no manufacturer column), return "" for strings or 0 for numbers AND set the corresponding confidence to 0.
5. Vendor should be the supplier (who issued the invoice), not the customer / "bill to" / "ship to".
6. If the invoice is unreadable (blank, blurry beyond use, wrong document type, or contains no parts) return vendor = "" and lineItems = [], and explain in warnings.
7. Return ONLY valid JSON. No markdown fences, no explanatory text.

## Category classification

For each line item, infer a single best-guess category for downstream catalog filtering. Choose ONE label from this fixed vocabulary:

- "Brakes" — pads, rotors, calipers, drums, brake fluid lines, ABS sensors.
- "Filters" — oil, air, fuel, cabin, hydraulic, transmission filters.
- "Electrical" — batteries, alternators, starters, sensors, wiring, lights, fuses.
- "Fluids" — oil, coolant, transmission fluid, DEF, washer fluid, grease.
- "Engine" — engine internals, gaskets, belts, hoses, pulleys, water pumps, turbos.
- "Tires" — tires, tubes, valve stems, tire chains.
- "Body" — bumpers, mirrors, door handles, body panels, fenders, glass.
- "Other" — anything that does not clearly belong to the categories above.

Set category = null ONLY when the line is genuinely too ambiguous (blank description, unreadable text). Set confidence.category < 0.7 when the choice is a guess from a partial description; ≥ 0.85 when the description plainly fits a category (e.g. "BRAKE PAD SET" → Brakes).`;
}

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

function clampConfidence(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function toNumber(v, fallback = 0) {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const parsed = parseFloat(v.replace(/[$,]/g, ''));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function normalizeCategory(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeLineItem(raw) {
  const c = raw && typeof raw.confidence === 'object' && raw.confidence !== null ? raw.confidence : {};
  return {
    sku: typeof raw?.sku === 'string' ? raw.sku.trim() : '',
    description: typeof raw?.description === 'string' ? raw.description.trim() : '',
    qty: toNumber(raw?.qty, 1),
    unitCost: toNumber(raw?.unitCost, 0),
    manufacturer: typeof raw?.manufacturer === 'string' ? raw.manufacturer.trim() : '',
    category: normalizeCategory(raw?.category),
    confidence: {
      sku: clampConfidence(c.sku),
      description: clampConfidence(c.description),
      qty: clampConfidence(c.qty),
      unitCost: clampConfidence(c.unitCost),
      manufacturer: clampConfidence(c.manufacturer),
      category: clampConfidence(c.category),
    },
  };
}

function validateExtractionResult(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('AI returned invalid response structure');
  }
  const c = raw.confidence && typeof raw.confidence === 'object' ? raw.confidence : {};
  const lineItems = Array.isArray(raw.lineItems) ? raw.lineItems.map(normalizeLineItem) : [];
  return {
    vendor: typeof raw.vendor === 'string' ? raw.vendor.trim() : '',
    invoiceNumber: typeof raw.invoiceNumber === 'string' ? raw.invoiceNumber.trim() : '',
    confidence: {
      vendor: clampConfidence(c.vendor),
      invoiceNumber: clampConfidence(c.invoiceNumber),
    },
    lineItems,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((w) => typeof w === 'string') : [],
  };
}

function isUnreadable(result) {
  return !result.vendor && result.lineItems.length === 0;
}

function buildContentBlocks({ imageBase64, pdfBase64, resolvedMediaType, prompt }) {
  if (resolvedMediaType === SUPPORTED_PDF_TYPE) {
    return [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: SUPPORTED_PDF_TYPE,
          data: pdfBase64,
        },
      },
      { type: 'text', text: prompt },
    ];
  }
  return [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: resolvedMediaType,
        data: imageBase64,
      },
    },
    { type: 'text', text: prompt },
  ];
}

async function handlePartsInvoiceVision(req, res, deps = {}) {
  const startedAt = Date.now();
  const route = '/parts/invoice-vision';
  try {
    const client = deps.anthropic || getAnthropicClient();
    const { imageBase64, pdfBase64, mimeType, mediaType } = req.body || {};
    const incomingType = mimeType || mediaType;

    if (!imageBase64 && !pdfBase64) {
      return res.status(400).json({
        success: false,
        error: 'imageBase64 or pdfBase64 is required',
        code: 'AI_BAD_REQUEST',
      });
    }

    let resolvedMediaType;
    if (pdfBase64) {
      resolvedMediaType = SUPPORTED_PDF_TYPE;
    } else {
      resolvedMediaType = incomingType || 'image/jpeg';
      if (!SUPPORTED_IMAGE_TYPES.includes(resolvedMediaType)) {
        return res.status(400).json({
          success: false,
          error: `Unsupported media type: ${resolvedMediaType}. Supported: ${SUPPORTED_IMAGE_TYPES.join(', ')}, ${SUPPORTED_PDF_TYPE}`,
          code: 'AI_BAD_REQUEST',
        });
      }
    }

    const prompt = buildPartsInvoicePrompt();
    const model = process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-20250514';

    const message = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: buildContentBlocks({ imageBase64, pdfBase64, resolvedMediaType, prompt }),
        },
      ],
      system: 'You are a precise parts-invoice data extraction assistant. Return ONLY valid JSON.',
      temperature: 0.1,
    });

    const processingTimeMs = Date.now() - startedAt;
    const aiContent = message?.content?.[0]?.text || '{}';

    let result;
    try {
      result = validateExtractionResult(parseAiResponse(aiContent));
    } catch (parseErr) {
      console.error('[ai-service] parts invoice vision parse error', parseErr.message);
      logAiInteraction({
        userId: null,
        route,
        message: `Parts invoice extraction parse failed`,
        conversationId: null,
        success: false,
        errorCode: 'AI_PARSE_ERROR',
        processingTimeMs,
      });
      return res.status(502).json({
        success: false,
        error: 'AI returned unparseable response',
        code: 'AI_PARSE_ERROR',
      });
    }

    if (isUnreadable(result)) {
      logAiInteraction({
        userId: null,
        route,
        message: `Parts invoice unreadable`,
        conversationId: null,
        success: false,
        errorCode: 'AI_INVOICE_UNREADABLE',
        processingTimeMs,
      });
      return res.status(422).json({
        success: false,
        error: 'Could not extract vendor or line items from invoice',
        code: 'AI_INVOICE_UNREADABLE',
        warnings: result.warnings,
      });
    }

    logAiInteraction({
      userId: null,
      route,
      message: `Parts invoice extraction: ${result.lineItems.length} line items`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs,
    });

    return res.json({
      success: true,
      data: result,
      processingTimeMs,
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    console.error('[ai-service] parts invoice vision error', err.message || err);

    logAiInteraction({
      userId: null,
      route,
      message: `Parts invoice vision failed: ${err.message || 'Unknown error'}`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_ERROR',
      processingTimeMs,
    });

    return res.status(502).json({
      success: false,
      error: 'AI parts invoice extraction failed',
      code: 'AI_VISION_ERROR',
      details: err.message || 'Unknown error',
    });
  }
}

module.exports = {
  handlePartsInvoiceVision,
  validateExtractionResult,
  parseAiResponse,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_PDF_TYPE,
};
