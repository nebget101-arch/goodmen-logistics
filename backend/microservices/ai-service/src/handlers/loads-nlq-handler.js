'use strict';

/**
 * FN-801: Natural-language → structured filters for load search (logistics NLQ endpoint).
 */

const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/loads/nlq';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LOAD_STATUSES = [
  'DRAFT', 'NEW', 'CANCELLED', 'CANCELED', 'TONU', 'DISPATCHED', 'EN_ROUTE', 'PICKED_UP',
  'IN_TRANSIT', 'DELIVERED', 'COMPLETED'
];
const BILLING_STATUSES = [
  'PENDING', 'CANCELLED', 'CANCELED', 'BOL_RECEIVED', 'INVOICED', 'SENT_TO_FACTORING', 'FUNDED', 'PAID'
];

function parseAiJson(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  return JSON.parse(cleaned);
}

function trimStr(v, max) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (!t) return '';
  return t.slice(0, max);
}

function normalizeEnum(v) {
  return trimStr(v, 80).toUpperCase().replace(/[\s-]+/g, '_');
}

function validateIsoDate(v) {
  const s = trimStr(v, 12);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return '';
  return s;
}

/**
 * Normalize OpenAI JSON into safe filters or signal keyword fallback.
 */
function normalizeNlqAiOutput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { fallback: true, reason: 'invalid_root' };
  }
  if (raw.fallback === true) {
    return { fallback: true, reason: 'model_fallback' };
  }
  const filtersRaw =
    raw.filters && typeof raw.filters === 'object' && !Array.isArray(raw.filters) ? raw.filters : raw;

  const out = {};
  const st = normalizeEnum(filtersRaw.status);
  if (st && LOAD_STATUSES.includes(st)) out.status = st;
  const bs = normalizeEnum(filtersRaw.billingStatus);
  if (bs && BILLING_STATUSES.includes(bs)) out.billingStatus = bs;

  const did = trimStr(filtersRaw.driverId, 64);
  if (did && UUID_RE.test(did)) out.driverId = did;
  const bid = trimStr(filtersRaw.brokerId, 64);
  if (bid && UUID_RE.test(bid)) out.brokerId = bid;

  const q = trimStr(filtersRaw.q, 200);
  if (q) out.q = q;

  const df = validateIsoDate(filtersRaw.dateFrom);
  if (df) out.dateFrom = df;
  const dt = validateIsoDate(filtersRaw.dateTo);
  if (dt) out.dateTo = dt;

  const lnc = trimStr(filtersRaw.loadNumberContains, 80);
  if (lnc) out.loadNumberContains = lnc;
  const bnc = trimStr(filtersRaw.brokerNameContains, 120);
  if (bnc) out.brokerNameContains = bnc;
  const dnc = trimStr(filtersRaw.driverNameContains, 120);
  if (dnc) out.driverNameContains = dnc;

  const ps = trimStr(filtersRaw.pickupState, 4).toUpperCase();
  if (/^[A-Z]{2}$/.test(ps)) out.pickupState = ps;
  const ds = trimStr(filtersRaw.deliveryState, 4).toUpperCase();
  if (/^[A-Z]{2}$/.test(ds)) out.deliveryState = ds;

  const pc = trimStr(filtersRaw.pickupCity, 80);
  if (pc) out.pickupCity = pc;
  const dcity = trimStr(filtersRaw.deliveryCity, 80);
  if (dcity) out.deliveryCity = dcity;

  const rmin = typeof filtersRaw.rateMin === 'number' ? filtersRaw.rateMin : parseFloat(filtersRaw.rateMin);
  if (Number.isFinite(rmin) && rmin > 0) out.rateMin = rmin;
  const rmax = typeof filtersRaw.rateMax === 'number' ? filtersRaw.rateMax : parseFloat(filtersRaw.rateMax);
  if (Number.isFinite(rmax) && rmax > 0) out.rateMax = rmax;

  if (Object.keys(out).length === 0) {
    return { fallback: true, reason: 'no_usable_filters' };
  }
  return { fallback: false, filters: out };
}

function buildSystemPrompt(todayIso) {
  return `You convert natural language about trucking loads into structured JSON filters for a TMS.

Today's date (UTC): ${todayIso}

Respond with JSON only (no markdown). Shape:
{ "fallback": true }
OR
{ "fallback": false, "filters": { ... } }

Use "fallback": true when the text is unrelated, gibberish, or cannot be mapped reliably.

When "fallback" is false, "filters" must include at least one valid field.

Allowed keys inside "filters" (all optional; omit unknown keys):
- status: one of ${LOAD_STATUSES.join(', ')}
- billingStatus: one of ${BILLING_STATUSES.join(', ')}
- driverId, brokerId: UUID only if explicitly given as an id
- q: one short phrase searched across load number, broker, driver
- dateFrom, dateTo: YYYY-MM-DD (resolve "this week", "last month", etc. using today's date)
- loadNumberContains, brokerNameContains, driverNameContains: substring hints
- pickupState, deliveryState: two uppercase US letters
- pickupCity, deliveryCity: city names
- rateMin, rateMax: positive numbers in USD ("over 3000" -> rateMin 3000)`;
}

async function handleLoadsNlq(req, res, deps) {
  const startedAt = Date.now();
  const { openai } = deps;
  const { query } = req.body || {};

  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({
      success: false,
      error: 'query string is required',
      code: 'AI_BAD_REQUEST'
    });
  }

  const trimmed = query.trim().slice(0, 500);
  const todayIso = new Date().toISOString().slice(0, 10);

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: buildSystemPrompt(todayIso) },
        { role: 'user', content: `User question about loads:\n${trimmed}` }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const processingTimeMs = Date.now() - startedAt;
    const aiContent = completion.choices[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = parseAiJson(aiContent);
    } catch (_e) {
      logAiInteraction({
        userId: null,
        route: ROUTE,
        message: `Loads NLQ parse failure: "${trimmed}"`,
        conversationId: null,
        success: true,
        errorCode: 'AI_PARSE_FALLBACK',
        processingTimeMs
      });
      return res.json({
        success: true,
        fallback: true,
        meta: { reason: 'unparseable_model_output', processingTimeMs, model: completion.model }
      });
    }

    const normalized = normalizeNlqAiOutput(parsed);
    if (normalized.fallback) {
      logAiInteraction({
        userId: null,
        route: ROUTE,
        message: `Loads NLQ fallback (${normalized.reason}): "${trimmed}"`,
        conversationId: null,
        success: true,
        errorCode: normalized.reason,
        processingTimeMs
      });
      return res.json({
        success: true,
        fallback: true,
        meta: { reason: normalized.reason, processingTimeMs, model: completion.model }
      });
    }

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Loads NLQ ok (${Object.keys(normalized.filters).length} fields): "${trimmed}"`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json({
      success: true,
      fallback: false,
      filters: normalized.filters,
      meta: { model: completion.model, processingTimeMs }
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] loads NLQ error', err.message || err);

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Loads NLQ upstream failure: "${trimmed}"`,
      conversationId: null,
      success: false,
      errorCode: 'AI_UNAVAILABLE',
      processingTimeMs
    });

    return res.json({
      success: true,
      fallback: true,
      meta: { reason: 'ai_upstream_error', processingTimeMs }
    });
  }
}

module.exports = {
  handleLoadsNlq,
  normalizeNlqAiOutput,
  LOAD_STATUSES,
  BILLING_STATUSES
};
