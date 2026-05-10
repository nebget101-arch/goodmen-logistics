'use strict';

/**
 * FN-1626: Claude Vision CDL extraction handler.
 *
 * Extracts driver identity + license fields from a Commercial Driver's License
 * (CDL) image (JPEG/PNG) or PDF using the Anthropic SDK.
 *
 * - Validates the request body BEFORE calling Claude (mimeType allowlist, size cap).
 * - Sends PDFs as a `document` content block; images as an `image` block.
 * - System prompt is sent as an array of text blocks with prompt caching enabled
 *   (`cache_control: { type: 'ephemeral' }`) — the prompt is static, so every
 *   request after the first 5-minute warmup hits the cache.
 * - Hallucination protection: every field returned by the model is re-validated
 *   server-side. Anything failing its validator is coerced to
 *   `{ value: null, confidence: 0 }`.
 * - Logging: emits a single `logAiInteraction` per request with NO field values,
 *   only an aggregate count at confidence ≥ 0.6.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/drivers/cdl-vision';
const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_DECODED_BYTES = 10 * 1024 * 1024; // 10 MB
const CONFIDENCE_REPORT_THRESHOLD = 0.6;

// 50 US states + DC + US territories (per spec).
const VALID_US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
  'PR', 'VI', 'GU', 'AS', 'MP'
]);

const ZIP_RE = /^\d{5}(-\d{4})?$/;
const CDL_CLASS_VALUES = new Set(['A', 'B', 'C']);

// All 12 keys the response is expected to surface, in canonical order.
const FIELD_KEYS = [
  'firstName',
  'middleName',
  'lastName',
  'dateOfBirth',
  'streetAddress',
  'city',
  'state',
  'zipCode',
  'cdlNumber',
  'cdlState',
  'cdlClass',
  'cdlExpiry'
];

const SYSTEM_PROMPT = `You are a precise data-extraction assistant. The image or PDF you are given is the front side of a US Commercial Driver's License (CDL).

Extract the driver's identity, mailing address, and CDL fields and return them as a single JSON object with exactly the following 12 keys, each mapped to an object with "value" and "confidence":

{
  "firstName":     { "value": "...|null", "confidence": 0.0 },
  "middleName":    { "value": "...|null", "confidence": 0.0 },
  "lastName":      { "value": "...|null", "confidence": 0.0 },
  "dateOfBirth":   { "value": "YYYY-MM-DD|null", "confidence": 0.0 },
  "streetAddress": { "value": "...|null", "confidence": 0.0 },
  "city":          { "value": "...|null", "confidence": 0.0 },
  "state":         { "value": "XX|null", "confidence": 0.0 },
  "zipCode":       { "value": "...|null", "confidence": 0.0 },
  "cdlNumber":     { "value": "...|null", "confidence": 0.0 },
  "cdlState":      { "value": "XX|null", "confidence": 0.0 },
  "cdlClass":      { "value": "A|B|C|null", "confidence": 0.0 },
  "cdlExpiry":     { "value": "YYYY-MM-DD|null", "confidence": 0.0 }
}

Return ONLY a JSON object — no prose, no markdown fences.

If a field is missing, illegible, or you are uncertain, return null AND set confidence for that field to a low value (<=0.4). Never invent values.

States are returned as 2-letter USPS codes; dates as ISO YYYY-MM-DD.

confidence is a number in [0, 1] reflecting how confident you are in the extracted value.`;

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  return anthropicClient;
}

function decodedByteLength(b64) {
  // Buffer.byteLength with 'base64' returns the size of the decoded payload.
  return Buffer.byteLength(b64, 'base64');
}

function clampConfidence(c) {
  if (typeof c !== 'number' || !Number.isFinite(c)) return 0;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

function isValidYmd(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ts = Date.parse(value);
  return !Number.isNaN(ts);
}

function isValidDob(value) {
  if (!isValidYmd(value)) return false;
  const year = parseInt(value.slice(0, 4), 10);
  const currentYear = new Date().getFullYear();
  // Spec: year > 1900 AND year < currentYear (no future DOB).
  return year > 1900 && year < currentYear;
}

function isValidExpiry(value) {
  if (!isValidYmd(value)) return false;
  const year = parseInt(value.slice(0, 4), 10);
  const currentYear = new Date().getFullYear();
  // Spec: within next 20 years (year <= currentYear + 20). Allow past dates.
  return year <= currentYear + 20;
}

function isValidState(value) {
  return typeof value === 'string' && VALID_US_STATES.has(value);
}

function isValidZip(value) {
  return typeof value === 'string' && ZIP_RE.test(value);
}

function isValidCdlClass(value) {
  return typeof value === 'string' && CDL_CLASS_VALUES.has(value);
}

const FIELD_VALIDATORS = {
  // Identity / address strings: validators are null (any non-empty string allowed).
  firstName: null,
  middleName: null,
  lastName: null,
  streetAddress: null,
  city: null,
  cdlNumber: null,
  // Strict validators:
  dateOfBirth: isValidDob,
  state: isValidState,
  zipCode: isValidZip,
  cdlState: isValidState,
  cdlClass: isValidCdlClass,
  cdlExpiry: isValidExpiry
};

/**
 * Re-validate every field returned by the LLM. Any field whose value is null
 * or fails its validator is coerced to { value: null, confidence: 0 }.
 * Missing keys are filled in with the same null/0 default so the response
 * always contains all 12 keys.
 */
function postValidateFields(rawFields) {
  const out = {};
  const obj = (rawFields && typeof rawFields === 'object' && !Array.isArray(rawFields))
    ? rawFields
    : {};

  for (const key of FIELD_KEYS) {
    const entry = obj[key];
    let value = null;
    let confidence = 0;

    if (entry && typeof entry === 'object') {
      value = entry.value === undefined ? null : entry.value;
      confidence = clampConfidence(entry.confidence);
    }

    // Trim string values; treat empty/whitespace-only as null.
    if (typeof value === 'string') {
      const trimmed = value.trim();
      value = trimmed.length === 0 ? null : trimmed;
    } else if (value !== null) {
      // Non-string, non-null values are invalid — coerce to null.
      value = null;
    }

    // Validate. If validator fails (or value is null), coerce to null/0.
    if (value === null) {
      out[key] = { value: null, confidence: 0 };
      continue;
    }

    const validator = FIELD_VALIDATORS[key];
    const isValid = validator ? validator(value) : (typeof value === 'string' && value.length > 0);

    if (!isValid) {
      out[key] = { value: null, confidence: 0 };
    } else {
      out[key] = { value, confidence };
    }
  }

  return out;
}

function countHighConfidenceFields(fields) {
  let n = 0;
  for (const key of FIELD_KEYS) {
    const f = fields[key];
    if (f && f.value !== null && f.confidence >= CONFIDENCE_REPORT_THRESHOLD) {
      n += 1;
    }
  }
  return n;
}

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  // Defensive: extract the first JSON object if the model added prose around it.
  if (!cleaned.startsWith('{')) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) cleaned = match[0];
  }
  return JSON.parse(cleaned);
}

function buildContentBlock(imageBase64, mimeType) {
  if (mimeType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 }
    };
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: mimeType, data: imageBase64 }
  };
}

async function handleCdlVision(req, res, deps) {
  const startedAt = Date.now();
  const body = (req && req.body) || {};
  const { imageBase64, mimeType } = body;

  // ---- Validation (pre-Anthropic) ----
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'imageBase64 is required',
      code: 'AI_BAD_REQUEST'
    });
  }
  if (typeof mimeType !== 'string' || !SUPPORTED_MIME_TYPES.includes(mimeType)) {
    return res.status(400).json({
      success: false,
      error: 'invalid mimeType',
      code: 'AI_BAD_REQUEST'
    });
  }
  if (decodedByteLength(imageBase64) > MAX_DECODED_BYTES) {
    return res.status(400).json({
      success: false,
      error: 'cdl image too large',
      code: 'AI_BAD_REQUEST'
    });
  }

  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-20250514';

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0,
      // System prompt as cached text blocks. The prompt is static, so the cache
      // is reused across every request after the first.
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [
        {
          role: 'user',
          content: [
            buildContentBlock(imageBase64, mimeType),
            { type: 'text', text: 'Extract the CDL fields per the schema and return ONLY the JSON object.' }
          ]
        }
      ]
    });

    const processingMs = Date.now() - startedAt;
    const aiContent = (message && message.content && message.content[0] && message.content[0].text) || '{}';

    let parsed;
    try {
      parsed = parseAiResponse(aiContent);
    } catch (_parseErr) {
      logAiInteraction({
        userId: null,
        route: ROUTE,
        message: 'cdl-vision parse failure',
        conversationId: null,
        success: false,
        errorCode: 'AI_PARSE_ERROR',
        processingTimeMs: processingMs
      });
      return res.status(502).json({
        success: false,
        error: 'AI returned unparseable response',
        code: 'AI_UPSTREAM_ERROR'
      });
    }

    const fields = postValidateFields(parsed);
    const highConfidenceCount = countHighConfidenceFields(fields);
    const resolvedModel = (message && message.model) || model;

    logAiInteraction({
      userId: null,
      route: ROUTE,
      // NOTE: deliberately no field values — only an aggregate count.
      message: `cdl-vision extracted ${highConfidenceCount}/${FIELD_KEYS.length} fields at confidence>=${CONFIDENCE_REPORT_THRESHOLD}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs: processingMs
    });

    return res.json({
      success: true,
      fields,
      meta: {
        model: resolvedModel,
        processingMs
      }
    });
  } catch (err) {
    const processingMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] cdl-vision error', (err && err.message) || err);

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: 'cdl-vision upstream failure',
      conversationId: null,
      success: false,
      errorCode: err && err.status ? `HTTP_${err.status}` : 'AI_UPSTREAM_ERROR',
      processingTimeMs: processingMs
    });

    return res.status(502).json({
      success: false,
      error: (err && err.message) || 'AI CDL extraction failed',
      code: 'AI_UPSTREAM_ERROR'
    });
  }
}

module.exports = {
  handleCdlVision,
  // Exported for testing
  postValidateFields,
  countHighConfidenceFields,
  parseAiResponse,
  buildContentBlock,
  SYSTEM_PROMPT,
  SUPPORTED_MIME_TYPES,
  MAX_DECODED_BYTES,
  FIELD_KEYS,
  VALID_US_STATES,
  CONFIDENCE_REPORT_THRESHOLD
};
