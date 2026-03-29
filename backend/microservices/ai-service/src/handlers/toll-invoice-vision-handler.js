'use strict';

/**
 * FN-440 / FN-458: Claude Vision toll invoice extraction handler.
 * Uses the native Anthropic SDK for image/vision support.
 * Accepts a toll invoice image (base64) and uses Claude Vision API
 * to extract structured toll transaction data.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Lazy-init Anthropic client (uses ANTHROPIC_API_KEY env var by default)
let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

function buildTollVisionPrompt() {
  return `You are a toll invoice data extraction specialist for a fleet management system called FleetNeuron.

You will be given an image of a toll invoice, toll bill, or "Pay by Mail" notice.

## Your Task

Extract ALL toll transaction data from the image and return a JSON object with the following structure:

### Output JSON Schema

{
  "invoiceMeta": {
    "invoiceNumber": "<string or null>",
    "invoiceDate": "<YYYY-MM-DD or null>",
    "dueDate": "<YYYY-MM-DD or null>",
    "providerName": "<toll authority name, e.g. 'E-ZPass', 'SunPass', 'Illinois Tollway'>",
    "licensePlate": "<plate number found on invoice or null>",
    "vehicleDescription": "<vehicle make/model if visible, or null>",
    "totalAmount": <number or null>,
    "lateFees": <number or 0>,
    "hasLateFees": <boolean>
  },
  "transactions": [
    {
      "transaction_date": "<YYYY-MM-DD>",
      "provider_name": "<toll authority name>",
      "plaza_name": "<plaza or location name>",
      "entry_location": "<entry point if available, or null>",
      "exit_location": "<exit point if available, or null>",
      "city": "<city or null>",
      "state": "<2-letter state code or null>",
      "amount": <number>,
      "external_transaction_id": "<reference/transaction ID if visible, or null>",
      "notes": "<any additional info, e.g. 'Class 2' or 'Video Toll'>"
    }
  ],
  "confidence": <0.0 to 1.0>,
  "warnings": ["<any extraction uncertainties>"]
}

## Rules

1. Extract EVERY line item as a separate transaction. Multi-toll invoices may have 5-20 crossings.
2. Dates must be in YYYY-MM-DD format. If only month/day are visible, infer the year from invoice date.
3. Amounts must be numbers (not strings). Remove $ signs and commas.
4. State codes should be 2-letter uppercase (e.g., "IL", "TX", "MA").
5. If the image is blurry or data is partially visible, include what you can and note uncertainties in warnings.
6. For "Pay by Mail" invoices, the provider_name should include "Pay-By-Mail" if relevant.
7. If late fees or penalties are listed, include them in invoiceMeta.lateFees and set hasLateFees = true.
8. Return ONLY valid JSON. No markdown fences, no explanatory text.

## Common Toll Providers to Recognize
- E-ZPass (multi-state)
- SunPass (Florida)
- FasTrak (California)
- Illinois Tollway / I-PASS
- Indiana Toll Road
- Kansas Turnpike Authority
- Pay-By-Plate MA (Massachusetts)
- Texas TxTag / TollTag
- Peach Pass (Georgia)
- Good To Go! (Washington)`;
}

function parseAiResponse(content) {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

function validateExtractionResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('AI returned invalid response structure');
  }
  if (!result.invoiceMeta || typeof result.invoiceMeta !== 'object') {
    result.invoiceMeta = {};
  }
  if (!Array.isArray(result.transactions)) {
    result.transactions = [];
  }
  if (typeof result.confidence !== 'number') {
    result.confidence = 0.5;
  }
  if (!Array.isArray(result.warnings)) {
    result.warnings = [];
  }
  // Ensure each transaction has required fields
  result.transactions = result.transactions.map((txn) => ({
    transaction_date: txn.transaction_date || null,
    provider_name: txn.provider_name || result.invoiceMeta.providerName || 'Unknown',
    plaza_name: txn.plaza_name || null,
    entry_location: txn.entry_location || null,
    exit_location: txn.exit_location || null,
    city: txn.city || null,
    state: txn.state ? String(txn.state).toUpperCase().slice(0, 2) : null,
    amount: typeof txn.amount === 'number' ? txn.amount : parseFloat(txn.amount) || 0,
    external_transaction_id: txn.external_transaction_id || null,
    notes: txn.notes || null
  }));
  return result;
}

async function handleTollInvoiceVision(req, res, _deps) {
  const startedAt = Date.now();
  try {
    const client = getAnthropicClient();
    const { imageBase64, mediaType } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'imageBase64 is required',
        code: 'AI_BAD_REQUEST',
      });
    }

    const resolvedMediaType = mediaType || 'image/jpeg';
    if (!SUPPORTED_MEDIA_TYPES.includes(resolvedMediaType)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported media type: ${resolvedMediaType}. Supported: ${SUPPORTED_MEDIA_TYPES.join(', ')}`,
        code: 'AI_BAD_REQUEST',
      });
    }

    const prompt = buildTollVisionPrompt();
    const model = process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-20250514';

    const message = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: resolvedMediaType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      system: 'You are a precise toll invoice data extraction assistant. Return ONLY valid JSON.',
      temperature: 0.1,
    });

    const processingTimeMs = Date.now() - startedAt;
    const aiContent = message.content[0]?.text || '{}';

    let result;
    try {
      result = parseAiResponse(aiContent);
      result = validateExtractionResult(result);
    } catch (parseErr) {
      console.error('[ai-service] toll invoice vision parse error', parseErr.message);
      return res.status(502).json({
        success: false,
        error: 'AI returned unparseable response',
        code: 'AI_PARSE_ERROR',
      });
    }

    logAiInteraction({
      userId: null,
      route: '/tolls/invoice-vision',
      message: `Toll invoice extraction: ${result.transactions.length} transactions extracted`,
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
    console.error('[ai-service] toll invoice vision error', err.message || err);

    logAiInteraction({
      userId: null,
      route: '/tolls/invoice-vision',
      message: `Toll invoice vision failed: ${err.message || 'Unknown error'}`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_ERROR',
      processingTimeMs,
    });

    return res.status(502).json({
      success: false,
      error: 'AI toll invoice extraction failed',
      code: 'AI_VISION_ERROR',
      details: err.message || 'Unknown error',
    });
  }
}

module.exports = { handleTollInvoiceVision };
