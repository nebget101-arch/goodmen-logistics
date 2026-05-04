'use strict';

/**
 * FN-1137: Multi-turn report-context chat for the Reports Center.
 *
 * POST /api/ai/reports/chat
 *   body: { reportKey, filters?, data, history?, message, summary? }
 *   -> { reply, generatedAt, usage: { cache_read_input_tokens, cache_creation_input_tokens,
 *                                     input_tokens, output_tokens, _truncated } }
 *
 * Caching: the dataset block (filters + summary + data rows) is placed in the
 * `system` array with `cache_control: { type: 'ephemeral' }`, so follow-up
 * questions in the same session pay only the small history-tail token cost.
 * Verified by `usage.cache_read_input_tokens > 0` on the second message.
 *
 * Hard caps (server-side):
 *   - history truncated to the last MAX_HISTORY_MESSAGES turns (env-configurable)
 *   - data truncated to MAX_DATA_ROWS rows; response carries `usage._truncated: true`
 *   - message length capped to MAX_MESSAGE_LENGTH chars
 *
 * RBAC: caller must hold `reports.shop` (escalated from VIEW). Populated by
 * `loadAuthContext` middleware that decodes the gateway-forwarded JWT.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/reports/chat';
const REQUIRED_PERMISSION = 'reports.shop';
const REPORT_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/i;

const DEFAULT_MAX_HISTORY = 10;
const DEFAULT_MAX_DATA_ROWS = 200;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_REPLY_TOKENS = 1024;

function getMaxHistoryMessages() {
  const parsed = parseInt(process.env.AI_REPORTS_CHAT_MAX_HISTORY, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_HISTORY;
}

function getMaxDataRows() {
  const parsed = parseInt(process.env.AI_REPORTS_CHAT_MAX_DATA_ROWS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_DATA_ROWS;
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

function hasReportsShop(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  return perms.includes(REQUIRED_PERMISSION);
}

function truncateHistory(history, max) {
  if (!Array.isArray(history)) return [];
  const cleaned = history
    .filter((m) => isPlainObject(m) && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(cleaned.length - max);
}

function truncateData(data, maxRows) {
  if (!Array.isArray(data)) return { rows: [], truncated: false, originalCount: 0 };
  if (data.length <= maxRows) return { rows: data, truncated: false, originalCount: data.length };
  return { rows: data.slice(0, maxRows), truncated: true, originalCount: data.length };
}

function buildSystemBlocks({ reportKey, filters, summary, rows, truncated, originalCount }) {
  const instructions = [
    'You are a report-context assistant for FleetNeuron, a trucking and shop-management platform.',
    'Answer the user\'s question using ONLY the report data provided below.',
    'When asked for numbers, quote them directly from the data (do not invent figures).',
    'When the data is insufficient to answer, say so explicitly.',
    'Be concise. Prefer 1–3 short sentences or a small bulleted list.',
    'Never fabricate driver names, dispatcher names, or amounts that are not in the data.'
  ].join('\n');

  // Single cached block per request: the report context. We put the whole
  // dataset in one block (with cache_control at the end) so every turn within
  // the same session reuses the prefix and only pays for the new history tail
  // + new user message. The truncation note is included so the model knows
  // not to claim totals if rows were dropped.
  const dataset = JSON.stringify(
    {
      reportKey,
      filters: filters || {},
      summary: summary || {},
      rowCount: rows.length,
      originalRowCount: originalCount,
      truncated,
      data: rows
    }
  );

  return [
    { type: 'text', text: instructions },
    {
      type: 'text',
      text: `Report context (cached):\n${dataset}`,
      cache_control: { type: 'ephemeral' }
    }
  ];
}

function buildMessages(history, userMessage) {
  const out = history.map((m) => ({ role: m.role, content: m.content }));
  out.push({ role: 'user', content: userMessage });
  return out;
}

function validateRequest(body) {
  if (!isPlainObject(body)) return { error: 'request body must be a JSON object' };
  const { reportKey, message, history, data, filters, summary } = body;
  if (typeof reportKey !== 'string' || !REPORT_KEY_PATTERN.test(reportKey)) {
    return { error: 'reportKey must be alphanumeric with dashes/underscores' };
  }
  if (typeof message !== 'string' || !message.trim()) {
    return { error: 'message is required' };
  }
  if (data !== undefined && data !== null && !Array.isArray(data)) {
    return { error: 'data must be an array when provided' };
  }
  if (filters !== undefined && filters !== null && !isPlainObject(filters)) {
    return { error: 'filters must be an object when provided' };
  }
  if (summary !== undefined && summary !== null && !isPlainObject(summary)) {
    return { error: 'summary must be an object when provided' };
  }
  if (history !== undefined && history !== null && !Array.isArray(history)) {
    return { error: 'history must be an array when provided' };
  }
  return {
    reportKey,
    message: message.trim().slice(0, MAX_MESSAGE_LENGTH),
    history: history || [],
    data: data || [],
    filters: filters || {},
    summary: summary || {}
  };
}

async function handleReportsChat(req, res, deps) {
  const startedAt = Date.now();
  const userId = req.user && req.user.id ? req.user.id : null;

  if (!hasReportsShop(req.user)) {
    logAiInteraction({
      userId,
      route: ROUTE,
      message: 'reports chat forbidden',
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

  const maxHistory = getMaxHistoryMessages();
  const maxRows = getMaxDataRows();
  const history = truncateHistory(validated.history, maxHistory);
  const { rows, truncated, originalCount } = truncateData(validated.data, maxRows);

  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env.ANTHROPIC_REPORTS_CHAT_MODEL
    || process.env.ANTHROPIC_REPORTS_MODEL
    || 'claude-sonnet-4-6';

  if (!client || (!process.env.ANTHROPIC_API_KEY && !(deps && deps.anthropic))) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId,
      route: ROUTE,
      message: 'reports chat unconfigured',
      conversationId: null,
      success: false,
      errorCode: 'AI_UNCONFIGURED',
      processingTimeMs
    });
    return res.status(503).json({
      success: false,
      error: 'AI not configured',
      code: 'AI_UNCONFIGURED'
    });
  }

  let aiMessage;
  try {
    aiMessage = await client.messages.create({
      model,
      max_tokens: MAX_REPLY_TOKENS,
      temperature: 0.2,
      system: buildSystemBlocks({
        reportKey: validated.reportKey,
        filters: validated.filters,
        summary: validated.summary,
        rows,
        truncated,
        originalCount
      }),
      messages: buildMessages(history, validated.message)
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] reports chat upstream error', err.message || err);
    logAiInteraction({
      userId,
      route: ROUTE,
      message: 'reports chat upstream failure',
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_UNAVAILABLE',
      processingTimeMs
    });
    return res.status(502).json({
      success: false,
      error: 'AI service unavailable',
      code: 'AI_UNAVAILABLE'
    });
  }

  const processingTimeMs = Date.now() - startedAt;
  const reply = aiMessage.content?.[0]?.text || '';
  const usage = aiMessage.usage || {};

  logAiInteraction({
    userId,
    route: ROUTE,
    message: `reports chat ok reportKey=${validated.reportKey} truncated=${truncated}`,
    conversationId: null,
    success: true,
    errorCode: null,
    processingTimeMs
  });

  return res.json({
    reply,
    generatedAt: new Date().toISOString(),
    usage: {
      cache_read_input_tokens: Number(usage.cache_read_input_tokens || 0),
      cache_creation_input_tokens: Number(usage.cache_creation_input_tokens || 0),
      input_tokens: Number(usage.input_tokens || 0),
      output_tokens: Number(usage.output_tokens || 0),
      _truncated: truncated
    },
    meta: {
      reportKey: validated.reportKey,
      model: aiMessage.model || model,
      processingTimeMs,
      historyMessages: history.length,
      rowsSent: rows.length,
      originalRowCount: originalCount
    }
  });
}

module.exports = {
  handleReportsChat,
  hasReportsShop,
  validateRequest,
  truncateHistory,
  truncateData,
  buildSystemBlocks,
  buildMessages,
  getMaxHistoryMessages,
  getMaxDataRows,
  REQUIRED_PERMISSION,
  REPORT_KEY_PATTERN,
  DEFAULT_MAX_HISTORY,
  DEFAULT_MAX_DATA_ROWS,
  MAX_MESSAGE_LENGTH
};
