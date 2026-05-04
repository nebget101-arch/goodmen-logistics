'use strict';

/**
 * FN-1159: Severity scoring for Smart Alerts.
 *
 * Combines a deterministic rule-based baseline (services/severity-scorer.js)
 * with a Claude-derived contextual boost + reasoning + recommended action.
 *
 * Contract is consumed by the gateway aggregator from FN-1161:
 *   backend/gateway/services/smart-alerts-aggregator.js
 *
 *   POST /api/ai/score-alert
 *   { tenantId, alert: { id, type, subjectId, subjectKind, facts } }
 *   -> { severity: 0-100, reasoning, action, meta }
 */

const fs = require('node:fs');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');
const {
  SUPPORTED_TYPES,
  MAX_REASONING_LENGTH,
  MAX_ACTION_LENGTH,
  clampSeverity,
  clampBoost,
  combineScore,
  computeBaseScore,
  fallbackReasoning,
  fallbackAction,
  trimToMax,
  validateAlert
} = require('../services/severity-scorer');

const ROUTE = '/score-alert';
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'severity.md');

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

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

function buildUserMessage({ tenantId, alert, baseScore }) {
  return JSON.stringify({
    tenantId: tenantId || null,
    baseScore,
    alert: {
      id: alert.id,
      type: alert.type,
      subjectId: alert.subjectId || null,
      subjectKind: alert.subjectKind || null,
      facts: alert.facts || {}
    }
  });
}

async function handleScoreAlert(req, res, deps) {
  const startedAt = Date.now();
  const body = req.body || {};
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId : null;
  const alert = body.alert;

  const validation = validateAlert(alert);
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      error: validation.error,
      code: 'AI_BAD_REQUEST'
    });
  }

  const baseScore = computeBaseScore(alert);

  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model =
    process.env.ANTHROPIC_SEVERITY_MODEL ||
    process.env.ANTHROPIC_NLQ_MODEL ||
    'claude-haiku-4-5-20251001';

  if (!client || !process.env.ANTHROPIC_API_KEY && !(deps && deps.anthropic)) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `score-alert no-ai fallback (type=${alert.type})`,
      conversationId: null,
      success: true,
      errorCode: 'AI_UNCONFIGURED',
      processingTimeMs
    });
    return res.json({
      severity: baseScore,
      reasoning: fallbackReasoning(alert),
      action: fallbackAction(alert),
      meta: {
        baseScore,
        boost: 0,
        scoredBy: 'rules:no-anthropic',
        processingTimeMs
      }
    });
  }

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 320,
      temperature: 0.2,
      system: loadSystemPrompt(),
      messages: [
        { role: 'user', content: buildUserMessage({ tenantId, alert, baseScore }) }
      ]
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
        message: `score-alert parse fallback (type=${alert.type})`,
        conversationId: null,
        success: true,
        errorCode: 'AI_PARSE_FALLBACK',
        processingTimeMs
      });
      return res.json({
        severity: baseScore,
        reasoning: fallbackReasoning(alert),
        action: fallbackAction(alert),
        meta: {
          baseScore,
          boost: 0,
          scoredBy: 'rules:unparseable-ai-response',
          processingTimeMs
        }
      });
    }

    const boost = clampBoost(parsed?.boost);
    const reasoning =
      trimToMax(parsed?.reasoning, MAX_REASONING_LENGTH) || fallbackReasoning(alert);
    const action =
      trimToMax(parsed?.action, MAX_ACTION_LENGTH) || fallbackAction(alert);
    const severity = combineScore({ baseScore, boost });

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `score-alert ok (type=${alert.type}, severity=${severity})`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json({
      severity: clampSeverity(severity),
      reasoning,
      action,
      meta: {
        baseScore,
        boost,
        scoredBy: 'ai',
        model: message.model || model,
        processingTimeMs
      }
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] score-alert error', err.message || err);

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `score-alert upstream failure (type=${alert.type})`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_UNAVAILABLE',
      processingTimeMs
    });

    return res.json({
      severity: baseScore,
      reasoning: fallbackReasoning(alert),
      action: fallbackAction(alert),
      meta: {
        baseScore,
        boost: 0,
        scoredBy: 'rules:ai-error',
        processingTimeMs
      }
    });
  }
}

module.exports = {
  handleScoreAlert,
  buildUserMessage,
  parseAiResponse,
  loadSystemPrompt,
  SUPPORTED_TYPES
};
