'use strict';

/**
 * FN-800: Natural-language query parser for the loads page.
 * Accepts a free-text query and uses Claude Haiku to extract a structured
 * filter object matching ALLOWED_FILTERS. Returns { fallback: true } when
 * the model output cannot be parsed or yields no usable fields, so the
 * backend can fall back to a keyword search without surfacing an error.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/loads/nlq';

const BILLING_STATUSES = ['PENDING', 'BILLED', 'PAID', 'CANCELED'];
const DELIVERY_STATUSES = ['IN_TRANSIT', 'DELIVERED', 'ASSIGNED', 'CANCELED'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATE_RE = /^[A-Z]{2}$/;

// Schema used by both the prompt and the validator. Keep these names in sync
// with the loads-search backend contract.
const ALLOWED_FILTERS = Object.freeze({
  driver_name: { type: 'string', min: 1, max: 100 },
  broker_name: { type: 'string', min: 1, max: 100 },
  load_number: { type: 'string', min: 1, max: 64 },
  billing_status: { type: 'enum', values: BILLING_STATUSES, upper: true },
  delivery_status: { type: 'enum', values: DELIVERY_STATUSES, upper: true },
  pickup_state: { type: 'state' },
  delivery_state: { type: 'state' },
  pickup_city: { type: 'string', min: 1, max: 80 },
  delivery_city: { type: 'string', min: 1, max: 80 },
  rate_min: { type: 'positiveNumber' },
  rate_max: { type: 'positiveNumber' },
  date_from: { type: 'isoDate' },
  date_to: { type: 'isoDate' },
});

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

function buildSystemPrompt() {
  return `You convert a fleet manager's natural-language question about loads into a JSON filter object.

Return ONLY a JSON object. No prose, no markdown fences, no explanation.
Omit any field you cannot confidently infer from the query. An empty object {} is valid.

Allowed fields (use these exact names — any other field will be discarded):
- driver_name: string, 1-100 chars (driver's name or partial name)
- broker_name: string, 1-100 chars
- load_number: string, 1-64 chars
- billing_status: one of "PENDING" | "BILLED" | "PAID" | "CANCELED"
- delivery_status: one of "IN_TRANSIT" | "DELIVERED" | "ASSIGNED" | "CANCELED"
- pickup_state: 2-letter uppercase US state code (e.g. "TX")
- delivery_state: 2-letter uppercase US state code
- pickup_city: string, 1-80 chars
- delivery_city: string, 1-80 chars
- rate_min: positive number (dollars; strip $ and commas)
- rate_max: positive number
- date_from: ISO date "YYYY-MM-DD"
- date_to: ISO date "YYYY-MM-DD"

Rules:
- If the user mentions a dollar amount with "over" / "more than" / "above" / "at least", populate rate_min.
- "under" / "less than" / "below" / "at most" populates rate_max.
- Relative date ranges like "last month", "this week", "yesterday" must be resolved to concrete YYYY-MM-DD values for date_from and date_to.
- If the query is gibberish or has no extractable filter, return {}.`;
}

function validateStringField(value, cfg) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length < cfg.min || trimmed.length > cfg.max) return undefined;
  return trimmed;
}

function validateEnumField(value, cfg) {
  if (typeof value !== 'string') return undefined;
  const upper = cfg.upper ? value.trim().toUpperCase() : value.trim();
  if (!cfg.values.includes(upper)) return undefined;
  return upper;
}

function validateStateField(value) {
  if (typeof value !== 'string') return undefined;
  const upper = value.trim().toUpperCase();
  if (!STATE_RE.test(upper)) return undefined;
  return upper;
}

function validatePositiveNumber(value) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return num;
}

function validateIsoDate(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!ISO_DATE_RE.test(trimmed)) return undefined;
  // Reject impossible dates like 2025-13-40.
  const d = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  if (d.toISOString().slice(0, 10) !== trimmed) return undefined;
  return trimmed;
}

function validateFilters(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of Object.keys(ALLOWED_FILTERS)) {
    if (!(key in raw)) continue;
    const cfg = ALLOWED_FILTERS[key];
    const value = raw[key];
    let cleaned;
    switch (cfg.type) {
      case 'string':
        cleaned = validateStringField(value, cfg);
        break;
      case 'enum':
        cleaned = validateEnumField(value, cfg);
        break;
      case 'state':
        cleaned = validateStateField(value);
        break;
      case 'positiveNumber':
        cleaned = validatePositiveNumber(value);
        break;
      case 'isoDate':
        cleaned = validateIsoDate(value);
        break;
      default:
        cleaned = undefined;
    }
    if (cleaned !== undefined) {
      out[key] = cleaned;
    }
  }
  return out;
}

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

async function handleLoadsNlq(req, res, deps) {
  const startedAt = Date.now();
  const { query } = req.body || {};

  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({
      success: false,
      error: 'query string is required',
      code: 'AI_BAD_REQUEST',
    });
  }

  const trimmedQuery = query.trim().slice(0, 500);
  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env.ANTHROPIC_NLQ_MODEL || 'claude-haiku-4-5-20251001';

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 512,
      temperature: 0,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: trimmedQuery }],
    });

    const processingTimeMs = Date.now() - startedAt;
    const aiContent = message.content?.[0]?.text || '{}';

    let parsed;
    try {
      parsed = parseAiResponse(aiContent);
    } catch (_parseErr) {
      logAiInteraction({
        userId: null,
        route: ROUTE,
        message: `Loads NLQ parse failure: "${trimmedQuery}"`,
        conversationId: null,
        success: true,
        errorCode: 'AI_PARSE_FALLBACK',
        processingTimeMs,
      });
      return res.json({
        success: true,
        fallback: true,
        meta: { reason: 'unparseable_model_output' },
      });
    }

    const filters = validateFilters(parsed);

    if (Object.keys(filters).length === 0) {
      logAiInteraction({
        userId: null,
        route: ROUTE,
        message: `Loads NLQ no-filters fallback: "${trimmedQuery}"`,
        conversationId: null,
        success: true,
        errorCode: 'AI_EMPTY_FALLBACK',
        processingTimeMs,
      });
      return res.json({
        success: true,
        fallback: true,
        meta: { reason: 'no_filters_extracted' },
      });
    }

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Loads NLQ ok (${Object.keys(filters).length} fields): "${trimmedQuery}"`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs,
    });

    return res.json({
      success: true,
      filters,
      meta: {
        model: message.model || model,
        processingTimeMs,
      },
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] loads NLQ error', err.message || err);

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Loads NLQ upstream failure: "${trimmedQuery}"`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_UNAVAILABLE',
      processingTimeMs,
    });

    // Upstream Claude failures still return 200 + fallback so the loads
    // endpoint can gracefully degrade to a keyword search.
    return res.json({
      success: true,
      fallback: true,
      meta: { reason: 'ai_upstream_error' },
    });
  }
}

module.exports = {
  handleLoadsNlq,
  ALLOWED_FILTERS,
  // Exported for testing
  validateFilters,
  parseAiResponse,
  buildSystemPrompt,
};
