'use strict';

/**
 * FN-1791 (story FN-1787): Agreement field & signature-block detection via Claude Vision.
 *
 * POST /api/ai/agreements/detect-fields
 *
 *   Body: { fileUrl } | { base64, contentType }
 *   Returns: { documentType, pageCount, fields: [
 *     { key, label, type, page, bbox, suggestedRole, suggestedValue, confidence }
 *   ] }
 *
 * Two detection paths (FN-1838):
 * - AcroForm fast-path: if the uploaded PDF carries a real form layer (a genuine
 *   "fillable" PDF), its embedded field definitions (name, type, page, widget rect)
 *   are read directly and deterministically via pdf-lib — higher fidelity than vision,
 *   and the only thing that works for empty fillable widgets (vision sees a blank page
 *   and returns 0 fields). See ../lib/acroform-extractor.js.
 * - Vision fallback: for SCANNED images/flat PDFs with no form layer, detection is done
 *   entirely with vision — we ask the model to locate every fillable field and signature
 *   block, classify its type, and suggest a fill-role.
 *
 * Notes (mirrors invoice-extractor-handler.js):
 * - Prompt caching: persona + schema are split into two `ephemeral` cached blocks so
 *   repeated agreement uploads in a session re-use the cached prefix.
 * - PDF input is sent as a `document` block (Claude 4.x reads inline PDF); images go as
 *   `image` blocks. `fileUrl` uses url sources; otherwise base64.
 * - Size cap: base64 payloads above MAX_FILE_BYTES are rejected with 413-style 400.
 * - Retry: one parse-failure retry with stricter "JSON only" reinforcement; a second
 *   failure returns 422 to the caller.
 * - Hallucination guard: the server re-validates `type` and `suggestedRole` against the
 *   contract enums; any invalid value is coerced to a safe default and that field's
 *   `confidence` is forced to 0 so the UI flags it for human review.
 * - Logging: counts only (field/page totals, file size, content-type). Never log the
 *   document bytes, field labels, or extracted values.
 */

const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');
const { extractAcroFormFields, isPdfBytes } = require('../lib/acroform-extractor');

const ROUTE = '/agreements/detect-fields';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12 MiB; matches gateway upload cap
const MAX_TOKENS = 8192;

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
const PDF_TYPE = 'application/pdf';

// Contract enums (FN-1787). Keep in sync with docs/stories/FN-1787.md and the
// agreement_template_fields persistence shape.
const FIELD_TYPES = ['text', 'date', 'number', 'checkbox', 'signature', 'initials'];
const ROLES = ['internal', 'signer'];
const DOC_TYPES = ['lease_agreement', 'generic'];

const DEFAULT_FIELD_TYPE = 'text';
const DEFAULT_ROLE = 'internal';
const DEFAULT_DOC_TYPE = 'generic';

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  return anthropicClient;
}

function buildSystemBlocks() {
  const persona = `You are a document-structure analyst for a fleet management system called FleetNeuron.

You will be given an agreement document (image or PDF) — usually a SCANNED lease agreement with no digital form fields. Your job is to locate every place a human must fill in, sign, or initial, classify each one, and decide who fills it. Return ONLY a JSON object — no prose, no markdown fences, no commentary.`;

  const schema = `## Required JSON shape

{
  "documentType": "lease_agreement" | "generic",
  "pageCount": <integer>,                       // total number of pages in the document
  "fields": [
    {
      "key": "<snake_case_string>",             // stable machine key, e.g. "lessee_name", "driver_signature"
      "label": "<string>",                       // human label as printed near the field, e.g. "Lessee Name"
      "type": "text"|"date"|"number"|"checkbox"|"signature"|"initials",
      "page": <integer>,                         // 1-based page the field appears on
      "bbox": [x, y, w, h],                       // NORMALIZED 0..1 coords of the fillable area on that page
      "suggestedRole": "internal" | "signer",
      "suggestedValue": "<string|null>",          // a value already pre-printed in the blank, else null
      "confidence": <number 0..1>                 // your confidence in this field's type + role
    }
  ]
}

## Field types
- text: a written line (names, addresses, free text)
- date: a date blank
- number: a numeric blank (amount, mileage, VIN count, etc.)
- checkbox: a box/option to tick
- signature: a signature line/box
- initials: a small initials blank (often repeated per page/section)

## Role assignment (internal vs signer)
- "internal" = filled by OUR staff (the lessor / fleet operator / company): the company's own name, internal reference numbers, agent/representative signature and date, office-use boxes.
- "signer" = filled by the EXTERNAL party (the lessee / customer / driver): their name, their signature, their initials, their date of signing, their personal details.
- When a field is clearly the company's, use "internal". When it is clearly the counterparty's, use "signer". If genuinely ambiguous, choose the more likely party and lower the confidence.

## Rules
1. Detect EVERY fillable field and signature/initials block across ALL pages. A multi-page lease often repeats initials per page.
2. "key" must be snake_case, unique within the document, and derived from the label/role (e.g. "lessee_signature", "lessor_date", "page_3_initials").
3. bbox coordinates are normalized to the page: x,y are the top-left corner, w,h the width/height, each between 0 and 1.
4. Only use the six allowed "type" values and the two allowed "suggestedRole" values. Never invent new ones.
5. "confidence" is a number between 0 and 1. Use lower values when the scan is faint or the role is ambiguous.
6. suggestedValue is non-null ONLY when the blank already has printed text in it; otherwise null.
7. Return ONLY the JSON object. No surrounding text.`;

  return [
    { type: 'text', text: persona, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: schema, cache_control: { type: 'ephemeral' } }
  ];
}

function buildSourceBlock({ base64, contentType, fileUrl }) {
  if (fileUrl) {
    if (contentType === PDF_TYPE) {
      return { type: 'document', source: { type: 'url', url: fileUrl } };
    }
    return { type: 'image', source: { type: 'url', url: fileUrl } };
  }

  if (contentType === PDF_TYPE) {
    return {
      type: 'document',
      source: { type: 'base64', media_type: PDF_TYPE, data: base64 }
    };
  }

  return {
    type: 'image',
    source: { type: 'base64', media_type: contentType, data: base64 }
  };
}

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

function coerceString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function coerceInteger(value, fallback) {
  const num = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
}

function clampConfidence(value) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(num)) return 0;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

// bbox must be [x, y, w, h] of finite numbers. Anything else becomes a zero box
// so the frontend can still place a (flagged) marker. `clamp01` clamps each value
// to [0, 1] for the vision path (which emits normalized coords); the AcroForm
// path emits PDF points (docs/design/agreements-bbox-coordinates.md) and only
// clamps the lower bound to 0.
function normalizeBbox(value, clamp01 = true) {
  if (!Array.isArray(value) || value.length !== 4) return [0, 0, 0, 0];
  return value.map((n) => {
    const num = typeof n === 'number' ? n : parseFloat(n);
    if (!Number.isFinite(num)) return 0;
    if (num < 0) return 0;
    if (clamp01 && num > 1) return 1;
    return num;
  });
}

function slugifyKey(value, index) {
  const base = coerceString(value);
  if (!base) return `field_${index + 1}`;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || `field_${index + 1}`;
}

/**
 * Hallucination guard. Re-validates each field against the contract enums; an invalid
 * `type` or `suggestedRole` is coerced to a safe default AND the field's confidence is
 * forced to 0. Returns { fields, pageCount, documentType, guardHits }.
 */
function normalizeDetection(raw, { clampBbox = true } = {}) {
  const safe = raw && typeof raw === 'object' ? raw : {};

  const documentType = DOC_TYPES.includes(safe.documentType) ? safe.documentType : DEFAULT_DOC_TYPE;

  const rawFields = Array.isArray(safe.fields) ? safe.fields : [];
  const usedKeys = new Set();
  let guardHits = 0;
  let maxPage = 1;

  const fields = rawFields
    .filter((f) => f && typeof f === 'object')
    .map((f, index) => {
      let guarded = false;

      let type = f.type;
      if (!FIELD_TYPES.includes(type)) {
        type = DEFAULT_FIELD_TYPE;
        guarded = true;
      }

      let suggestedRole = f.suggestedRole;
      if (!ROLES.includes(suggestedRole)) {
        suggestedRole = DEFAULT_ROLE;
        guarded = true;
      }

      const page = Math.max(1, coerceInteger(f.page, 1));
      if (page > maxPage) maxPage = page;

      // Ensure unique snake_case keys.
      let key = slugifyKey(f.key || f.label, index);
      if (usedKeys.has(key)) {
        let suffix = 2;
        while (usedKeys.has(`${key}_${suffix}`)) suffix += 1;
        key = `${key}_${suffix}`;
      }
      usedKeys.add(key);

      const confidence = guarded ? 0 : clampConfidence(f.confidence);
      if (guarded) guardHits += 1;

      return {
        key,
        label: coerceString(f.label) || key,
        type,
        page,
        bbox: normalizeBbox(f.bbox, clampBbox),
        suggestedRole,
        suggestedValue: coerceString(f.suggestedValue),
        confidence
      };
    });

  // pageCount: trust the model if it gives a sane value >= the highest field page,
  // otherwise fall back to the highest detected page.
  const claimedPageCount = coerceInteger(safe.pageCount, 0);
  const pageCount = claimedPageCount >= maxPage && claimedPageCount > 0 ? claimedPageCount : maxPage;

  return { documentType, pageCount, fields, guardHits };
}

const PDF_DOWNLOAD_TIMEOUT_MS = 8000;

async function defaultFetchPdfBytes(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: PDF_DOWNLOAD_TIMEOUT_MS,
    maxContentLength: MAX_FILE_BYTES,
    maxBodyLength: MAX_FILE_BYTES
  });
  return Buffer.from(res.data);
}

/**
 * FN-1838: obtain raw PDF bytes for the AcroForm fast-path, or null when the
 * source cannot be (or need not be) read as a PDF. Never throws.
 *  - base64 input: decode locally.
 *  - fileUrl input: download the bytes (the agreement service passes a signed R2
 *    URL with no contentType, so we attempt unless we KNOW it's an image).
 * The magic-byte check (`isPdfBytes`) guards against non-PDF payloads.
 * `deps.fetchPdfBytes(url)` is injectable for tests; defaults to a capped axios GET.
 */
async function loadPdfBytes({ base64, contentType, fileUrl }, deps = {}) {
  // A known image content-type can never be an AcroForm PDF — skip the work.
  if (contentType && SUPPORTED_IMAGE_TYPES.includes(contentType)) return null;

  try {
    if (base64) {
      const buf = Buffer.from(base64, 'base64');
      return isPdfBytes(buf) ? buf : null;
    }
    if (fileUrl) {
      const fetchBytes = deps.fetchPdfBytes || defaultFetchPdfBytes;
      const raw = await fetchBytes(fileUrl);
      if (!raw || !raw.length) return null;
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      return isPdfBytes(buf) ? buf : null;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] agreement AcroForm byte load failed', err.message || err);
    return null;
  }
  return null;
}

/**
 * Attempt deterministic AcroForm detection. Returns a normalized detection
 * result ({ documentType, pageCount, fields, guardHits }) when the PDF has a
 * placeable form layer, otherwise null (caller falls back to vision). The
 * detected fields are run through the shared `normalizeDetection` guard WITHOUT
 * bbox clamping, since AcroForm bboxes are PDF points, not normalized 0..1.
 * Never throws.
 */
async function tryAcroFormDetection(input, deps = {}) {
  const bytes = await loadPdfBytes(input, deps);
  if (!bytes) return null;

  const extractor = deps.extractAcroForm || extractAcroFormFields;
  let result;
  try {
    result = await extractor(bytes);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] AcroForm extraction failed', err.message || err);
    return null;
  }

  if (!result || !result.hasForm || !Array.isArray(result.fields) || !result.fields.length) {
    return null;
  }

  const normalized = normalizeDetection(result, { clampBbox: false });
  // Preserve the real page count from the parsed PDF (it can exceed the highest
  // page that carries a field — e.g. a multi-page lease with fields only up front).
  if (Number.isInteger(result.pageCount) && result.pageCount > normalized.pageCount) {
    normalized.pageCount = result.pageCount;
  }
  return normalized;
}

async function callDetection(client, model, systemBlocks, sourceBlock, reinforce) {
  const userText = reinforce
    ? 'Detect every fillable field and signature block. Respond with ONLY the JSON object described in the schema. No prose, no markdown.'
    : 'Detect the fillable fields and signature blocks per the schema.';

  return client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    temperature: 0.1,
    system: systemBlocks,
    messages: [
      {
        role: 'user',
        content: [sourceBlock, { type: 'text', text: userText }]
      }
    ]
  });
}

function validateBody(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be a JSON object', code: 'AI_BAD_REQUEST' };
  }
  const { fileUrl, base64, contentType } = body;

  if (fileUrl) {
    if (typeof fileUrl !== 'string' || !/^https?:\/\//i.test(fileUrl)) {
      return { error: 'fileUrl must be an http(s) URL', code: 'AI_BAD_REQUEST' };
    }
    const ct = typeof contentType === 'string' ? contentType : null;
    if (ct && !SUPPORTED_IMAGE_TYPES.includes(ct) && ct !== PDF_TYPE) {
      return { error: `Unsupported contentType: ${ct}`, code: 'AI_BAD_REQUEST' };
    }
    return { ok: true, fileUrl, contentType: ct };
  }

  if (typeof base64 !== 'string' || !base64) {
    return { error: 'Provide either fileUrl or base64+contentType', code: 'AI_BAD_REQUEST' };
  }
  if (typeof contentType !== 'string' || !contentType) {
    return { error: 'contentType is required when base64 is provided', code: 'AI_BAD_REQUEST' };
  }
  if (!SUPPORTED_IMAGE_TYPES.includes(contentType) && contentType !== PDF_TYPE) {
    return { error: `Unsupported contentType: ${contentType}`, code: 'AI_BAD_REQUEST' };
  }
  // ~4/3 expansion for base64
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_FILE_BYTES) {
    return { error: `File too large (${approxBytes} bytes; limit ${MAX_FILE_BYTES})`, code: 'AI_FILE_TOO_LARGE' };
  }
  return { ok: true, base64, contentType, approxBytes };
}

async function handleAgreementDetectFields(req, res, deps = {}) {
  const startedAt = Date.now();

  const validation = validateBody(req.body);
  if (validation.error) {
    return res.status(400).json({
      success: false,
      error: validation.error,
      code: validation.code
    });
  }

  const { fileUrl, base64, contentType, approxBytes } = validation;

  // FN-1838: AcroForm fast-path. A genuine fillable PDF carries its field
  // definitions in a form layer; read them directly (deterministic, confidence
  // 1.0, and the only thing that works when the widgets are visually empty so
  // vision returns 0 fields). Falls back to vision for scanned/flat docs.
  const acroForm = await tryAcroFormDetection({ fileUrl, base64, contentType }, deps);
  if (acroForm) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Agreement detect ok (acroform) fields=${acroForm.fields.length} pages=${acroForm.pageCount} guarded=${acroForm.guardHits} size=${approxBytes || 0} type=${contentType || 'url'}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });
    return res.json({
      success: true,
      data: {
        documentType: acroForm.documentType,
        pageCount: acroForm.pageCount,
        fields: acroForm.fields
      },
      meta: {
        model: 'acroform-extract',
        processingTimeMs,
        usage: null
      }
    });
  }

  const client = deps.anthropic || getAnthropicClient();
  const model = process.env.AI_AGREEMENT_MODEL || process.env.ANTHROPIC_VISION_MODEL || DEFAULT_MODEL;

  const systemBlocks = buildSystemBlocks();
  const sourceBlock = buildSourceBlock({ base64, contentType, fileUrl });

  let aiContent;
  let usage = null;
  try {
    const message = await callDetection(client, model, systemBlocks, sourceBlock, false);
    aiContent = message.content?.[0]?.text || '';
    usage = message.usage || null;
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] agreement detect upstream error', err.message || err);
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Agreement detect upstream failure (size=${approxBytes || 0}, type=${contentType || 'url'})`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_UNAVAILABLE',
      processingTimeMs
    });
    return res.status(502).json({
      success: false,
      error: 'AI agreement field detection failed',
      code: 'AI_UPSTREAM_ERROR'
    });
  }

  let parsed;
  try {
    parsed = parseAiResponse(aiContent);
  } catch (_firstParseErr) {
    try {
      const retry = await callDetection(client, model, systemBlocks, sourceBlock, true);
      const retryContent = retry.content?.[0]?.text || '';
      parsed = parseAiResponse(retryContent);
      usage = retry.usage || usage;
    } catch (_retryErr) {
      const processingTimeMs = Date.now() - startedAt;
      logAiInteraction({
        userId: null,
        route: ROUTE,
        message: `Agreement detect parse failed twice (size=${approxBytes || 0}, type=${contentType || 'url'})`,
        conversationId: null,
        success: false,
        errorCode: 'AI_PARSE_ERROR',
        processingTimeMs
      });
      return res.status(422).json({
        success: false,
        error: 'Agreement field detection did not return parseable JSON',
        code: 'AI_PARSE_ERROR'
      });
    }
  }

  const { documentType, pageCount, fields, guardHits } = normalizeDetection(parsed);

  const processingTimeMs = Date.now() - startedAt;
  logAiInteraction({
    userId: null,
    route: ROUTE,
    message: `Agreement detect ok fields=${fields.length} pages=${pageCount} guarded=${guardHits} size=${approxBytes || 0} type=${contentType || 'url'}`,
    conversationId: null,
    success: true,
    errorCode: null,
    processingTimeMs
  });

  return res.json({
    success: true,
    data: {
      documentType,
      pageCount,
      fields
    },
    meta: {
      model,
      processingTimeMs,
      usage: usage
        ? {
            inputTokens: usage.input_tokens ?? null,
            outputTokens: usage.output_tokens ?? null,
            cacheReadTokens: usage.cache_read_input_tokens ?? null,
            cacheCreationTokens: usage.cache_creation_input_tokens ?? null
          }
        : null
    }
  });
}

module.exports = {
  handleAgreementDetectFields,
  buildSystemBlocks,
  buildSourceBlock,
  normalizeDetection,
  normalizeBbox,
  loadPdfBytes,
  tryAcroFormDetection,
  validateBody,
  parseAiResponse,
  FIELD_TYPES,
  ROLES,
  DOC_TYPES,
  SUPPORTED_IMAGE_TYPES,
  PDF_TYPE,
  DEFAULT_MODEL,
  MAX_FILE_BYTES
};
