'use strict';

/**
 * FN-1437 (parent FN-1431): AI load-to-driver assignment.
 * Ranks candidate drivers for an unassigned load and returns top-N
 * with score, rationale, and structured fields. Uses Anthropic SDK
 * with prompt caching on the static system prompt.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

const ROUTE = '/loads/recommend-driver';
const DEFAULT_TOP_N = 5;
const MAX_TOP_N = 10;
const MAX_CANDIDATES = 50;
const EARTH_RADIUS_MILES = 3958.8;

let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  return anthropicClient;
}

const SYSTEM_PROMPT = `You rank candidate truck drivers for an unassigned load.

For each candidate, weigh four factors and produce one overall score in [0, 1]:
1. HOS feasibility — drivers with more remaining Hours-of-Service can complete pickup + delivery legally. More HOS is better; insufficient HOS is disqualifying.
2. Distance to pickup — closer is better. Distance in miles is provided; a candidate within 50mi is excellent, 50-150mi is good, 150-300mi is marginal, >300mi is poor.
3. Equipment match — the load's equipmentClass must match the driver's equipmentClass for the load to be hauled at all. A mismatch is disqualifying.
4. Prior history with the customer — a driver who has hauled for this customer recently (within ~90 days) is preferred for relationship continuity.

Return ONLY a JSON object with this exact shape — no prose, no markdown fences:
{
  "candidates": [
    {
      "driverId": "<the driverId from input>",
      "score": 0.0,
      "rationale": "one short sentence citing the factors that drove the score"
    }
  ],
  "reasoning": "one short paragraph summarizing how you ranked the field overall"
}

Rules:
- Include EVERY input candidate in the candidates array. Do not invent driverIds.
- Sort by score descending.
- score is a number in [0, 1]. Use 0 for disqualified candidates (equipment mismatch).
- rationale must reference concrete numbers (miles, HOS hours, prior loads) — not generic phrasing.
- reasoning is a single short paragraph, not a list.`;

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

function validateRequestBody(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body is required' };
  }
  const { loadId, load, candidateDrivers, topN } = body;

  if (typeof loadId !== 'string' || !loadId.trim()) {
    return { error: 'loadId string is required' };
  }
  if (!load || typeof load !== 'object') {
    return { error: 'load object is required' };
  }
  if (!isFiniteNumber(load.originLat) || !isFiniteNumber(load.originLng)) {
    return { error: 'load.originLat and load.originLng must be numbers' };
  }
  if (typeof load.equipmentClass !== 'string' || !load.equipmentClass.trim()) {
    return { error: 'load.equipmentClass string is required' };
  }
  if (!Array.isArray(candidateDrivers) || candidateDrivers.length === 0) {
    return { error: 'candidateDrivers array is required and must not be empty' };
  }

  let resolvedTopN = DEFAULT_TOP_N;
  if (topN !== undefined) {
    const n = typeof topN === 'number' ? topN : parseInt(topN, 10);
    if (!Number.isInteger(n) || n < 1 || n > MAX_TOP_N) {
      return { error: `topN must be an integer between 1 and ${MAX_TOP_N}` };
    }
    resolvedTopN = n;
  }

  return { loadId: loadId.trim(), load, candidateDrivers, topN: resolvedTopN };
}

/**
 * Drop drivers with insufficient HOS before sending to the LLM.
 * Returns { eligible, dropped } where each driver is enriched with
 * computed `distanceMiles` and `equipmentMatch`.
 */
function preFilterCandidates(load, candidateDrivers) {
  const eligible = [];
  const dropped = [];

  for (const raw of candidateDrivers.slice(0, MAX_CANDIDATES)) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.driverId !== 'string' || !raw.driverId.trim()) continue;

    const hosRemaining = isFiniteNumber(raw.hosRemainingHours) ? raw.hosRemainingHours : 0;
    if (hosRemaining <= 0) {
      dropped.push({ driverId: raw.driverId, reason: 'insufficient_hos' });
      continue;
    }

    const distanceMiles = isFiniteNumber(raw.lat) && isFiniteNumber(raw.lng)
      ? Math.round(haversineMiles(load.originLat, load.originLng, raw.lat, raw.lng))
      : null;

    const equipmentMatch = typeof raw.equipmentClass === 'string'
      && raw.equipmentClass.trim().toUpperCase() === load.equipmentClass.trim().toUpperCase();

    eligible.push({
      driverId: raw.driverId.trim(),
      name: typeof raw.name === 'string' ? raw.name : null,
      hosRemaining,
      distanceMiles,
      equipmentMatch,
      equipmentClass: typeof raw.equipmentClass === 'string' ? raw.equipmentClass : null,
      lastLoadWithCustomer: typeof raw.lastLoadWithCustomer === 'string' ? raw.lastLoadWithCustomer : null
    });
  }

  return { eligible, dropped };
}

function buildUserMessage(load, eligibleDrivers) {
  const lines = [];
  lines.push(`## Load`);
  lines.push(`- pickup: (${load.originLat.toFixed(4)}, ${load.originLng.toFixed(4)})`);
  if (typeof load.pickupAt === 'string' && load.pickupAt) {
    lines.push(`- pickupAt: ${load.pickupAt}`);
  }
  lines.push(`- equipmentClass: ${load.equipmentClass}`);
  if (typeof load.customerId === 'string' && load.customerId) {
    lines.push(`- customerId: ${load.customerId}`);
  }
  lines.push('');
  lines.push(`## Candidate drivers (${eligibleDrivers.length})`);
  for (const d of eligibleDrivers) {
    const distance = d.distanceMiles == null ? 'unknown' : `${d.distanceMiles}mi`;
    const last = d.lastLoadWithCustomer || 'never';
    lines.push(
      `- driverId="${d.driverId}" hosRemaining=${d.hosRemaining}h distance=${distance} ` +
      `equipmentClass=${d.equipmentClass || 'unknown'} equipmentMatch=${d.equipmentMatch} ` +
      `lastLoadWithCustomer=${last}`
    );
  }
  return lines.join('\n');
}

function parseAiResponse(content) {
  let cleaned = (content || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(cleaned);
}

/**
 * Merge the LLM's score+rationale with the structured per-driver fields
 * we already computed. The LLM only contributes score and rationale —
 * everything else comes from our pre-filter so it can't hallucinate.
 */
function mergeAndRank(aiCandidates, eligibleDrivers, topN) {
  const byId = new Map(eligibleDrivers.map((d) => [d.driverId, d]));
  const seen = new Set();
  const merged = [];

  if (Array.isArray(aiCandidates)) {
    for (const c of aiCandidates) {
      if (!c || typeof c.driverId !== 'string') continue;
      const driver = byId.get(c.driverId);
      if (!driver || seen.has(driver.driverId)) continue;
      seen.add(driver.driverId);

      const rawScore = typeof c.score === 'number' ? c.score : parseFloat(c.score);
      const score = Number.isFinite(rawScore) ? Math.min(1, Math.max(0, rawScore)) : 0;

      merged.push({
        driverId: driver.driverId,
        score,
        rationale: (c.rationale || '').toString().slice(0, 500),
        hosRemaining: driver.hosRemaining,
        distanceMiles: driver.distanceMiles,
        equipmentMatch: driver.equipmentMatch,
        lastLoadWithCustomer: driver.lastLoadWithCustomer
      });
    }
  }

  // Append any eligible drivers the LLM forgot, with score 0.
  for (const d of eligibleDrivers) {
    if (seen.has(d.driverId)) continue;
    merged.push({
      driverId: d.driverId,
      score: 0,
      rationale: 'No ranking returned by AI for this candidate.',
      hosRemaining: d.hosRemaining,
      distanceMiles: d.distanceMiles,
      equipmentMatch: d.equipmentMatch,
      lastLoadWithCustomer: d.lastLoadWithCustomer
    });
  }

  return merged
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

async function handleLoadDriverMatch(req, res, deps) {
  const startedAt = Date.now();
  const validation = validateRequestBody(req.body);
  if (validation.error) {
    return res.status(400).json({
      success: false,
      error: validation.error,
      code: 'AI_BAD_REQUEST'
    });
  }
  const { loadId, load, candidateDrivers, topN } = validation;

  const { eligible, dropped } = preFilterCandidates(load, candidateDrivers);

  if (eligible.length === 0) {
    const processingTimeMs = Date.now() - startedAt;
    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Load ${loadId}: 0 eligible drivers (all ${candidateDrivers.length} dropped pre-LLM)`,
      conversationId: null,
      success: true,
      errorCode: 'AI_NO_ELIGIBLE_DRIVERS',
      processingTimeMs
    });
    return res.json({
      success: true,
      candidates: [],
      reasoning: 'No drivers had sufficient HOS to be considered.',
      meta: {
        droppedCount: dropped.length,
        eligibleCount: 0,
        processingTimeMs
      }
    });
  }

  const client = (deps && deps.anthropic) || getAnthropicClient();
  const model = process.env.ANTHROPIC_LOAD_MATCH_MODEL || 'claude-sonnet-4-20250514';

  try {
    const message = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0,
      // Static system prompt with prompt caching enabled (FN-1431 acceptance criterion).
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [{ role: 'user', content: buildUserMessage(load, eligible) }]
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
        message: `Load ${loadId}: AI returned unparseable response`,
        conversationId: null,
        success: false,
        errorCode: 'AI_PARSE_ERROR',
        processingTimeMs
      });
      return res.status(502).json({
        success: false,
        error: 'AI returned unparseable response',
        code: 'AI_PARSE_ERROR'
      });
    }

    const candidates = mergeAndRank(parsed.candidates, eligible, topN);
    const reasoning = typeof parsed.reasoning === 'string'
      ? parsed.reasoning.slice(0, 1000)
      : '';

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Load ${loadId}: ranked ${candidates.length} drivers (${dropped.length} dropped pre-LLM)`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs
    });

    return res.json({
      success: true,
      candidates,
      reasoning,
      meta: {
        model: message.model || model,
        droppedCount: dropped.length,
        eligibleCount: eligible.length,
        processingTimeMs
      }
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.error('[ai-service] load-driver-match error', err.message || err);

    logAiInteraction({
      userId: null,
      route: ROUTE,
      message: `Load ${loadId}: AI upstream failure`,
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
}

module.exports = {
  handleLoadDriverMatch,
  // Exported for testing
  validateRequestBody,
  preFilterCandidates,
  buildUserMessage,
  parseAiResponse,
  mergeAndRank,
  haversineMiles,
  SYSTEM_PROMPT,
  DEFAULT_TOP_N,
  MAX_TOP_N
};
