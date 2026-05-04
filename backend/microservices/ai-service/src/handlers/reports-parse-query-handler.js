'use strict';

/**
 * FN-1117 / FN-1149: Natural-language filter parser for the Reports Center.
 *
 * POST /api/ai/reports/parse-query
 *   body: { reportKey, naturalQuery, currentFilters? }
 *   -> { success, filters, unmatchedTokens, confidence, meta }
 *
 * Uses Anthropic Claude Haiku 4.5 with prompt caching on the system prompt +
 * per-report filter schema. The static system prompt and per-report schema
 * blocks are emitted with `cache_control: { type: 'ephemeral' }` so the second
 * call for the same reportKey reports `cache_read_input_tokens > 0`.
 *
 * The model returns a JSON envelope `{ filters, tokenMap, confidence }`.
 * Server-side, every filter is validated against the per-report schema; any
 * key not in the schema, or whose value fails its type check, is dropped and
 * its source tokens (from `tokenMap`) bubble up in `unmatchedTokens`. The
 * structured filters in the UI remain authoritative — this handler only
 * proposes — so a parse failure degrades to `{ filters: {}, unmatchedTokens: [] }`
 * rather than throwing.
 *
 * Permission: requires `reports.view`. Mirrors reports-anomalies-handler for
 * gateway-forwarded auth via loadAuthContext.
 */

const fs = require('node:fs');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/reports/parse-query';
const REQUIRED_PERMISSION = 'reports.view';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'reports-parse-query.md');
const REPORT_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_QUERY_CHARS = 500;
const MAX_UNMATCHED = 12;
const MAX_STRING_ARRAY = 20;
const MAX_STRING_LEN = 100;

// ── per-report filter schemas ──────────────────────────────────────────────
// Keys not listed here for a given report are dropped → unmatchedTokens.
// Keep this in step with goodmen-shared/routes/reports.js v2Builders inputs.

const FIELD = Object.freeze({
  isoDate: () => ({ kind: 'isoDate' }),
  dateRange: () => ({ kind: 'dateRange' }),
  positiveNumber: () => ({ kind: 'positiveNumber' }),
  string: (max = MAX_STRING_LEN) => ({ kind: 'string', min: 1, max }),
  stringArray: (max = MAX_STRING_ARRAY) => ({ kind: 'stringArray', max }),
  bool: () => ({ kind: 'bool' })
});

const COMMON_DATE_FILTERS = Object.freeze({
  date_from: FIELD.isoDate(),
  date_to: FIELD.isoDate(),
  date_range: FIELD.dateRange()
});

const REPORT_FILTER_SCHEMAS = Object.freeze({
  'total-revenue': Object.freeze({
    ...COMMON_DATE_FILTERS,
    status: FIELD.stringArray()
  }),
  'rate-per-mile': Object.freeze({
    ...COMMON_DATE_FILTERS,
    driver_name: FIELD.string(),
    min_rate: FIELD.positiveNumber(),
    max_rate: FIELD.positiveNumber()
  }),
  'revenue-by-dispatcher': Object.freeze({
    ...COMMON_DATE_FILTERS,
    dispatcher_name: FIELD.string(),
    exclude_dispatcher: FIELD.stringArray(),
    status: FIELD.stringArray(),
    min_revenue: FIELD.positiveNumber(),
    max_revenue: FIELD.positiveNumber()
  }),
  'revenue-by-driver': Object.freeze({
    ...COMMON_DATE_FILTERS,
    driver_name: FIELD.string(),
    exclude_driver: FIELD.stringArray(),
    exclude_team_leads: FIELD.bool(),
    status: FIELD.stringArray(),
    min_revenue: FIELD.positiveNumber(),
    max_revenue: FIELD.positiveNumber()
  }),
  'payment-summary': Object.freeze({
    ...COMMON_DATE_FILTERS,
    payment_status: FIELD.stringArray(),
    customer_name: FIELD.string()
  }),
  'gross-profit': Object.freeze({
    ...COMMON_DATE_FILTERS,
    min_margin_pct: FIELD.positiveNumber(),
    status: FIELD.stringArray()
  }),
  'gross-profit-per-load': Object.freeze({
    ...COMMON_DATE_FILTERS,
    driver_name: FIELD.string(),
    min_profit: FIELD.positiveNumber(),
    max_profit: FIELD.positiveNumber()
  }),
  'profit-loss': Object.freeze({
    ...COMMON_DATE_FILTERS,
    cost_category: FIELD.stringArray()
  }),
  'direct-load-profit': Object.freeze({
    ...COMMON_DATE_FILTERS,
    driver_name: FIELD.string(),
    customer_name: FIELD.string()
  }),
  'fully-loaded-profit': Object.freeze({
    ...COMMON_DATE_FILTERS,
    driver_name: FIELD.string()
  })
});

let cachedSystemPrompt = null;
function loadSystemPrompt() {
  if (cachedSystemPrompt === null) {
    cachedSystemPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');
  }
  return cachedSystemPrompt;
}

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  return anthropicClient;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hasReportsView(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  return perms.includes(REQUIRED_PERMISSION);
}

// ── per-field validators ──────────────────────────────────────────────────

function validateIsoDate(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!ISO_DATE_RE.test(trimmed)) return undefined;
  const d = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  if (d.toISOString().slice(0, 10) !== trimmed) return undefined;
  return trimmed;
}

function validateDateRange(value) {
  if (typeof value !== 'string') return undefined;
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (!m) return undefined;
  const from = validateIsoDate(m[1]);
  const to = validateIsoDate(m[2]);
  if (!from || !to) return undefined;
  if (from > to) return undefined;
  return `${from}..${to}`;
}

function validatePositiveNumber(value) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return num;
}

function validateString(value, cfg) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length < cfg.min || trimmed.length > cfg.max) return undefined;
  return trimmed;
}

function validateStringArray(value, cfg) {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length >= 1 && v.length <= MAX_STRING_LEN);
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, cfg.max);
}

function validateBool(value) {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function validateField(value, cfg) {
  switch (cfg.kind) {
    case 'isoDate': return validateIsoDate(value);
    case 'dateRange': return validateDateRange(value);
    case 'positiveNumber': return validatePositiveNumber(value);
    case 'string': return validateString(value, cfg);
    case 'stringArray': return validateStringArray(value, cfg);
    case 'bool': return validateBool(value);
    default: return undefined;
  }
}

function describeType(cfg) {
  switch (cfg.kind) {
    case 'isoDate': return 'ISO date "YYYY-MM-DD"';
    case 'dateRange': return 'ISO date range "YYYY-MM-DD..YYYY-MM-DD"';
    case 'positiveNumber': return 'positive number';
    case 'string': return `string (${cfg.min}-${cfg.max} chars)`;
    case 'stringArray': return `array of strings (max ${cfg.max} items, each 1-${MAX_STRING_LEN} chars)`;
    case 'bool': return 'boolean (true|false)';
    default: return cfg.kind;
  }
}

// ── prompt building (cached + per-call) ───────────────────────────────────

function buildSchemaBlock(reportKey, schema) {
  const lines = Object.entries(schema).map(([key, cfg]) => `- ${key}: ${describeType(cfg)}`);
  return [
    `Report key: ${reportKey}`,
    'Allowed filter schema (use ONLY these keys):',
    ...lines
  ].join('\n');
}

function buildSystemBlocks(reportKey, schema) {
  // Two cache_control breakpoints: the static system prompt and the
  // per-report schema. Both are stable across requests for the same
  // reportKey, so the second call should report cache_read_input_tokens > 0.
  return [
    {
      type: 'text',
      text: loadSystemPrompt(),
      cache_control: { type: 'ephemeral' }
    },
    {
      type: 'text',
      text: buildSchemaBlock(reportKey, schema),
      cache_control: { type: 'ephemeral' }
    }
  ];
}

function buildUserMessage({ naturalQuery, currentFilters, todayIso }) {
  return JSON.stringify({
    today: todayIso,
    currentFilters: currentFilters || {},
    naturalQuery
  });
}

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

// ── output validation ─────────────────────────────────────────────────────

function collectTokens(tokenMap, key, sink) {
  const tokens = (tokenMap && tokenMap[key]) || [];
  if (!Array.isArray(tokens)) return;
  for (const t of tokens) {
    if (typeof t !== 'string') continue;
    const trimmed = t.trim();
    if (!trimmed) continue;
    sink.add(trimmed);
    if (sink.size >= MAX_UNMATCHED) return;
  }
}

function validateFilters({ raw, schema, tokenMap }) {
  const out = {};
  const unmatched = new Set();

  if (isPlainObject(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const cfg = schema[key];
      if (!cfg) {
        // Unknown key → drop, surface its tokens
        collectTokens(tokenMap, key, unmatched);
        continue;
      }
      const cleaned = validateField(value, cfg);
      if (cleaned !== undefined) {
        out[key] = cleaned;
      } else {
        // Schema-recognised key but value failed validation → also unmatched
        collectTokens(tokenMap, key, unmatched);
      }
    }
  }

  // Model may surface tokens it couldn't map to any filter under the
  // sentinel "_unmatched" key. Always merge those in.
  collectTokens(tokenMap, '_unmatched', unmatched);

  return {
    filters: out,
    unmatchedTokens: Array.from(unmatched).slice(0, MAX_UNMATCHED)
  };
}

function clampConfidence(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function validateRequest(body) {
  if (!isPlainObject(body)) {
    return { error: 'request body must be a JSON object' };
  }
  const reportKey = typeof body.reportKey === 'string' ? body.reportKey.trim() : '';
  if (!reportKey) {
    return { error: 'reportKey is required' };
  }
  if (!REPORT_KEY_PATTERN.test(reportKey)) {
    return { error: 'reportKey must be alphanumeric with dashes/underscores' };
  }
  const naturalQuery = typeof body.naturalQuery === 'string' ? body.naturalQuery.trim() : '';
  if (!naturalQuery) {
    return { error: 'naturalQuery is required' };
  }
  if (naturalQuery.length > MAX_QUERY_CHARS) {
    return { error: `naturalQuery must be ${MAX_QUERY_CHARS} characters or less` };
  }
  if (body.currentFilters !== undefined
      && body.currentFilters !== null
      && !isPlainObject(body.currentFilters)) {
    return { error: 'currentFilters must be an object when provided' };
  }
  return {
    reportKey,
    naturalQuery,
    currentFilters: body.currentFilters || null
  };
}

function emptyResult() {
  return { filters: {}, unmatchedTokens: [], confidence: 0 };
}

async function handleReportsParseQuery(req, res, deps) {
  const startedAt = Date.now();
  const userId = req.user && req.user.id ? req.user.id : null;

  if (!hasReportsView(req.user)) {
    logAiInteraction({
      userId,
      route: ROUTE,
      message: 'parse-query forbidden',
      conversationId: null,
      success: false,
      errorCode: 'AI_FORBIDDEN',
      processingTimeMs: Date.now() - startedAt
    });
    return res.status(403).json({
      success: false,
      error: 'Forbidden: insufficient permission',
      code: 'AI_FORBIDDEN',
      required: REQUIRED_PERMISSION
    });
  }

  const validated = validateRequest(req.body);
  if (validated.error) {
    return res.status(400).json({
      success: false,
      error: validated.error,
      code: 'AI_BAD_REQUEST'
    });
  }

  const { reportKey, naturalQuery, currentFilters } = validated;
  const schema = REPORT_FILTER_SCHEMAS[reportKey];
  if (!schema) {
    return res.status(400).json({
      success: false,
      error: `Unknown reportKey: ${reportKey}`,
      code: 'AI_UNKNOWN_REPORT'
    });
  }

  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env.ANTHROPIC_REPORTS_NLQ_MODEL || 'claude-haiku-4-5-20251001';
  const todayIso = new Date().toISOString().slice(0, 10);

  if (!client || (!process.env.ANTHROPIC_API_KEY && !(deps && deps.anthropic))) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId,
      route: ROUTE,
      message: `parse-query no-ai fallback reportKey=${reportKey}`,
      conversationId: null,
      success: true,
      errorCode: 'AI_UNCONFIGURED',
      processingTimeMs
    });
    return res.json({
      success: true,
      fallback: true,
      ...emptyResult(),
      meta: { reportKey, reason: 'ai_unconfigured', processingTimeMs }
    });
  }

  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: 768,
      temperature: 0,
      system: buildSystemBlocks(reportKey, schema),
      messages: [
        {
          role: 'user',
          content: buildUserMessage({ naturalQuery, currentFilters, todayIso })
        }
      ]
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] parse-query upstream error', err.message || err);
    logAiInteraction({
      userId,
      route: ROUTE,
      message: `parse-query upstream failure reportKey=${reportKey}`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_UNAVAILABLE',
      processingTimeMs
    });
    return res.json({
      success: true,
      fallback: true,
      ...emptyResult(),
      meta: { reportKey, reason: 'ai_upstream_error', processingTimeMs }
    });
  }

  const processingTimeMs = Date.now() - startedAt;
  const aiContent = message.content?.[0]?.text || '';
  const aiModel = message.model || model;
  const usage = message.usage || {};
  const cacheReadTokens = Number(usage.cache_read_input_tokens || 0);
  const cacheWriteTokens = Number(usage.cache_creation_input_tokens || 0);

  let parsed;
  try {
    parsed = parseAiResponse(aiContent);
  } catch (_parseErr) {
    logAiInteraction({
      userId,
      route: ROUTE,
      message: `parse-query parse fallback reportKey=${reportKey}`,
      conversationId: null,
      success: true,
      errorCode: 'AI_PARSE_FALLBACK',
      processingTimeMs
    });
    return res.json({
      success: true,
      fallback: true,
      ...emptyResult(),
      meta: {
        reportKey,
        reason: 'unparseable_model_output',
        model: aiModel,
        cacheReadTokens,
        cacheWriteTokens,
        processingTimeMs
      }
    });
  }

  const rawFilters = isPlainObject(parsed.filters) ? parsed.filters : (isPlainObject(parsed) ? parsed : {});
  const tokenMap = isPlainObject(parsed.tokenMap) ? parsed.tokenMap : {};
  const modelConfidence = clampConfidence(parsed.confidence);

  const { filters, unmatchedTokens } = validateFilters({
    raw: rawFilters,
    schema,
    tokenMap
  });

  // If the model didn't supply confidence, derive a coarse estimate from
  // the matched/requested ratio. Empty parses confidently report 0.
  let confidence;
  if (modelConfidence !== null) {
    confidence = modelConfidence;
  } else {
    const matched = Object.keys(filters).length;
    const requested = Object.keys(rawFilters).length;
    confidence = requested === 0 ? 0 : Math.max(0, Math.min(1, matched / requested));
  }

  logAiInteraction({
    userId,
    route: ROUTE,
    message: `parse-query ok reportKey=${reportKey} matched=${Object.keys(filters).length} unmatched=${unmatchedTokens.length}`,
    conversationId: null,
    success: true,
    errorCode: null,
    processingTimeMs
  });

  return res.json({
    success: true,
    fallback: false,
    filters,
    unmatchedTokens,
    confidence,
    meta: {
      reportKey,
      model: aiModel,
      cacheReadTokens,
      cacheWriteTokens,
      processingTimeMs
    }
  });
}

module.exports = {
  handleReportsParseQuery,
  validateRequest,
  validateFilters,
  validateField,
  validateIsoDate,
  validateDateRange,
  validatePositiveNumber,
  validateStringArray,
  buildSystemBlocks,
  buildSchemaBlock,
  buildUserMessage,
  parseAiResponse,
  loadSystemPrompt,
  hasReportsView,
  describeType,
  REPORT_FILTER_SCHEMAS,
  REQUIRED_PERMISSION,
  REPORT_KEY_PATTERN,
  MAX_UNMATCHED,
  MAX_QUERY_CHARS
};
