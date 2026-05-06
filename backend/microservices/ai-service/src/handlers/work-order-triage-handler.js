'use strict';

const { buildSystemPrompt } = require('../prompt');
const { logAiInteraction } = require('../analytics/logger');

const TRIAGE_SYSTEM_PROMPT = [
  buildSystemPrompt(),
  '',
  'You are now helping a service advisor triage a maintenance work order.',
  'Given a short free-text description of the problem, and optional vehicle/customer/location IDs, you must propose:',
  '- A small list of suggested labor tasks (description + estimated hours).',
  '- A small list of suggested parts to consider, each as a structured object (see schema below).',
  '- An overall suggested priority: LOW, MEDIUM, or HIGH.',
  '- Optional short notes explaining your reasoning.',
  '',
  'IMPORTANT: Respond as a single JSON object ONLY, with this shape:',
  '{',
  '  "tasks": [',
  '    { "description": "string", "estimatedHours": number }',
  '  ],',
  '  "parts": [',
  '    {',
  '      "partName": "string",                  // canonical part name, e.g. "Brake pad set, front"',
  '      "manufacturerHint": "string|null",     // optional OEM/brand hint when obvious',
  '      "suggestedSku": "string|null",         // ONLY when you are confident; otherwise null',
  '      "qty": number,                         // integer >= 1',
  '      "confidence": number                   // 0.0 to 1.0',
  '    }',
  '  ],',
  '  "priority": "LOW" | "MEDIUM" | "HIGH",',
  '  "notes": "short string"',
  '}',
  '',
  'Rules for parts:',
  '- "partName" is required and must be a concise canonical description.',
  '- Set "suggestedSku" only when you are confident; otherwise use null.',
  '- "manufacturerHint" is optional; use null when not applicable.',
  '- "qty" must be a positive integer.',
  '- "confidence" reflects your certainty in the partName/SKU pairing.',
  '',
  'If you are unsure, keep the lists short and include your uncertainty in notes.',
  'Never include markdown, comments, or any extra text outside the JSON object.'
].join('\n');

function coerceQty(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.floor(n));
}

function coerceConfidence(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizePart(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const partName =
    (typeof raw.partName === 'string' && raw.partName.trim()) ||
    (typeof raw.name === 'string' && raw.name.trim()) ||
    (typeof raw.query === 'string' && raw.query.trim()) ||
    (typeof raw.description === 'string' && raw.description.trim()) ||
    '';

  if (!partName) return null;

  const manufacturerHint =
    typeof raw.manufacturerHint === 'string' && raw.manufacturerHint.trim()
      ? raw.manufacturerHint.trim()
      : null;

  const suggestedSku =
    typeof raw.suggestedSku === 'string' && raw.suggestedSku.trim()
      ? raw.suggestedSku.trim()
      : typeof raw.sku === 'string' && raw.sku.trim()
        ? raw.sku.trim()
        : null;

  return {
    partName,
    manufacturerHint,
    suggestedSku,
    qty: coerceQty(raw.qty),
    confidence: coerceConfidence(raw.confidence)
  };
}

// Legacy `{ query, qty }` shape kept populated for one release so older clients
// don't break. New consumers should read `parts`. Remove `partsLegacy` once
// all callers have migrated.
function toLegacyPart(part) {
  return { query: part.partName, qty: part.qty };
}

async function handleWorkOrderTriage(req, res, deps) {
  try {
    const { openai } = deps;
    const { description, vehicleId, customerId, locationId } = req.body || {};

    if (!description || typeof description !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'description is required',
        code: 'AI_TRIAGE_BAD_REQUEST'
      });
    }

    const userMessage = [
      'Problem description:',
      description,
      '',
      `Context: vehicleId=${vehicleId || 'null'}, customerId=${customerId || 'null'}, locationId=${locationId || 'null'}.`
    ].join('\n');

    const startedAt = Date.now();

    // System prompt is a module-level constant — keeping it stable lets OpenAI's
    // automatic prompt cache match the prefix across requests. Per-request data
    // (description, IDs) goes only in the user message. The prompt_cache_key
    // hint helps the routing layer keep cache hits warm for this handler.
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: TRIAGE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      prompt_cache_key: 'work-order-triage-v2'
    });

    const processingTimeMs = Date.now() - startedAt;
    const choice = completion.choices[0];
    const raw = choice?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {
        tasks: [],
        parts: [],
        priority: 'MEDIUM',
        notes: raw
      };
    }

    const rawParts = Array.isArray(parsed.parts) ? parsed.parts : [];
    const parts = rawParts.map(normalizePart).filter(Boolean);

    const response = {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      parts,
      // Deprecated: legacy `{ query, qty }` shape. Will be removed once all
      // clients migrate to `parts`.
      partsLegacy: parts.map(toLegacyPart),
      priority: typeof parsed.priority === 'string' ? parsed.priority : 'MEDIUM',
      notes: typeof parsed.notes === 'string' ? parsed.notes : ''
    };

    logAiInteraction({
      userId: null,
      route: '/api/ai/work-order/triage',
      message: description,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] work-order triage error', err);

    logAiInteraction({
      userId: null,
      route: '/api/ai/work-order/triage',
      message: req.body?.description,
      conversationId: null,
      success: false,
      errorCode: 'AI_TRIAGE_ERROR',
      processingTimeMs: null
    });

    return res.status(502).json({
      success: false,
      error: 'AI triage unavailable',
      code: 'AI_TRIAGE_ERROR'
    });
  }
}

module.exports = {
  handleWorkOrderTriage,
  // Exported for unit tests.
  TRIAGE_SYSTEM_PROMPT,
  normalizePart
};
