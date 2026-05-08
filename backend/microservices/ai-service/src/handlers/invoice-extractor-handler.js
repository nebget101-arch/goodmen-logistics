'use strict';

/**
 * FN-1489: Vendor invoice → structured lines via Claude Vision/Document.
 *
 * POST /api/ai/invoice/extract
 *
 *   Body: { fileUrl } | { base64, contentType }
 *   Returns: { vendor, reference, invoiceDate, lines: [{ sku, description, qty, unitCost, match }] }
 *
 * Notes
 * - Prompt caching: system prompt + extraction schema are split into two cached
 *   blocks so repeated invoice uploads in a session re-use the cached prefix.
 * - PDF input is sent as a `document` block (Claude 4.x supports inline PDF).
 *   We do NOT pre-render PDF pages here — the model handles the first pages.
 * - Retry: one parse-failure retry with stricter "JSON only" reinforcement; on
 *   second failure we return 422 to the caller.
 * - Logging: file size + content-type only. Never log file bytes, vendor names,
 *   or line items.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');
const { matchSkus } = require('./parts-matcher');

const ROUTE = '/invoice/extract';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12 MiB; matches gateway upload cap
const MAX_TOKENS = 4096;

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
const PDF_TYPE = 'application/pdf';

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  return anthropicClient;
}

let sharedPool = null;
function getPool() {
  if (sharedPool) return sharedPool;
  try {
    // eslint-disable-next-line global-require
    sharedPool = require('@goodmen/shared/config/database').pool;
  } catch (_err) {
    sharedPool = null;
  }
  return sharedPool;
}

function buildSystemBlocks() {
  const persona = `You are an invoice data extraction specialist for a fleet/warehouse management system called FleetNeuron.

You will be given a vendor invoice (image or PDF). Extract vendor metadata and every line item visible. Return ONLY a JSON object — no prose, no markdown fences, no commentary.`;

  const schema = `## Required JSON shape

{
  "vendorName": "<string|null>",        // The seller/supplier on the invoice (not the buyer)
  "referenceNumber": "<string|null>",   // Invoice number, document number, or order number
  "invoiceDate": "<YYYY-MM-DD|null>",   // Issue date (NOT due date)
  "lines": [
    {
      "sku": "<string|null>",           // Vendor part number / SKU / catalog number; null if absent
      "description": "<string>",        // Item description as it appears on the invoice
      "qty": <number>,                  // Quantity received; default 1 if not visible
      "unitCost": <number>              // Per-unit price in invoice currency; strip $ and commas
    }
  ]
}

## Rules

1. Extract every billable item line. Skip subtotals, taxes, freight, and discounts.
2. Numbers must be JSON numbers (not strings). Use 0 if a value is illegible rather than guessing.
3. Dates use YYYY-MM-DD. If only month/day are visible, infer the year from the invoice header.
4. If the SKU is missing or clearly the buyer's internal code, set sku to null.
5. If the document is not an invoice/receipt at all, return an empty lines array and set vendorName to null.
6. Do not include any field outside the schema. Do not add comments inside the JSON.`;

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

function coerceNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const stripped = value.replace(/[$,\s]/g, '');
    const num = parseFloat(stripped);
    if (Number.isFinite(num)) return num;
  }
  return fallback;
}

function coerceString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeExtraction(raw) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const linesRaw = Array.isArray(safe.lines) ? safe.lines : [];
  return {
    vendor: coerceString(safe.vendorName),
    reference: coerceString(safe.referenceNumber),
    invoiceDate: coerceString(safe.invoiceDate),
    lines: linesRaw
      .filter((line) => line && typeof line === 'object')
      .map((line) => ({
        sku: coerceString(line.sku),
        description: coerceString(line.description) || '',
        qty: coerceNumber(line.qty, 1),
        unitCost: coerceNumber(line.unitCost, 0)
      }))
  };
}

async function callExtraction(client, model, systemBlocks, sourceBlock, reinforce) {
  const userText = reinforce
    ? 'Extract the invoice data. Respond with ONLY the JSON object described in the schema. No prose, no markdown.'
    : 'Extract the invoice data per the schema.';

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

async function handleInvoiceExtract(req, res, deps = {}) {
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
  const client = deps.anthropic || getAnthropicClient();
  const pool = Object.prototype.hasOwnProperty.call(deps, 'pool')
    ? deps.pool
    : getPool();
  const model = process.env.AI_INVOICE_MODEL || DEFAULT_MODEL;

  const systemBlocks = buildSystemBlocks();
  const sourceBlock = buildSourceBlock({ base64, contentType, fileUrl });

  let aiContent;
  let usage = null;
  try {
    const message = await callExtraction(client, model, systemBlocks, sourceBlock, false);
    aiContent = message.content?.[0]?.text || '';
    usage = message.usage || null;
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] invoice extraction upstream error', err.message || err);
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Invoice extract upstream failure (size=${approxBytes || 0}, type=${contentType || 'url'})`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_UNAVAILABLE',
      processingTimeMs
    });
    return res.status(502).json({
      success: false,
      error: 'AI invoice extraction failed',
      code: 'AI_UPSTREAM_ERROR'
    });
  }

  let parsed;
  try {
    parsed = parseAiResponse(aiContent);
  } catch (_firstParseErr) {
    try {
      const retry = await callExtraction(client, model, systemBlocks, sourceBlock, true);
      const retryContent = retry.content?.[0]?.text || '';
      parsed = parseAiResponse(retryContent);
      usage = retry.usage || usage;
    } catch (_retryErr) {
      const processingTimeMs = Date.now() - startedAt;
      logAiInteraction({
        userId: null,
        route: ROUTE,
        message: `Invoice extract parse failed twice (size=${approxBytes || 0}, type=${contentType || 'url'})`,
        conversationId: null,
        success: false,
        errorCode: 'AI_PARSE_ERROR',
        processingTimeMs
      });
      return res.status(422).json({
        success: false,
        error: 'Invoice extraction did not return parseable JSON',
        code: 'AI_PARSE_ERROR'
      });
    }
  }

  const normalized = normalizeExtraction(parsed);

  let matchMap = new Map();
  if (pool && normalized.lines.length > 0) {
    try {
      const skus = normalized.lines.map((l) => l.sku).filter(Boolean);
      if (skus.length > 0) {
        matchMap = await matchSkus({ pool, skus });
      }
    } catch (matchErr) {
      // eslint-disable-next-line no-console
      console.error('[ai-service] invoice parts match error', matchErr.message || matchErr);
    }
  }

  const lines = normalized.lines.map((line) => ({
    ...line,
    match: line.sku && matchMap.has(line.sku) ? matchMap.get(line.sku) : null
  }));

  const processingTimeMs = Date.now() - startedAt;
  logAiInteraction({
    userId: null,
    route: ROUTE,
    message: `Invoice extract ok lines=${lines.length} matched=${[...matchMap.keys()].length} size=${approxBytes || 0} type=${contentType || 'url'}`,
    conversationId: null,
    success: true,
    errorCode: null,
    processingTimeMs
  });

  return res.json({
    success: true,
    data: {
      vendor: normalized.vendor,
      reference: normalized.reference,
      invoiceDate: normalized.invoiceDate,
      lines
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
  handleInvoiceExtract,
  buildSystemBlocks,
  buildSourceBlock,
  normalizeExtraction,
  validateBody,
  parseAiResponse,
  SUPPORTED_IMAGE_TYPES,
  PDF_TYPE,
  DEFAULT_MODEL,
  MAX_FILE_BYTES
};
