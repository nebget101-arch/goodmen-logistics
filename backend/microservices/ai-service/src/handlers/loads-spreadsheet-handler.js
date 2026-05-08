'use strict';

/**
 * FN-1592: Loads spreadsheet import — AI handler.
 *
 * Takes spreadsheet headers + sample rows and returns:
 *   - columnMapping        — each FN load field mapped to a source header (with confidence)
 *   - statusEnumMapping    — source status values normalized to FN LOAD_STATUSES
 *   - billingStatusEnumMapping — source billing values normalized to FN BILLING_STATUSES
 *   - multiStopPattern     — single | multi_row | extra_columns | free_text
 *   - extraStopColumns     — extra pickup2_x / delivery2_x columns when pattern is "extra_columns"
 *   - groupByColumn        — column to group rows on when pattern is "multi_row"
 *   - warnings, overallConfidence
 *
 * Implementation notes:
 *   - Uses @anthropic-ai/sdk via client.messages.create (NOT OpenAI).
 *   - Model: process.env.ANTHROPIC_LOADS_IMPORT_MODEL || 'claude-sonnet-4-20250514'.
 *   - System prompt is wrapped in cache_control: { type: 'ephemeral' } so the
 *     loads-schema description (stable across all imports) caches across calls.
 *   - Cache lookup BEFORE any AI call: SHA-256(stable JSON of {headers, sampleRows})
 *     keyed in load_ai_extractions (tenant-scoped, 7-day TTL). Created by FN-741.
 *   - On parse failure → { success: true, fallback: true, meta: { reason } } (no 5xx).
 *   - Lazy Anthropic client init mirrors fuel-preprocess-handler / loads-nlq-handler.
 */

const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/loads/spreadsheet-import';
const MAX_SAMPLE_ROWS = 20;
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.1;
const CACHE_TTL_DAYS = 7;
const EXTRACTION_METHOD = 'loads-spreadsheet-mapping';

// Mirrors loads-nlq-handler enums (kept in sync with goodmen-shared loads route).
const LOAD_STATUSES = [
  'DRAFT', 'NEW', 'CANCELLED', 'CANCELED', 'TONU', 'DISPATCHED', 'EN_ROUTE',
  'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'
];
const BILLING_STATUSES = [
  'PENDING', 'CANCELLED', 'CANCELED', 'BOL_RECEIVED', 'INVOICED',
  'SENT_TO_FACTORING', 'FUNDED', 'PAID'
];

// Locked field set from FN-1585 story doc lines 21-37 (column mapping keys).
const FN_LOAD_FIELDS = Object.freeze([
  'load_number', 'po_number', 'rate',
  'broker_name', 'broker_mc', 'broker_dot',
  'pickup_city', 'pickup_state', 'pickup_zip', 'pickup_address1', 'pickup_date',
  'delivery_city', 'delivery_state', 'delivery_zip', 'delivery_address1', 'delivery_date',
  'driver_name', 'truck_unit', 'trailer_unit',
  'status', 'billing_status', 'notes'
]);

const MULTI_STOP_PATTERNS = ['single', 'multi_row', 'extra_columns', 'free_text'];

// ---------------------------------------------------------------------------
// Anthropic client (lazy, mirrors loads-nlq-handler / fuel-preprocess-handler).
// ---------------------------------------------------------------------------
let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  return anthropicClient;
}

// ---------------------------------------------------------------------------
// Cache plumbing — load_ai_extractions table (FN-741).
// We reuse the same table because it's the only AI extraction cache we have
// and the schema (tenant_id, pdf_hash, extracted_data, extraction_method) fits:
// the "pdf_hash" column stores the SHA-256 of stable {headers, sampleRows} JSON,
// and "extraction_method" distinguishes spreadsheet imports from PDF extractions.
// ---------------------------------------------------------------------------
function getDb() {
  try {
    // eslint-disable-next-line global-require
    return require('@goodmen/shared/internal/db').knex;
  } catch (_) {
    return null;
  }
}

/**
 * Stable-JSON SHA-256 of the request fingerprint. Sorts keys recursively so
 * the same logical input always hashes identically (the prompt-cache invariant).
 */
function computeRequestHash(headers, sampleRows) {
  const fingerprint = stableStringify({ headers, sampleRows });
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

async function getCachedMapping(tenantId, requestHash, dbOverride) {
  const db = dbOverride || getDb();
  if (!db || !tenantId || !requestHash) return null;
  try {
    const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const row = await db('load_ai_extractions')
      .where({ tenant_id: tenantId, pdf_hash: requestHash, extraction_method: EXTRACTION_METHOD })
      .where('created_at', '>=', cutoff)
      .select('extracted_data')
      .first();
    return row ? row.extracted_data : null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ai-service] loads-spreadsheet cache read failed:', err.message);
    return null;
  }
}

async function storeCachedMapping(tenantId, requestHash, data, dbOverride) {
  const db = dbOverride || getDb();
  if (!db || !tenantId || !requestHash) return;
  try {
    await db.raw(
      `INSERT INTO load_ai_extractions
         (tenant_id, pdf_hash, extracted_data, extraction_method, created_at)
       VALUES (?, ?, ?::jsonb, ?, now())
       ON CONFLICT (tenant_id, pdf_hash)
       DO UPDATE SET extracted_data    = EXCLUDED.extracted_data,
                     extraction_method = EXCLUDED.extraction_method,
                     created_at        = now()`,
      [tenantId, requestHash, JSON.stringify(data), EXTRACTION_METHOD]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ai-service] loads-spreadsheet cache write failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// System prompt — STABLE: never changes between requests, so it caches well.
// Volatile content (headers + sampleRows) goes in the user message, after the
// last cache_control breakpoint. See shared/prompt-caching.md for rationale.
// ---------------------------------------------------------------------------
function buildSystemPrompt() {
  return `You are a spreadsheet column-mapping assistant for FleetNeuron, a trucking fleet management platform.

You will be given the headers and sample rows of a CSV/XLSX file that contains load (shipment) records exported from another system or filled in by a dispatcher. Your job is to map each source header to FleetNeuron's canonical \`loads\` schema, normalize status enum values, and detect how multi-stop loads are encoded.

Return ONLY a single JSON object. No prose, no markdown fences, no explanation. The JSON MUST conform exactly to this schema:

{
  "columnMapping": {
    "load_number":      { "sourceHeader": string | null, "confidence": number },
    "po_number":        { "sourceHeader": string | null, "confidence": number },
    "rate":             { "sourceHeader": string | null, "confidence": number },
    "broker_name":      { "sourceHeader": string | null, "confidence": number },
    "broker_mc":        { "sourceHeader": string | null, "confidence": number },
    "broker_dot":       { "sourceHeader": string | null, "confidence": number },
    "pickup_city":      { "sourceHeader": string | null, "confidence": number },
    "pickup_state":     { "sourceHeader": string | null, "confidence": number },
    "pickup_zip":       { "sourceHeader": string | null, "confidence": number },
    "pickup_address1":  { "sourceHeader": string | null, "confidence": number },
    "pickup_date":      { "sourceHeader": string | null, "confidence": number },
    "delivery_city":    { "sourceHeader": string | null, "confidence": number },
    "delivery_state":   { "sourceHeader": string | null, "confidence": number },
    "delivery_zip":     { "sourceHeader": string | null, "confidence": number },
    "delivery_address1":{ "sourceHeader": string | null, "confidence": number },
    "delivery_date":    { "sourceHeader": string | null, "confidence": number },
    "driver_name":      { "sourceHeader": string | null, "confidence": number },
    "truck_unit":       { "sourceHeader": string | null, "confidence": number },
    "trailer_unit":     { "sourceHeader": string | null, "confidence": number },
    "status":           { "sourceHeader": string | null, "confidence": number },
    "billing_status":   { "sourceHeader": string | null, "confidence": number },
    "notes":            { "sourceHeader": string | null, "confidence": number }
  },
  "statusEnumMapping":        { "<source value>": "<FN enum value>" },
  "billingStatusEnumMapping": { "<source value>": "<FN enum value>" },
  "multiStopPattern": "single" | "multi_row" | "extra_columns" | "free_text",
  "extraStopColumns": string[],
  "groupByColumn":    string | null,
  "warnings":         [{ "code": string, "message": string }],
  "overallConfidence": number
}

## Field-mapping rules
- Every key in \`columnMapping\` MUST be present, even when no source header matches — set \`sourceHeader: null\` and \`confidence: 0\`.
- \`confidence\` is a float in [0, 1]. Be conservative: 0.95+ only when the header is unambiguous (e.g. "Load #" -> load_number); 0.6-0.85 for synonyms (e.g. "Order #" -> load_number); 0.3-0.5 for fuzzy matches; below 0.3 or null when uncertain.
- \`broker_mc\` is the broker's MC number; \`broker_dot\` is the broker's USDOT number. Map only headers explicitly labeled MC/DOT to these.
- \`rate\` is the line-haul revenue (dollars). Common synonyms: "Rate", "Total", "Line Haul", "Revenue", "Pay".
- \`truck_unit\` and \`trailer_unit\` are equipment IDs — map "Truck #", "Tractor #", "Power Unit" to truck_unit; "Trailer #", "Box #" to trailer_unit.
- Date fields accept any plausible date column for that leg.

## Status enum normalization
FN \`LOAD_STATUSES\`: ${JSON.stringify(LOAD_STATUSES)}
FN \`BILLING_STATUSES\`: ${JSON.stringify(BILLING_STATUSES)}

For each unique value found in the source status column (and likewise the billing-status column), output a mapping to the closest FN enum value. Examples:
  "Delivered" -> "DELIVERED", "Completed" -> "COMPLETED", "On Hold" -> "DRAFT",
  "Cancelled" -> "CANCELLED", "Canceled" -> "CANCELED" (preserve spelling when source matches),
  "TONU" -> "TONU", "In Transit" -> "IN_TRANSIT", "En Route" -> "EN_ROUTE",
  "Paid" -> "PAID", "Paid Out" -> "PAID", "Funded" -> "FUNDED", "Awaiting BOL" -> "PENDING".
If a source value has no plausible FN match, omit it from the mapping and add a warning with code "UNKNOWN_STATUS" or "UNKNOWN_BILLING_STATUS".

## Multi-stop pattern detection
- "single": One pickup + one delivery per row. Standard case.
- "multi_row": Multiple rows share a single load_number / order number, and each row encodes one stop. Set \`groupByColumn\` to the header you'd group on (typically "Load #" / "Order #").
- "extra_columns": Additional columns like \`pickup2_city\`, \`delivery2_state\`, \`stop3_address\` exist for further stops. Populate \`extraStopColumns\` with those header names, in order.
- "free_text": Stops are encoded as free-text in a single field (e.g. "Atlanta, GA -> Dallas, TX -> Phoenix, AZ"). Add a warning with code "FREETEXT_STOPS".

## Output rules
- Do not invent fields not in the schema above.
- \`overallConfidence\` is your gestalt 0-1 estimate of how well this file maps end-to-end. Heavily ambiguous files should be below 0.5.
- Return ONLY the JSON object. No leading/trailing prose. No markdown fences.`;
}

function buildUserMessage(headers, sampleRows, fileName) {
  return `## Spreadsheet to map
${fileName ? `File: ${JSON.stringify(fileName)}\n` : ''}
## Headers
${JSON.stringify(headers)}

## Sample Rows (first ${Math.min(sampleRows.length, MAX_SAMPLE_ROWS)})
${JSON.stringify(sampleRows.slice(0, MAX_SAMPLE_ROWS), null, 2)}`;
}

// ---------------------------------------------------------------------------
// Parse + validate the model output.
// ---------------------------------------------------------------------------
function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

/**
 * Backfill missing fields, type-check confidences, coerce out-of-range values.
 * Always returns a fully-shaped object — callers can rely on every key existing.
 */
function validateAiResult(raw) {
  const result = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

  // columnMapping — backfill EVERY FN field with a null/zero entry if missing.
  const inputMapping = (result.columnMapping && typeof result.columnMapping === 'object') ? result.columnMapping : {};
  const columnMapping = {};
  for (const field of FN_LOAD_FIELDS) {
    const entry = inputMapping[field];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      columnMapping[field] = {
        sourceHeader: typeof entry.sourceHeader === 'string' && entry.sourceHeader.trim() ? entry.sourceHeader : null,
        confidence: clampConfidence(entry.confidence)
      };
    } else {
      columnMapping[field] = { sourceHeader: null, confidence: 0 };
    }
  }

  // statusEnumMapping — only keep entries whose values are in LOAD_STATUSES.
  const statusEnumMapping = filterEnumMapping(result.statusEnumMapping, LOAD_STATUSES);
  const billingStatusEnumMapping = filterEnumMapping(result.billingStatusEnumMapping, BILLING_STATUSES);

  // multiStopPattern — coerce to one of the four valid values.
  const multiStopPattern = MULTI_STOP_PATTERNS.includes(result.multiStopPattern)
    ? result.multiStopPattern
    : 'single';

  // extraStopColumns — array of strings only.
  const extraStopColumns = Array.isArray(result.extraStopColumns)
    ? result.extraStopColumns.filter((s) => typeof s === 'string' && s.trim().length > 0)
    : [];

  // groupByColumn — string or null.
  const groupByColumn = (typeof result.groupByColumn === 'string' && result.groupByColumn.trim().length > 0)
    ? result.groupByColumn
    : null;

  // warnings — array of {code, message} objects.
  const warnings = Array.isArray(result.warnings)
    ? result.warnings
        .filter((w) => w && typeof w === 'object')
        .map((w) => ({
          code: typeof w.code === 'string' ? w.code : 'UNKNOWN',
          message: typeof w.message === 'string' ? w.message : ''
        }))
    : [];

  // overallConfidence — clamp to [0, 1]. Default to 0 (callers can decide policy).
  const overallConfidence = clampConfidence(result.overallConfidence);

  return {
    columnMapping,
    statusEnumMapping,
    billingStatusEnumMapping,
    multiStopPattern,
    extraStopColumns,
    groupByColumn,
    warnings,
    overallConfidence
  };
}

function clampConfidence(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function filterEnumMapping(input, validValues) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const [sourceValue, fnValue] of Object.entries(input)) {
    if (typeof sourceValue !== 'string' || !sourceValue) continue;
    if (typeof fnValue !== 'string') continue;
    const upper = fnValue.trim().toUpperCase();
    if (validValues.includes(upper)) {
      out[sourceValue] = upper;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Express handler.
// ---------------------------------------------------------------------------
async function handleLoadsSpreadsheetImport(req, res, deps) {
  const startedAt = Date.now();
  const { headers, sampleRows, tenantId, fileName } = req.body || {};

  // Validate request shape — 400 on bad input (NOT a fallback case).
  if (!Array.isArray(headers) || headers.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'headers must be a non-empty array of strings',
      code: 'AI_BAD_REQUEST'
    });
  }
  if (!Array.isArray(sampleRows)) {
    return res.status(400).json({
      success: false,
      error: 'sampleRows must be an array',
      code: 'AI_BAD_REQUEST'
    });
  }
  if (sampleRows.length > MAX_SAMPLE_ROWS) {
    return res.status(400).json({
      success: false,
      error: `sampleRows length must be <= ${MAX_SAMPLE_ROWS}`,
      code: 'AI_BAD_REQUEST'
    });
  }
  if (typeof tenantId !== 'string' || !tenantId.trim()) {
    return res.status(400).json({
      success: false,
      error: 'tenantId is required',
      code: 'AI_BAD_REQUEST'
    });
  }

  // Cache lookup BEFORE any AI call.
  // `deps.db` is a test seam — production callers omit it and the handler falls
  // back to the lazily-required `@goodmen/shared/internal/db` knex instance.
  const dbOverride = deps && deps.db;
  const requestHash = computeRequestHash(headers, sampleRows);
  const cached = await getCachedMapping(tenantId, requestHash, dbOverride);
  if (cached) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `loads spreadsheet cache hit (tenant=${tenantId.slice(0, 8)}, headers=${headers.length})`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });
    return res.json({
      success: true,
      fallback: false,
      cacheHit: true,
      data: cached,
      meta: { processingTimeMs, hash: requestHash.slice(0, 12) }
    });
  }

  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env.ANTHROPIC_LOADS_IMPORT_MODEL || 'claude-sonnet-4-20250514';

  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      // System prompt as an array of text blocks — stable content with
      // ephemeral cache_control. This caches the (large) loads-schema
      // description across all imports for ~5 minutes (default TTL).
      system: [
        {
          type: 'text',
          text: buildSystemPrompt(),
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [
        {
          role: 'user',
          content: buildUserMessage(headers, sampleRows, fileName)
        }
      ]
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] loads-spreadsheet upstream error', err.message || err);
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `loads spreadsheet upstream failure (tenant=${tenantId.slice(0, 8)})`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_UNAVAILABLE',
      processingTimeMs
    });
    return res.json({
      success: true,
      fallback: true,
      meta: { reason: 'ai_upstream_error', processingTimeMs }
    });
  }

  const aiContent = message.content?.[0]?.text || '';

  let parsed;
  try {
    parsed = parseAiResponse(aiContent);
  } catch (_parseErr) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `loads spreadsheet parse failure (tenant=${tenantId.slice(0, 8)})`,
      conversationId: null,
      success: true,
      errorCode: 'AI_PARSE_FALLBACK',
      processingTimeMs
    });
    return res.json({
      success: true,
      fallback: true,
      meta: { reason: 'unparseable_model_output', processingTimeMs }
    });
  }

  const validated = validateAiResult(parsed);
  const processingTimeMs = Date.now() - startedAt;

  // Best-effort cache write — never blocks or surfaces errors.
  await storeCachedMapping(tenantId, requestHash, validated, dbOverride);

  logAiInteraction({
    userId: null,
    route: ROUTE,
    message: `loads spreadsheet ok (tenant=${tenantId.slice(0, 8)}, headers=${headers.length}, conf=${validated.overallConfidence.toFixed(2)})`,
    conversationId: null,
    success: true,
    errorCode: null,
    processingTimeMs
  });

  return res.json({
    success: true,
    fallback: false,
    cacheHit: false,
    data: validated,
    meta: {
      model: message.model || model,
      processingTimeMs,
      hash: requestHash.slice(0, 12),
      headersAnalyzed: headers.length,
      sampleRowsAnalyzed: Math.min(sampleRows.length, MAX_SAMPLE_ROWS)
    }
  });
}

module.exports = {
  handleLoadsSpreadsheetImport,
  // Exports for tests
  buildSystemPrompt,
  buildUserMessage,
  parseAiResponse,
  validateAiResult,
  computeRequestHash,
  stableStringify,
  clampConfidence,
  filterEnumMapping,
  FN_LOAD_FIELDS,
  LOAD_STATUSES,
  BILLING_STATUSES,
  MULTI_STOP_PATTERNS,
  MAX_SAMPLE_ROWS,
  EXTRACTION_METHOD
};
