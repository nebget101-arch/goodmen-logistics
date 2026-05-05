'use strict';

/**
 * FN-1097: Claude Vision part-identification handler.
 * Modeled on toll-invoice-vision-handler.js. Uses the native Anthropic SDK
 * for image/vision support. Accepts a part photo (base64) and returns
 * structured fields with per-field confidence (0–1).
 *
 * Output shape (success):
 *   {
 *     manufacturer, partNumber, category,
 *     descriptionGuess, dimensionsGuess,
 *     confidence: { manufacturer, partNumber, category, description, dimensions }
 *   }
 *
 * When the AI flags the image as unreadable, the handler returns a structured
 * error response (HTTP 422) — it does not throw.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/parts/identify-vision';
const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const CONFIDENCE_KEYS = ['manufacturer', 'partNumber', 'category', 'description', 'dimensions'];

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

function buildPartsVisionPrompt() {
  return `You are a parts catalog data extraction specialist for a fleet management system called FleetNeuron.

You will be given a single photograph of a vehicle/equipment part (e.g., a brake pad, an air filter, a hydraulic hose, a wheel bearing, an alternator, an LED light bar, etc.). The user has snapped this photo to add the part to their parts catalog and wants you to pre-fill the form.

## Your Task

Identify what is visible in the image and return a JSON object with the following structure:

### Output JSON Schema

{
  "manufacturer": "<brand name printed/embossed on the part, or null>",
  "partNumber": "<exact part / model number printed on the part, or null>",
  "category": "<broad category, e.g. 'Brakes', 'Filtration', 'Hydraulics', 'Electrical', 'Suspension', 'Lighting', or null>",
  "descriptionGuess": "<one short sentence describing what the part is, or null>",
  "dimensionsGuess": "<approximate dimensions if visible/measurable, e.g. '12in x 4in', or null>",
  "confidence": {
    "manufacturer": <0.0 to 1.0>,
    "partNumber": <0.0 to 1.0>,
    "category": <0.0 to 1.0>,
    "description": <0.0 to 1.0>,
    "dimensions": <0.0 to 1.0>
  },
  "isUnreadable": <true | false>,
  "warnings": ["<extraction uncertainties>"]
}

## Confidence rules — be honest

- 0.9–1.0: text/logo is sharp and clearly legible (e.g., "BOSCH 0986424535" stamped on the part).
- 0.6–0.89: visible but partially obscured, ambiguous, or inferred from shape and partial markings.
- 0.3–0.59: weak guess from category cues (you can see it's a brake pad but cannot read any text).
- 0.0–0.29: cannot tell at all — set the field to null AND give a low confidence.

If a field is null, its confidence MUST be ≤ 0.3.

## Few-shot examples

Example A (sharp photo of a Bosch oil filter, full label visible):
{
  "manufacturer": "Bosch",
  "partNumber": "F002H20064",
  "category": "Filtration",
  "descriptionGuess": "Spin-on engine oil filter",
  "dimensionsGuess": "approx 4in x 3in diameter",
  "confidence": { "manufacturer": 0.97, "partNumber": 0.95, "category": 0.95, "description": 0.9, "dimensions": 0.55 },
  "isUnreadable": false,
  "warnings": []
}

Example B (blurry phone photo of what looks like a brake pad — no text visible):
{
  "manufacturer": null,
  "partNumber": null,
  "category": "Brakes",
  "descriptionGuess": "Disc brake pad set",
  "dimensionsGuess": null,
  "confidence": { "manufacturer": 0.05, "partNumber": 0.05, "category": 0.55, "description": 0.5, "dimensions": 0.05 },
  "isUnreadable": false,
  "warnings": ["Image is blurry; no markings legible."]
}

Example C (image is a hand, a wall, an unrelated object, or so dark/blurry the part is not visible):
{
  "manufacturer": null,
  "partNumber": null,
  "category": null,
  "descriptionGuess": null,
  "dimensionsGuess": null,
  "confidence": { "manufacturer": 0, "partNumber": 0, "category": 0, "description": 0, "dimensions": 0 },
  "isUnreadable": true,
  "warnings": ["No part visible in the image."]
}

## Rules

1. Return ONLY valid JSON. No markdown fences, no explanatory text.
2. Numbers (confidence) must be numbers (not strings).
3. Use null (not empty strings) when a field cannot be determined.
4. Set isUnreadable=true ONLY when the image is genuinely unusable (no part visible, total blur). For partial visibility, leave isUnreadable=false and use low confidences.
5. Do not guess a manufacturer brand without strong visual evidence (logo or printed text).`;
}

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

function clampConfidence(value) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(num)) return 0;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function normalizeStringField(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validateExtractionResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AI returned non-object response');
  }
  const rawConfidence =
    raw.confidence && typeof raw.confidence === 'object' && !Array.isArray(raw.confidence)
      ? raw.confidence
      : {};
  const confidence = {};
  for (const key of CONFIDENCE_KEYS) {
    confidence[key] = clampConfidence(rawConfidence[key]);
  }
  return {
    manufacturer: normalizeStringField(raw.manufacturer),
    partNumber: normalizeStringField(raw.partNumber),
    category: normalizeStringField(raw.category),
    descriptionGuess: normalizeStringField(raw.descriptionGuess),
    dimensionsGuess: normalizeStringField(raw.dimensionsGuess),
    confidence,
    isUnreadable: raw.isUnreadable === true,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.filter((w) => typeof w === 'string')
      : [],
  };
}

async function handlePartsVision(req, res, deps) {
  const startedAt = Date.now();
  const { imageBase64, mimeType, mediaType } = req.body || {};

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'imageBase64 is required',
      code: 'AI_BAD_REQUEST',
    });
  }

  const resolvedMediaType = mimeType || mediaType || 'image/jpeg';
  if (!SUPPORTED_MEDIA_TYPES.includes(resolvedMediaType)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported media type: ${resolvedMediaType}. Supported: ${SUPPORTED_MEDIA_TYPES.join(', ')}`,
      code: 'AI_BAD_REQUEST',
    });
  }

  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-20250514';

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0.1,
      system: 'You are a precise parts identification assistant. Return ONLY valid JSON.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: resolvedMediaType, data: imageBase64 },
            },
            { type: 'text', text: buildPartsVisionPrompt() },
          ],
        },
      ],
    });

    const processingTimeMs = Date.now() - startedAt;
    const aiContent = message.content?.[0]?.text || '';

    let parsed;
    try {
      parsed = parseAiResponse(aiContent);
    } catch (_parseErr) {
      logAiInteraction({
        userId: null,
        route: ROUTE,
        message: 'Parts vision parse failure',
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

    let result;
    try {
      result = validateExtractionResult(parsed);
    } catch (_validErr) {
      logAiInteraction({
        userId: null,
        route: ROUTE,
        message: 'Parts vision invalid response shape',
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

    if (result.isUnreadable) {
      logAiInteraction({
        userId: null,
        route: ROUTE,
        message: 'Parts vision image unreadable',
        conversationId: null,
        success: true,
        errorCode: 'AI_IMAGE_UNREADABLE',
        processingTimeMs,
      });
      return res.status(422).json({
        success: false,
        error: 'Image is unreadable — no part identifiable',
        code: 'AI_IMAGE_UNREADABLE',
        warnings: result.warnings,
      });
    }

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Parts vision ok (mfg=${result.manufacturer || 'null'}, pn=${result.partNumber || 'null'})`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs,
    });

    return res.json({
      success: true,
      data: result,
      meta: { model: message.model || model, processingTimeMs },
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] parts vision error', err.message || err);

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Parts vision upstream failure: ${err.message || 'Unknown error'}`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_VISION_ERROR',
      processingTimeMs,
    });

    return res.status(502).json({
      success: false,
      error: 'AI parts vision extraction failed',
      code: 'AI_VISION_ERROR',
      details: err.message || 'Unknown error',
    });
  }
}

module.exports = {
  handlePartsVision,
  buildPartsVisionPrompt,
  parseAiResponse,
  validateExtractionResult,
  clampConfidence,
  CONFIDENCE_KEYS,
  SUPPORTED_MEDIA_TYPES,
};
