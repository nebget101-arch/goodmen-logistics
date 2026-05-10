'use strict';

/**
 * FN-1627 (story FN-1625): CDL extraction service.
 *
 * Forwards a CDL image/PDF to the ai-service /api/ai/drivers/cdl-vision
 * handler (FN-1626), applies a per-field confidence floor, and shapes the
 * response into the camelCase newDriver contract the FE expects.
 *
 * Caller passes raw bytes — this module never persists them. Logging
 * is metadata-only (counts + processingMs); field values never reach the
 * log buffer.
 */

const dtLogger = require('../utils/logger');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:4100';
const AI_TIMEOUT_MS = Number(process.env.CDL_EXTRACT_AI_TIMEOUT_MS) || 30_000;

function defaultConfidenceFloor() {
  const raw = process.env.CDL_EXTRACT_CONFIDENCE_FLOOR;
  const parsed = raw == null ? NaN : Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  return 0.6;
}

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

function emptyExtracted() {
  const out = {};
  for (const key of FIELD_KEYS) out[key] = null;
  return out;
}

/**
 * Apply the confidence floor to a parsed AI response.
 *
 * Accepts either:
 *   { fields: { firstName: { value, confidence }, ... } }
 *   { firstName: { value, confidence }, ... }
 *   { firstName: 'John', ... } (no confidence — treated as 1.0)
 *
 * Returns { extracted, extractedFields, lowConfidenceFields }.
 */
function applyConfidenceFloor(aiPayload, floor) {
  const source = (aiPayload && aiPayload.fields) || aiPayload || {};
  const extracted = emptyExtracted();
  const extractedFields = [];
  const lowConfidenceFields = [];

  for (const key of FIELD_KEYS) {
    const cell = source[key];
    if (cell == null) continue;

    let value = null;
    let confidence = 1;

    if (typeof cell === 'object') {
      value = cell.value == null ? null : cell.value;
      if (typeof cell.confidence === 'number') confidence = cell.confidence;
    } else {
      value = cell;
    }

    if (value === '' || value == null) continue;

    if (confidence < floor) {
      lowConfidenceFields.push(key);
      continue;
    }

    extracted[key] = value;
    extractedFields.push(key);
  }

  return { extracted, extractedFields, lowConfidenceFields };
}

/**
 * POST the CDL bytes to the AI service and return the decoded response.
 * Uses globalThis.fetch (Node ≥ 18); injectable for tests.
 */
async function callAiService({ imageBase64, mimeType, fetcher = globalThis.fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetcher(`${AI_SERVICE_URL}/api/ai/drivers/cdl-vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ imageBase64, mimeType }),
      signal: controller.signal
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the full pipeline: AI call → confidence floor → camelCase response.
 *
 * Failure modes (returned as 200 by the route, never thrown):
 *   - AI 5xx / network error  → { success: false, reason: 'ai_unavailable' }
 *   - All fields below floor  → { success: false, reason: 'low_confidence' }
 *
 * @param {object} input
 * @param {Buffer} input.fileBuffer
 * @param {string} input.mimeType
 * @param {number} [input.confidenceFloor]   - override the env default
 * @param {Function} [input.fetcher]         - injected fetch (tests)
 * @returns {Promise<object>} response shape per the wire contract
 */
async function extractCdl({ fileBuffer, mimeType, confidenceFloor, fetcher } = {}) {
  if (!Buffer.isBuffer(fileBuffer)) throw new Error('cdl-extraction: fileBuffer is required');
  if (!mimeType) throw new Error('cdl-extraction: mimeType is required');

  const floor = typeof confidenceFloor === 'number' ? confidenceFloor : defaultConfidenceFloor();
  const start = Date.now();

  let aiResponse;
  try {
    aiResponse = await callAiService({
      imageBase64: fileBuffer.toString('base64'),
      mimeType,
      fetcher
    });
  } catch (err) {
    const processingMs = Date.now() - start;
    dtLogger.error('cdl_extract_ai_unavailable', err, {
      mimeType,
      fileSizeBytes: fileBuffer.length,
      processingMs
    });
    return { success: false, extracted: null, reason: 'ai_unavailable' };
  }

  if (!aiResponse.ok || aiResponse.status >= 500) {
    const processingMs = Date.now() - start;
    dtLogger.warn('cdl_extract_ai_unavailable', {
      mimeType,
      fileSizeBytes: fileBuffer.length,
      status: aiResponse.status,
      processingMs
    });
    return { success: false, extracted: null, reason: 'ai_unavailable' };
  }

  const { extracted, extractedFields, lowConfidenceFields } = applyConfidenceFloor(
    aiResponse.body,
    floor
  );

  const processingMs = Date.now() - start;

  if (extractedFields.length === 0) {
    dtLogger.info('cdl_extract_low_confidence', {
      mimeType,
      fileSizeBytes: fileBuffer.length,
      lowConfidenceFieldCount: lowConfidenceFields.length,
      processingMs
    });
    return { success: false, extracted: null, reason: 'low_confidence' };
  }

  dtLogger.info('cdl_extract_complete', {
    mimeType,
    fileSizeBytes: fileBuffer.length,
    extractedFieldCount: extractedFields.length,
    lowConfidenceFieldCount: lowConfidenceFields.length,
    processingMs
  });

  return {
    success: true,
    extracted,
    extractedFields,
    meta: { lowConfidenceFields, processingMs }
  };
}

module.exports = {
  extractCdl,
  applyConfidenceFloor,
  defaultConfidenceFloor,
  FIELD_KEYS,
  AI_SERVICE_URL
};
