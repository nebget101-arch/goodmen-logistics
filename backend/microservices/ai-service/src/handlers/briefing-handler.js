'use strict';

/**
 * FN-1139: Daily AI Briefing generator (Anthropic Claude).
 *
 * Backend (FN-1141) aggregates upstream metrics and POSTs them here. We
 * structure them into a five-section briefing (throughput, exceptions,
 * driverRisk, vehicleRisk, recommendedAction) and cache the result per
 * tenant per calendar day.
 */

const fs = require('node:fs');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');
const briefingCache = require('../cache/briefing-cache');

const ROUTE = '/briefing/generate';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_SECTIONS = [
  'throughput',
  'exceptions',
  'driverRisk',
  'vehicleRisk',
  'recommendedAction'
];

let cachedSystemPrompt = null;
function loadSystemPrompt() {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const promptPath = path.join(__dirname, '..', 'prompts', 'briefing.md');
  cachedSystemPrompt = fs.readFileSync(promptPath, 'utf8');
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

function trimString(value, max) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function validateSection(raw, key) {
  if (!isPlainObject(raw)) return null;
  const headline = trimString(raw.headline, 60);
  const detail = trimString(raw.detail, 200);
  if (!headline || !detail) return null;
  const metricRaw = raw.metric == null ? '' : raw.metric;
  let metric = trimString(metricRaw, 30);
  if (!metric && key !== 'recommendedAction') return null;
  return { headline, detail, metric };
}

function validateBriefing(raw) {
  if (!isPlainObject(raw)) return null;
  const out = {};
  for (const key of REQUIRED_SECTIONS) {
    const section = validateSection(raw[key], key);
    if (!section) return null;
    out[key] = section;
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

function buildUserMessage({ tenantId, date, metrics }) {
  return JSON.stringify({
    tenantId,
    date,
    metrics: metrics || {}
  });
}

function validateRequest(body) {
  if (!isPlainObject(body)) {
    return { error: 'request body must be a JSON object' };
  }
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (!tenantId) return { error: 'tenantId is required' };
  if (!date || !ISO_DATE_RE.test(date)) return { error: 'date must be YYYY-MM-DD' };
  if (body.metrics != null && !isPlainObject(body.metrics)) {
    return { error: 'metrics must be an object when provided' };
  }
  return {
    tenantId,
    date,
    metrics: body.metrics || {},
    forceRefresh: body.forceRefresh === true
  };
}

async function handleBriefingGenerate(req, res, deps) {
  const startedAt = Date.now();
  const parsed = validateRequest(req.body);

  if (parsed.error) {
    return res.status(400).json({
      success: false,
      error: parsed.error,
      code: 'AI_BAD_REQUEST'
    });
  }

  const { tenantId, date, metrics, forceRefresh } = parsed;

  if (!forceRefresh) {
    const cached = briefingCache.get(tenantId, date);
    if (cached) {
      return res.json({
        success: true,
        data: cached.data,
        cached: true,
        generatedAt: cached.generatedAt,
        meta: {
          model: cached.meta && cached.meta.model,
          processingTimeMs: Date.now() - startedAt
        }
      });
    }
  }

  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env.ANTHROPIC_BRIEFING_MODEL || 'claude-sonnet-4-6';

  let aiContent;
  let aiModel;
  try {
    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0.2,
      system: loadSystemPrompt(),
      messages: [
        { role: 'user', content: buildUserMessage({ tenantId, date, metrics }) }
      ]
    });
    aiContent = message.content?.[0]?.text || '';
    aiModel = message.model || model;
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] briefing upstream error', err.message || err);
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Briefing upstream failure tenant=${tenantId} date=${date}`,
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

  let raw;
  try {
    raw = parseAiResponse(aiContent);
  } catch (_err) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Briefing parse failure tenant=${tenantId} date=${date}`,
      conversationId: null,
      success: false,
      errorCode: 'AI_PARSE_ERROR',
      processingTimeMs
    });
    return res.status(502).json({
      success: false,
      error: 'AI returned unparseable output',
      code: 'AI_PARSE_ERROR',
      meta: { processingTimeMs }
    });
  }

  const validated = validateBriefing(raw);
  if (!validated) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Briefing schema failure tenant=${tenantId} date=${date}`,
      conversationId: null,
      success: false,
      errorCode: 'AI_SCHEMA_ERROR',
      processingTimeMs
    });
    return res.status(502).json({
      success: false,
      error: 'AI returned briefing in wrong shape',
      code: 'AI_SCHEMA_ERROR',
      meta: { processingTimeMs }
    });
  }

  const generatedAt = new Date().toISOString();
  const processingTimeMs = Date.now() - startedAt;

  briefingCache.set(tenantId, date, {
    data: validated,
    generatedAt,
    meta: { model: aiModel }
  });

  logAiInteraction({
    userId: null,
    route: ROUTE,
    message: `Briefing ok tenant=${tenantId} date=${date}`,
    conversationId: null,
    success: true,
    errorCode: null,
    processingTimeMs
  });

  return res.json({
    success: true,
    data: validated,
    cached: false,
    generatedAt,
    meta: {
      model: aiModel,
      processingTimeMs
    }
  });
}

module.exports = {
  handleBriefingGenerate,
  validateRequest,
  validateBriefing,
  validateSection,
  parseAiResponse,
  loadSystemPrompt,
  REQUIRED_SECTIONS
};
