'use strict';

/**
 * FN-1148: POST /api/ai/ask — natural-language Q&A for the Control Center bar.
 *
 * Pipeline:
 *   1. Classify the prompt into one of {loads, drivers, vehicles, generic}.
 *   2. Compose a domain-specific system prompt and feed prompt + briefing
 *      context to Claude.
 *   3. Validate the structured answer envelope and return it to the caller.
 *
 * The frontend (FN-1146) renders `answer.kind` as a card. Today we emit only
 * `text`; future intents may add `table`/`chart` shapes.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');
const { classifyIntent, INTENTS } = require('../services/query-classifier');

const ROUTE = '/ask';
const ANSWER_KINDS = Object.freeze(['text']);

const DOMAIN_PROMPTS = Object.freeze({
  loads: `You answer questions about a fleet's loads, brokers, pickups, deliveries, and settlements.
You will receive a JSON briefing context summarising today's operational state. Use it when relevant.
If the question asks for a list or filter, suggest the closest action the user can take in the loads UI.`,
  drivers: `You answer questions about drivers — CDL status, HOS, safety records, compliance, MVR, inspections.
You will receive a JSON briefing context. Use the driverRisk section if it informs the answer.`,
  vehicles: `You answer questions about vehicles, trailers, maintenance, and work orders.
You will receive a JSON briefing context. Use the vehicleRisk section if it informs the answer.`,
  generic: `You are FleetNeuron's Ask assistant. The user's question doesn't map cleanly to one domain.
You will receive a JSON briefing context summarising today's fleet state. Use it to give a concise overview-style answer.
If the question is greetings or chit-chat, respond briefly and offer 1–2 example fleet questions.`
});

const ANSWER_SYSTEM_SUFFIX = `

Return ONLY a JSON object: {"kind":"text","headline":"<60 chars","detail":"<320 chars"}
- headline: short title (max 60 chars)
- detail: one paragraph (max 320 chars)
No markdown fences, no prose outside the JSON.`;

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

function validateRequest(body) {
  if (!isPlainObject(body)) {
    return { error: 'request body must be a JSON object' };
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return { error: 'prompt is required' };
  if (prompt.length > 1000) return { error: 'prompt must be 1000 characters or less' };
  if (body.briefingContext != null && !isPlainObject(body.briefingContext)) {
    return { error: 'briefingContext must be an object when provided' };
  }
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
  return {
    prompt,
    briefingContext: body.briefingContext || null,
    tenantId: tenantId || null
  };
}

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

function validateAnswer(raw) {
  if (!isPlainObject(raw)) return null;
  const kind = typeof raw.kind === 'string' ? raw.kind.trim().toLowerCase() : '';
  if (!ANSWER_KINDS.includes(kind)) return null;
  const headline = trimString(raw.headline, 60);
  const detail = trimString(raw.detail, 320);
  if (!headline || !detail) return null;
  return { kind, headline, detail };
}

function buildUserMessage({ prompt, briefingContext }) {
  return JSON.stringify({
    question: prompt,
    briefingContext: briefingContext || null
  });
}

async function generateAnswer({ client, model, intent, prompt, briefingContext }) {
  const baseSystem = DOMAIN_PROMPTS[intent] || DOMAIN_PROMPTS.generic;
  const message = await client.messages.create({
    model,
    max_tokens: 512,
    temperature: 0.3,
    system: baseSystem + ANSWER_SYSTEM_SUFFIX,
    messages: [{ role: 'user', content: buildUserMessage({ prompt, briefingContext }) }]
  });
  return {
    text: message.content?.[0]?.text || '',
    model: message.model || model
  };
}

async function handleAsk(req, res, deps = {}) {
  const startedAt = Date.now();
  const parsed = validateRequest(req.body);

  if (parsed.error) {
    return res.status(400).json({
      success: false,
      error: parsed.error,
      code: 'AI_BAD_REQUEST'
    });
  }

  const { prompt, briefingContext, tenantId } = parsed;
  const client = deps.anthropic || getAnthropicClient();
  const answerModel = process.env.ANTHROPIC_ASK_MODEL || 'claude-sonnet-4-6';

  let classification;
  try {
    classification = await classifyIntent(prompt, deps);
  } catch (err) {
    classification = { intent: 'generic', confidence: 0.3, reasoning: 'classifier_error', source: 'heuristic_error' };
  }
  if (!INTENTS.includes(classification.intent)) {
    classification.intent = 'generic';
  }

  let aiText;
  let aiModel;
  try {
    const result = await generateAnswer({
      client,
      model: answerModel,
      intent: classification.intent,
      prompt,
      briefingContext
    });
    aiText = result.text;
    aiModel = result.model;
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] ask upstream error', err.message || err);
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Ask upstream failure tenant=${tenantId || 'n/a'} intent=${classification.intent}`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_UNAVAILABLE',
      processingTimeMs
    });
    return res.status(502).json({
      success: false,
      error: 'AI upstream unavailable',
      code: 'AI_UNAVAILABLE',
      meta: { intent: classification.intent, processingTimeMs }
    });
  }

  let raw;
  try {
    raw = parseAiResponse(aiText);
  } catch (_err) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Ask parse failure intent=${classification.intent}`,
      conversationId: null,
      success: false,
      errorCode: 'AI_PARSE_ERROR',
      processingTimeMs
    });
    return res.status(502).json({
      success: false,
      error: 'AI returned unparseable output',
      code: 'AI_PARSE_ERROR',
      meta: { intent: classification.intent, processingTimeMs }
    });
  }

  const answer = validateAnswer(raw);
  if (!answer) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Ask schema failure intent=${classification.intent}`,
      conversationId: null,
      success: false,
      errorCode: 'AI_SCHEMA_ERROR',
      processingTimeMs
    });
    return res.status(502).json({
      success: false,
      error: 'AI returned answer in wrong shape',
      code: 'AI_SCHEMA_ERROR',
      meta: { intent: classification.intent, processingTimeMs }
    });
  }

  const processingTimeMs = Date.now() - startedAt;
  logAiInteraction({
    userId: null,
    route: ROUTE,
    message: `Ask ok intent=${classification.intent} tenant=${tenantId || 'n/a'}`,
    conversationId: null,
    success: true,
    errorCode: null,
    processingTimeMs
  });

  return res.json({
    success: true,
    intent: classification.intent,
    answer,
    classification: {
      confidence: classification.confidence,
      reasoning: classification.reasoning,
      source: classification.source
    },
    meta: {
      model: aiModel,
      processingTimeMs
    }
  });
}

module.exports = {
  handleAsk,
  validateRequest,
  validateAnswer,
  parseAiResponse,
  ANSWER_KINDS,
  DOMAIN_PROMPTS
};
