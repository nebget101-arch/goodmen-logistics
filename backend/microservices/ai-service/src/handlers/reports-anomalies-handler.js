'use strict';

/**
 * FN-1134: Anomaly detection for the Reports Center.
 *
 * POST /api/ai/reports/:reportKey/anomalies
 *   body: { data, filters?, priorPeriod? }
 *   -> { anomalies: [{ metric, value, deltaPct, severity, context }] }
 *
 * Uses Anthropic Claude with prompt caching on the system prompt + per-report
 * JSON schema. Malformed model output collapses to an empty array (logged, not
 * a 500). Requires the caller to hold `reports.view`; populated by
 * loadAuthContext middleware that reads the gateway-forwarded Authorization
 * header.
 */

const fs = require('node:fs');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/reports/:reportKey/anomalies';
const REQUIRED_PERMISSION = 'reports.view';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'anomalies.md');
const VALID_SEVERITIES = new Set(['info', 'warning', 'critical']);
const REPORT_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/i;
const MAX_ANOMALIES = 6;
const MAX_CONTEXT_LENGTH = 140;

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

function buildSchemaBlock(reportKey) {
  return [
    `Report key: ${reportKey}`,
    'Output schema (return JSON exactly matching this shape):',
    '{',
    '  "anomalies": [',
    '    {',
    '      "metric": string,',
    '      "value": number,',
    '      "deltaPct": number | null,',
    '      "severity": "info" | "warning" | "critical",',
    '      "context": string',
    '    }',
    '  ]',
    '}'
  ].join('\n');
}

function buildSystemBlocks(reportKey) {
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
      text: buildSchemaBlock(reportKey),
      cache_control: { type: 'ephemeral' }
    }
  ];
}

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

function trimContext(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return trimmed.length > MAX_CONTEXT_LENGTH
    ? trimmed.slice(0, MAX_CONTEXT_LENGTH)
    : trimmed;
}

function validateAnomaly(raw) {
  if (!isPlainObject(raw)) return null;
  const metric = typeof raw.metric === 'string' ? raw.metric.trim() : '';
  if (!metric) return null;
  const value = typeof raw.value === 'number' && Number.isFinite(raw.value) ? raw.value : null;
  if (value === null) return null;
  const severity = typeof raw.severity === 'string' ? raw.severity.toLowerCase() : '';
  if (!VALID_SEVERITIES.has(severity)) return null;
  const context = trimContext(raw.context);
  if (!context) return null;
  let deltaPct = null;
  if (raw.deltaPct === null || raw.deltaPct === undefined) {
    deltaPct = null;
  } else if (typeof raw.deltaPct === 'number' && Number.isFinite(raw.deltaPct)) {
    deltaPct = raw.deltaPct;
  } else {
    return null;
  }
  return { metric, value, deltaPct, severity, context };
}

function validateAnomalies(raw) {
  if (!isPlainObject(raw)) return null;
  if (!Array.isArray(raw.anomalies)) return null;
  const out = [];
  for (const entry of raw.anomalies) {
    const validated = validateAnomaly(entry);
    if (validated) out.push(validated);
    if (out.length >= MAX_ANOMALIES) break;
  }
  return { anomalies: out };
}

function validateRequest(body, reportKey) {
  if (!REPORT_KEY_PATTERN.test(reportKey || '')) {
    return { error: 'reportKey must be alphanumeric with dashes/underscores' };
  }
  if (!isPlainObject(body)) {
    return { error: 'request body must be a JSON object' };
  }
  if (body.data !== undefined && body.data !== null
      && !Array.isArray(body.data) && !isPlainObject(body.data)) {
    return { error: 'data must be an array or object when provided' };
  }
  if (body.filters !== undefined && body.filters !== null && !isPlainObject(body.filters)) {
    return { error: 'filters must be an object when provided' };
  }
  if (body.priorPeriod !== undefined && body.priorPeriod !== null
      && !isPlainObject(body.priorPeriod)) {
    return { error: 'priorPeriod must be an object when provided' };
  }
  return {
    reportKey,
    data: body.data ?? null,
    filters: body.filters || null,
    priorPeriod: body.priorPeriod || null
  };
}

function buildUserMessage({ reportKey, data, filters, priorPeriod }) {
  // Keep the per-call payload compact; the static schema lives in the cached
  // system block so it doesn't get re-tokenized each request.
  return JSON.stringify({
    reportKey,
    filters,
    priorPeriod,
    data
  });
}

function emptyResult() {
  return { anomalies: [] };
}

async function handleReportsAnomalies(req, res, deps) {
  const startedAt = Date.now();
  const reportKey = (req.params && req.params.reportKey) || '';
  const userId = req.user && req.user.id ? req.user.id : null;

  if (!hasReportsView(req.user)) {
    logAiInteraction({
      userId,
      route: ROUTE,
      message: `anomalies forbidden reportKey=${reportKey}`,
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

  const validated = validateRequest(req.body, reportKey);
  if (validated.error) {
    return res.status(400).json({
      success: false,
      error: validated.error,
      code: 'AI_BAD_REQUEST'
    });
  }

  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env.ANTHROPIC_REPORTS_MODEL || 'claude-sonnet-4-6';

  if (!client || (!process.env.ANTHROPIC_API_KEY && !(deps && deps.anthropic))) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId,
      route: ROUTE,
      message: `anomalies no-ai fallback reportKey=${reportKey}`,
      conversationId: null,
      success: true,
      errorCode: 'AI_UNCONFIGURED',
      processingTimeMs
    });
    return res.json({
      ...emptyResult(),
      meta: {
        reportKey,
        scoredBy: 'rules:no-anthropic',
        processingTimeMs
      }
    });
  }

  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0.1,
      system: buildSystemBlocks(reportKey),
      messages: [
        {
          role: 'user',
          content: buildUserMessage(validated)
        }
      ]
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] anomalies upstream error', err.message || err);
    logAiInteraction({
      userId,
      route: ROUTE,
      message: `anomalies upstream failure reportKey=${reportKey}`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_UNAVAILABLE',
      processingTimeMs
    });
    return res.json({
      ...emptyResult(),
      meta: {
        reportKey,
        scoredBy: 'rules:ai-error',
        processingTimeMs
      }
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
      message: `anomalies parse fallback reportKey=${reportKey}`,
      conversationId: null,
      success: true,
      errorCode: 'AI_PARSE_FALLBACK',
      processingTimeMs
    });
    return res.json({
      ...emptyResult(),
      meta: {
        reportKey,
        scoredBy: 'rules:unparseable-ai-response',
        model: aiModel,
        cacheReadTokens,
        cacheWriteTokens,
        processingTimeMs
      }
    });
  }

  const validatedOutput = validateAnomalies(parsed);
  if (!validatedOutput) {
    logAiInteraction({
      userId,
      route: ROUTE,
      message: `anomalies schema fallback reportKey=${reportKey}`,
      conversationId: null,
      success: true,
      errorCode: 'AI_SCHEMA_FALLBACK',
      processingTimeMs
    });
    return res.json({
      ...emptyResult(),
      meta: {
        reportKey,
        scoredBy: 'rules:schema-mismatch',
        model: aiModel,
        cacheReadTokens,
        cacheWriteTokens,
        processingTimeMs
      }
    });
  }

  logAiInteraction({
    userId,
    route: ROUTE,
    message: `anomalies ok reportKey=${reportKey} count=${validatedOutput.anomalies.length}`,
    conversationId: null,
    success: true,
    errorCode: null,
    processingTimeMs
  });

  return res.json({
    anomalies: validatedOutput.anomalies,
    meta: {
      reportKey,
      scoredBy: 'ai',
      model: aiModel,
      cacheReadTokens,
      cacheWriteTokens,
      processingTimeMs
    }
  });
}

module.exports = {
  handleReportsAnomalies,
  validateRequest,
  validateAnomaly,
  validateAnomalies,
  buildUserMessage,
  buildSystemBlocks,
  buildSchemaBlock,
  parseAiResponse,
  loadSystemPrompt,
  hasReportsView,
  REQUIRED_PERMISSION,
  REPORT_KEY_PATTERN,
  MAX_ANOMALIES,
  VALID_SEVERITIES
};
