'use strict';

/**
 * FN-1123: Reports narrative generator (Anthropic Claude Sonnet 4.6).
 *
 * POST /api/ai/reports/:reportKey/narrative
 *
 * Produces a 2-3 sentence narrative for a financial report. Uses Anthropic
 * **prompt caching** on two static blocks:
 *   1. The role/style system prompt (shared by all report keys).
 *   2. A per-report schema block (keyed by `reportKey`), describing the shape
 *      of `cards`, `data` rows, and `filters` for that specific report.
 * The user message contains the live, dynamic payload (cards, data, filters,
 * priorPeriod) and is NOT cached.
 *
 * Auth: ai-service handlers receive requests via the gateway, which decodes
 * the JWT and forwards the user. We additionally verify locally (mirroring
 * `reporting-service/routes/insights.js#authenticate`) and gate by role.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

// jsonwebtoken is not a direct dependency of ai-service. The gateway normally
// decodes the JWT before proxying and attaches `req.user`, so the local-verify
// path is a defensive fallback. We require lazily to avoid hard-coupling and
// to keep the module loadable in test environments where jwt is absent.
function tryRequireJwt() {
  try {
    return require('jsonwebtoken');
  } catch (_err) {
    return null;
  }
}

const ROUTE = '/reports/:reportKey/narrative';
const REPORT_KEY_RE = /^[a-z0-9-]{1,64}$/i;
const MAX_BODY_BYTES = 256 * 1024;
const ALLOWED_ROLES = ['admin', 'manager', 'owner', 'dispatcher'];

// FN-1173: variant control. The on-screen panel (FN-1114, FN-1146) uses the
// short variant (2–3 sentences). The branded-PDF export (FN-1118) opts in to
// the long variant for a more substantive print narrative. Variant is read
// from `?variant=` so the request body stays identical and prompt-cacheable
// across both call sites.
const VARIANTS = Object.freeze({
  short: { form: 'short', maxTokens: 400 },
  long:  { form: 'long',  maxTokens: 900 }
});
const DEFAULT_VARIANT = 'short';

const SYSTEM_PROMPT = "You are FleetNeuron's reports analyst. Given a financial " +
  "report's KPI cards, raw data rows, active filters, and prior-period values, " +
  "write a narrative explaining the headline movement: what changed, by how " +
  "much (with %), and the most plausible driver. Be specific and quantitative. " +
  "No greetings, no caveats, no markdown — plain prose only.\n\n" +
  "The user message includes a `form` key controlling output length:\n" +
  "- form=\"short\": 2–3 sentences, single paragraph (default; for on-screen panels).\n" +
  "- form=\"long\": 5–8 sentences across 1–2 paragraphs (for printed/PDF reports). " +
  "Cover the same headline movement and driver, but add comparisons against " +
  "the prior period for the secondary cards and call out 1–2 concrete row-level " +
  "examples from `data` that exemplify the trend. Stay quantitative.";

const REPORT_SCHEMAS = Object.freeze({
  'revenue-by-driver':
    'Report: revenue-by-driver. ' +
    'cards: array of { id, label, value (number, dollars), delta (number, vs prior period), unit }. ' +
    'data: array of rows { driverId, driverName, loadsCompleted (int), grossRevenue (number, dollars), avgRpm (number, $/mi), priorRevenue (number) }. ' +
    'filters: { dateFrom (ISO), dateTo (ISO), driverIds (array), region (string) }. ' +
    'priorPeriod: same shape as cards, representing the immediately preceding period of equal length.',
  'fuel-spend-by-truck':
    'Report: fuel-spend-by-truck. ' +
    'cards: array of { id, label, value (number, dollars or gallons), delta (number), unit }. ' +
    'data: array of rows { truckId, unitNumber, gallons (number), totalSpend (number, dollars), avgPricePerGallon (number), milesDriven (number), mpg (number) }. ' +
    'filters: { dateFrom (ISO), dateTo (ISO), truckIds (array), fuelCardProvider (string) }. ' +
    'priorPeriod: same-shape comparison for the previous period.',
  'load-margin':
    'Report: load-margin. ' +
    'cards: array of { id, label, value (number), delta (number), unit (e.g. "$" or "%") }. ' +
    'data: array of rows { loadId, loadNumber, customerName, revenue (number), directCost (number), margin (number, dollars), marginPct (number, 0–100), pickupDate (ISO), deliveryDate (ISO) }. ' +
    'filters: { dateFrom (ISO), dateTo (ISO), customerIds (array), minMarginPct (number) }. ' +
    'priorPeriod: same-shape comparison for the previous period.'
});

const GENERIC_SCHEMA =
  'Report schema is generic. ' +
  'cards: array of { id, label, value (number), delta (number, vs prior period), unit (string) }. ' +
  'data: array of arbitrary row objects relevant to the report. ' +
  'filters: object of active filter key/value pairs. ' +
  'priorPeriod: same shape as cards (or empty), representing the immediately preceding equal-length period. ' +
  'When fields are missing, infer the most plausible explanation from cards and priorPeriod alone.';

function buildReportSchemaBlock(reportKey) {
  if (Object.prototype.hasOwnProperty.call(REPORT_SCHEMAS, reportKey)) {
    return REPORT_SCHEMAS[reportKey];
  }
  return GENERIC_SCHEMA;
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

/**
 * Resolve req.user from either (a) the gateway-attached object or
 * (b) a Bearer JWT we verify locally. Mirrors the pattern in
 * reporting-service/routes/insights.js#authenticate.
 *
 * Returns { user } on success or { error: { status, code, message } }.
 */
function resolveUser(req) {
  if (req.user && typeof req.user === 'object') {
    return { user: req.user };
  }
  const authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return { error: { status: 403, code: 'AI_FORBIDDEN', message: 'Missing or invalid bearer token' } };
  }
  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET || 'dev_secret';
  const jwt = tryRequireJwt();
  if (!jwt) {
    // jsonwebtoken not installed in this service: we cannot verify the bearer
    // locally. The gateway is supposed to do this before proxying — refuse.
    return { error: { status: 403, code: 'AI_FORBIDDEN', message: 'Cannot verify bearer token' } };
  }
  try {
    const payload = jwt.verify(token, secret);
    if (!payload || typeof payload !== 'object') {
      return { error: { status: 403, code: 'AI_FORBIDDEN', message: 'Invalid token payload' } };
    }
    return { user: payload };
  } catch (_err) {
    return { error: { status: 403, code: 'AI_FORBIDDEN', message: 'Invalid or expired token' } };
  }
}

function hasAllowedRole(user) {
  const role = ((user && user.role) || '').toString().trim().toLowerCase();
  return ALLOWED_ROLES.includes(role);
}

function buildUserMessage({ cards, data, filters, priorPeriod, form }) {
  // Truncate the data array if the JSON would otherwise be huge. The handler-
  // level 256KB cap (above) is the hard limit; here we just keep the prompt
  // body at a reasonable size so the model can focus on the cards/priorPeriod.
  const MAX_DATA_ROWS = 200;
  const safeData = Array.isArray(data) ? data.slice(0, MAX_DATA_ROWS) : [];
  return JSON.stringify({
    form: form || DEFAULT_VARIANT,
    cards: cards == null ? [] : cards,
    data: safeData,
    dataTruncated: Array.isArray(data) && data.length > MAX_DATA_ROWS,
    filters: filters == null ? {} : filters,
    priorPeriod: priorPeriod == null ? {} : priorPeriod
  });
}

/**
 * FN-1173: Resolve the requested variant from `?variant=` (string or array).
 * Defaults to 'short' for any unrecognised or missing value so existing
 * callers (FN-1114 panel) keep their current behaviour.
 */
function resolveVariant(req) {
  const raw = req && req.query && req.query.variant;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return VARIANTS[DEFAULT_VARIANT];
  const normalised = value.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(VARIANTS, normalised)) {
    return VARIANTS[normalised];
  }
  return VARIANTS[DEFAULT_VARIANT];
}

async function handleReportsNarrative(req, res, deps) {
  const startedAt = Date.now();

  // 1. Validate reportKey path param.
  const reportKey = req.params && req.params.reportKey;
  if (typeof reportKey !== 'string' || !REPORT_KEY_RE.test(reportKey)) {
    return res.status(400).json({
      success: false,
      error: 'reportKey must match /^[a-z0-9-]{1,64}$/i',
      code: 'AI_BAD_REQUEST'
    });
  }

  // 2. RBAC gate.
  const auth = resolveUser(req);
  if (auth.error) {
    return res.status(auth.error.status).json({
      success: false,
      error: auth.error.message,
      code: auth.error.code
    });
  }
  if (!hasAllowedRole(auth.user)) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: insufficient role',
      code: 'AI_FORBIDDEN'
    });
  }

  // 3. Validate + size-check body.
  const body = req.body == null ? {} : req.body;
  if (!isPlainObject(body)) {
    return res.status(400).json({
      success: false,
      error: 'request body must be a JSON object',
      code: 'AI_BAD_REQUEST'
    });
  }
  let bodySize = 0;
  try {
    bodySize = Buffer.byteLength(JSON.stringify(body), 'utf8');
  } catch (_err) {
    bodySize = MAX_BODY_BYTES + 1; // unserialisable -> reject
  }
  if (bodySize > MAX_BODY_BYTES) {
    return res.status(413).json({
      success: false,
      error: `request body exceeds ${MAX_BODY_BYTES} bytes`,
      code: 'AI_PAYLOAD_TOO_LARGE'
    });
  }

  const cards = body.cards;
  const data = body.data;
  const filters = body.filters;
  const priorPeriod = body.priorPeriod;

  if (cards != null && !Array.isArray(cards)) {
    return res.status(400).json({
      success: false,
      error: 'cards must be an array when provided',
      code: 'AI_BAD_REQUEST'
    });
  }
  if (data != null && !Array.isArray(data)) {
    return res.status(400).json({
      success: false,
      error: 'data must be an array when provided',
      code: 'AI_BAD_REQUEST'
    });
  }
  if (filters != null && !isPlainObject(filters)) {
    return res.status(400).json({
      success: false,
      error: 'filters must be an object when provided',
      code: 'AI_BAD_REQUEST'
    });
  }
  if (priorPeriod != null && !isPlainObject(priorPeriod) && !Array.isArray(priorPeriod)) {
    return res.status(400).json({
      success: false,
      error: 'priorPeriod must be an object or array when provided',
      code: 'AI_BAD_REQUEST'
    });
  }

  // 4. Anthropic call with prompt caching on the two static blocks.
  // The variant only affects max_tokens and the per-call user message; the
  // cached system blocks stay byte-identical so the cache hit-rate is the
  // same regardless of variant.
  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env.ANTHROPIC_NARRATIVE_MODEL || 'claude-sonnet-4-6';
  const userId = (auth.user && (auth.user.id || auth.user.userId || auth.user.sub)) || null;
  const variant = resolveVariant(req);

  try {
    const message = await client.messages.create({
      model,
      max_tokens: variant.maxTokens,
      temperature: 0.2,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }
        },
        {
          type: 'text',
          text: buildReportSchemaBlock(reportKey),
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [
        {
          role: 'user',
          content: buildUserMessage({ cards, data, filters, priorPeriod, form: variant.form })
        }
      ]
    });

    const processingTimeMs = Date.now() - startedAt;
    const narrative = (message.content?.[0]?.text || '').trim();

    logAiInteraction({
      userId,
      route: ROUTE,
      message: `Reports narrative ok reportKey=${reportKey}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json({
      success: true,
      narrative,
      generatedAt: new Date().toISOString(),
      meta: {
        model: message.model || model,
        variant: variant.form,
        cacheReadTokens: (message.usage && message.usage.cache_read_input_tokens) || 0,
        cacheCreationTokens: (message.usage && message.usage.cache_creation_input_tokens) || 0,
        processingTimeMs
      }
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] reports narrative upstream error', err.message || err);
    logAiInteraction({
      userId,
      route: ROUTE,
      message: `Reports narrative upstream failure reportKey=${reportKey}`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_UNAVAILABLE',
      processingTimeMs
    });
    return res.status(502).json({
      success: false,
      error: 'AI upstream unavailable',
      code: 'AI_UNAVAILABLE',
      meta: { processingTimeMs }
    });
  }
}

module.exports = {
  handleReportsNarrative,
  buildReportSchemaBlock,
  buildUserMessage,
  resolveVariant,
  SYSTEM_PROMPT,
  REPORT_KEY_RE,
  ALLOWED_ROLES,
  MAX_BODY_BYTES,
  VARIANTS,
  DEFAULT_VARIANT
};
