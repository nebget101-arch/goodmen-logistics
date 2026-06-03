'use strict';

/**
 * FN-1148: Classifies an Ask FleetNeuron prompt into one of four intents.
 *
 * Intents are coarse domain buckets used by the /ask handler to dispatch
 * prompts into structured per-domain handlers (loads, drivers, vehicles, generic).
 *
 * Two layers:
 *   1. Keyword heuristic — fast, free, deterministic. Used as a fallback when
 *      the AI client is unavailable or returns unparseable output.
 *   2. AI classification — Claude Haiku, JSON output. Confidence is reported
 *      so callers can decide whether to trust the verdict.
 */

const Anthropic = require('@anthropic-ai/sdk');

const INTENTS = Object.freeze(['loads', 'drivers', 'vehicles', 'generic']);

const KEYWORDS = Object.freeze({
  loads: [
    'load', 'shipment', 'broker', 'pickup', 'delivery', 'rate confirmation',
    'bol', 'dispatch', 'lane', 'stop', 'pod', 'rate', 'invoice', 'settlement'
  ],
  drivers: [
    'driver', 'cdl', 'hos', 'mvr', 'safety', 'roadside', 'inspection',
    'violation', 'drug', 'alcohol', 'dqf', 'employment', 'consent', 'psp'
  ],
  vehicles: [
    'truck', 'tractor', 'trailer', 'unit', 'vehicle', 'maintenance',
    'work order', 'pm ', 'preventive', 'odometer', 'tire', 'engine',
    'def', 'fuel'
  ]
});

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  return anthropicClient;
}

function buildSystemPrompt() {
  return `You classify a fleet manager's natural-language question into ONE intent bucket.

Return ONLY a JSON object: {"intent":"loads|drivers|vehicles|generic","confidence":0.0-1.0,"reasoning":"short"}

Buckets:
- loads — questions about shipments, brokers, pickups, deliveries, rates, BOL, dispatch, settlements
- drivers — questions about drivers, CDL, HOS, MVR, safety, inspections, violations, DQF
- vehicles — questions about trucks, trailers, units, maintenance, work orders, PM schedule
- generic — anything else (overall fleet status, overview questions, multi-domain summaries, greetings)

Pick "generic" when the question spans multiple domains or there is no clear domain.
Reasoning must be under 80 characters.`;
}

function classifyByKeyword(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (!lower) {
    return { intent: 'generic', confidence: 0.3, reasoning: 'empty prompt' };
  }
  const scores = { loads: 0, drivers: 0, vehicles: 0 };
  for (const intent of Object.keys(scores)) {
    for (const kw of KEYWORDS[intent]) {
      if (lower.includes(kw)) scores[intent] += 1;
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topIntent, topScore] = ranked[0];
  if (topScore === 0) {
    return { intent: 'generic', confidence: 0.4, reasoning: 'no domain keywords' };
  }
  // Tie between top two domains — fall back to generic.
  if (ranked[1] && ranked[1][1] === topScore) {
    return { intent: 'generic', confidence: 0.45, reasoning: 'multi-domain keywords' };
  }
  return {
    intent: topIntent,
    confidence: Math.min(0.6 + topScore * 0.05, 0.85),
    reasoning: 'keyword match'
  };
}

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

function validateClassification(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const intent = typeof raw.intent === 'string' ? raw.intent.trim().toLowerCase() : '';
  if (!INTENTS.includes(intent)) return null;
  let confidence = typeof raw.confidence === 'number' ? raw.confidence : parseFloat(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;
  let reasoning = typeof raw.reasoning === 'string' ? raw.reasoning.trim() : '';
  if (reasoning.length > 120) reasoning = reasoning.slice(0, 120);
  return { intent, confidence, reasoning };
}

async function classifyIntent(prompt, deps = {}) {
  const trimmed = String(prompt || '').trim();
  if (!trimmed) {
    return { ...classifyByKeyword(''), source: 'heuristic' };
  }

  const client = deps.anthropic || getAnthropicClient();
  const model = process.env.ANTHROPIC_CLASSIFIER_MODEL || 'claude-haiku-4-5-20251001';

  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: 256,
      temperature: 0,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: trimmed.slice(0, 1000) }]
    });
  } catch (_err) {
    return { ...classifyByKeyword(trimmed), source: 'heuristic_error' };
  }

  const text = message.content?.[0]?.text || '';
  let parsed;
  try {
    parsed = parseAiResponse(text);
  } catch (_err) {
    return { ...classifyByKeyword(trimmed), source: 'heuristic_fallback', model: message.model || model };
  }
  const validated = validateClassification(parsed);
  if (!validated) {
    return { ...classifyByKeyword(trimmed), source: 'heuristic_fallback', model: message.model || model };
  }
  return { ...validated, source: 'ai', model: message.model || model };
}

module.exports = {
  classifyIntent,
  classifyByKeyword,
  validateClassification,
  parseAiResponse,
  buildSystemPrompt,
  INTENTS,
  KEYWORDS
};
