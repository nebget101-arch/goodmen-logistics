'use strict';

/**
 * FN-1445 / FN-1433: VIN Repair History Lookup.
 *
 * Given a VIN and a list of prior work-order rows, return:
 *   - a 1-2 sentence summary,
 *   - recurring complaint patterns linked to underlying WO IDs,
 *   - a comeback-risk grade: low | medium | high.
 *
 * Uses Anthropic Claude with prompt-cached static system prompt.
 * Short-circuits (no LLM call) when history.length < 2.
 * In-memory result cache keyed by VIN with ~1h TTL.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/vehicles/repair-history-summary';
const MAX_WO_ROWS = 50;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_ENTRIES = 500;

const RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);

const STATIC_SYSTEM_PROMPT = `You are a heavy-duty fleet maintenance analyst. Given a vehicle's recent work-order history, you produce a short, actionable summary and grade comeback risk for the shop.

You will receive a list of work-order rows. Each row has:
- id: the work order ID (string)
- date: ISO date the work was performed
- complaint: the customer / driver complaint text
- diagnosis: optional shop diagnosis
- repair: optional repair description / labor codes
- mileage: optional odometer reading

A "recurring pattern" is two or more work orders within the window addressing the same underlying complaint family (e.g. multiple "DEF system fault" visits, multiple brake jobs on the same axle, repeat A/C blower replacements). A "comeback" is a repair on the same complaint family within ~60 days of the prior repair — these strongly indicate the original fix did not hold.

Comeback risk grading:
- "high": one or more comeback events (same complaint family within ~60 days), OR three+ visits for the same complaint family in the window.
- "medium": a recurring pattern of two visits for the same complaint family with no obvious comeback, OR a serious safety-related complaint that recurred at any spacing.
- "low": no recurring complaint families, or only routine PM / unrelated repairs.

Return ONLY a JSON object with no markdown fences. Schema:
{
  "summary": "1-2 sentences in plain English, no fluff",
  "recurringIssues": [
    {
      "pattern": "short label, e.g. 'DEF system faults'",
      "occurrences": 3,
      "workOrderIds": ["wo-id-1", "wo-id-2", "wo-id-3"]
    }
  ],
  "comebackRisk": "low" | "medium" | "high"
}

Rules:
- workOrderIds MUST be IDs from the input list — never invent IDs.
- recurringIssues only includes patterns with occurrences >= 2.
- If history is sparse or unrelated, recurringIssues is [] and risk is "low".
- summary stays under 240 characters.`;

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  return anthropicClient;
}

const resultCache = new Map();

function cacheKey(vin, history) {
  const ids = history
    .map((h) => (h && h.id ? String(h.id) : ''))
    .filter(Boolean)
    .sort()
    .join(',');
  return `${vin}::${history.length}::${ids}`;
}

function getCached(key) {
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  if (resultCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = resultCache.keys().next().value;
    if (oldestKey) resultCache.delete(oldestKey);
  }
  resultCache.set(key, { value, storedAt: Date.now() });
}

function clearCache() {
  resultCache.clear();
}

function normalizeHistoryRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = row.id != null ? String(row.id).trim() : '';
  if (!id) return null;
  return {
    id,
    date: typeof row.date === 'string' ? row.date.slice(0, 10) : null,
    complaint: typeof row.complaint === 'string' ? row.complaint.slice(0, 500) : '',
    diagnosis: typeof row.diagnosis === 'string' ? row.diagnosis.slice(0, 500) : '',
    repair: typeof row.repair === 'string' ? row.repair.slice(0, 500) : '',
    mileage: Number.isFinite(row.mileage) ? row.mileage : null
  };
}

function buildUserMessage(vin, history) {
  const lines = history.map(
    (h) =>
      `- id=${h.id}${h.date ? ` date=${h.date}` : ''}${h.mileage != null ? ` miles=${h.mileage}` : ''}\n` +
      `  complaint: ${h.complaint || '(none)'}\n` +
      (h.diagnosis ? `  diagnosis: ${h.diagnosis}\n` : '') +
      (h.repair ? `  repair: ${h.repair}\n` : '')
  );
  return `VIN: ${vin}\nWork-order history (${history.length} rows, newest first):\n${lines.join('\n')}`;
}

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

function validateResult(raw, allowedIds) {
  const out = {
    summary: '',
    recurringIssues: [],
    comebackRisk: 'low'
  };

  if (!raw || typeof raw !== 'object') return out;

  if (typeof raw.summary === 'string') {
    out.summary = raw.summary.trim().slice(0, 280);
  }

  if (typeof raw.comebackRisk === 'string' && RISK_LEVELS.includes(raw.comebackRisk.toLowerCase())) {
    out.comebackRisk = raw.comebackRisk.toLowerCase();
  }

  if (Array.isArray(raw.recurringIssues)) {
    out.recurringIssues = raw.recurringIssues
      .map((issue) => {
        if (!issue || typeof issue !== 'object') return null;
        const pattern = typeof issue.pattern === 'string' ? issue.pattern.trim().slice(0, 120) : '';
        const ids = Array.isArray(issue.workOrderIds)
          ? issue.workOrderIds
              .map((id) => (id != null ? String(id).trim() : ''))
              .filter((id) => id && allowedIds.has(id))
          : [];
        const occurrences = Number.isFinite(issue.occurrences)
          ? Math.max(2, Math.floor(issue.occurrences))
          : ids.length;
        if (!pattern || ids.length < 2) return null;
        return { pattern, occurrences, workOrderIds: ids };
      })
      .filter(Boolean)
      .slice(0, 10);
  }

  return out;
}

async function handleVehicleRepairHistorySummary(req, res, deps) {
  const startedAt = Date.now();
  const { vin, history } = req.body || {};

  if (typeof vin !== 'string' || !vin.trim()) {
    return res.status(400).json({
      success: false,
      error: 'vin string is required',
      code: 'AI_BAD_REQUEST'
    });
  }

  if (!Array.isArray(history)) {
    return res.status(400).json({
      success: false,
      error: 'history array is required',
      code: 'AI_BAD_REQUEST'
    });
  }

  const trimmedVin = vin.trim().toUpperCase();
  const normalizedHistory = history
    .map(normalizeHistoryRow)
    .filter(Boolean)
    .slice(0, MAX_WO_ROWS);

  // Short-circuit thin history — no LLM call.
  if (normalizedHistory.length < 2) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Repair history short-circuit (${normalizedHistory.length} rows): ${trimmedVin}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });
    return res.json({
      success: true,
      cached: false,
      data: {
        summary: 'Not enough history',
        recurringIssues: [],
        comebackRisk: 'low'
      },
      meta: {
        rowsAnalyzed: normalizedHistory.length,
        shortCircuited: true,
        processingTimeMs
      }
    });
  }

  const key = cacheKey(trimmedVin, normalizedHistory);
  const cached = getCached(key);
  if (cached) {
    const processingTimeMs = Date.now() - startedAt;
    return res.json({
      success: true,
      cached: true,
      data: cached.data,
      meta: { ...cached.meta, processingTimeMs, fromCache: true }
    });
  }

  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env.ANTHROPIC_REPAIR_HISTORY_MODEL || 'claude-haiku-4-5-20251001';
  const allowedIds = new Set(normalizedHistory.map((h) => h.id));

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0.2,
      system: [
        {
          type: 'text',
          text: STATIC_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [
        {
          role: 'user',
          content: buildUserMessage(trimmedVin, normalizedHistory)
        }
      ]
    });

    const aiContent = message.content?.[0]?.text || '{}';
    let parsed;
    try {
      parsed = parseAiResponse(aiContent);
    } catch (_parseErr) {
      const processingTimeMs = Date.now() - startedAt;
      logAiInteraction({
        userId: null,
        route: ROUTE,
        message: `Repair history parse failure: ${trimmedVin}`,
        conversationId: null,
        success: true,
        errorCode: 'AI_PARSE_FALLBACK',
        processingTimeMs
      });
      return res.json({
        success: true,
        cached: false,
        data: {
          summary: 'Repair history summary unavailable',
          recurringIssues: [],
          comebackRisk: 'low'
        },
        meta: {
          rowsAnalyzed: normalizedHistory.length,
          shortCircuited: false,
          fallback: true,
          reason: 'unparseable_model_output',
          processingTimeMs
        }
      });
    }

    const result = validateResult(parsed, allowedIds);
    const processingTimeMs = Date.now() - startedAt;
    const usage = message.usage || {};
    const meta = {
      model: message.model || model,
      rowsAnalyzed: normalizedHistory.length,
      shortCircuited: false,
      cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
      cacheReadInputTokens: usage.cache_read_input_tokens || 0,
      processingTimeMs
    };

    setCached(key, { data: result, meta });

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Repair history ok (${normalizedHistory.length} rows, risk=${result.comebackRisk}): ${trimmedVin}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json({
      success: true,
      cached: false,
      data: result,
      meta
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // FN-1527: Anthropic errors carry `status` (HTTP) and `error.type`
    // (e.g. overloaded_error, rate_limit_error). Surface both so Render logs
    // are diagnosable without re-running the request.
    const anthropicStatus = err?.status ?? null;
    const anthropicType = err?.error?.type || err?.type || null;
    const errorCode = err?.code || null;
    // eslint-disable-next-line no-console
    console.error('[ai-service] repair history error', {
      message: err?.message || String(err),
      status: anthropicStatus,
      type: anthropicType,
      code: errorCode,
      vin: trimmedVin,
      rowsAnalyzed: normalizedHistory.length,
      processingTimeMs,
      model
    });

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Repair history upstream failure: ${trimmedVin}`,
      conversationId: null,
      success: false,
      errorCode: anthropicStatus ? `HTTP_${anthropicStatus}` : (anthropicType || errorCode || 'AI_UNAVAILABLE'),
      processingTimeMs
    });

    // FN-1527: hint to the orchestrator (and any direct caller) when to retry.
    res.set('Retry-After', '5');
    return res.status(502).json({
      success: false,
      error: 'AI service unavailable',
      code: 'AI_UNAVAILABLE'
    });
  }
}

module.exports = {
  handleVehicleRepairHistorySummary,
  // Exported for testing
  STATIC_SYSTEM_PROMPT,
  RISK_LEVELS,
  MAX_WO_ROWS,
  CACHE_TTL_MS,
  parseAiResponse,
  validateResult,
  normalizeHistoryRow,
  buildUserMessage,
  cacheKey,
  clearCache
};
