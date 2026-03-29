'use strict';

/**
 * FN-476: AI-Powered Fuzzy Driver Name Matching for FMCSA Inspections.
 * Uses Claude to fuzzy-match an FMCSA driver name (e.g. "HORTON, TYRON D")
 * against a list of fleet drivers, handling abbreviations, nicknames,
 * misspellings, and last-name-first formatting.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logAiInteraction } = require('../analytics/logger');

// Lazy-init Anthropic client
let anthropicClient = null;
function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic.default({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

const CONFIDENCE_AUTO_MATCH = 0.85;
const CONFIDENCE_SUGGEST = 0.5;

function buildDriverMatchPrompt(fmcsaDriverName, fleetDrivers) {
  const driverList = fleetDrivers
    .map((d, i) => `  ${i + 1}. id="${d.id}" — ${d.first_name} ${d.last_name}${d.cdl_number ? ` (CDL: ${d.cdl_number})` : ''}`)
    .join('\n');

  return `You are a driver name matching specialist for a fleet management system.

You will be given one FMCSA driver name (exactly as it appears on an inspection report) and a list of fleet drivers. Your job is to determine which fleet driver (if any) matches the FMCSA name.

## FMCSA Driver Name
"${fmcsaDriverName}"

## Fleet Drivers
${driverList}

## Matching Rules
1. FMCSA names are typically in "LAST, FIRST MIDDLE_INITIAL" format (e.g. "HORTON, TYRON D")
2. Handle abbreviations: "T. Horton" should match "Tyron Horton"
3. Handle common nicknames: "Tony" = "Anthony", "Bob" = "Robert", "Bill" = "William", "Mike" = "Michael", "Jim" = "James", "Joe" = "Joseph", "Tom" = "Thomas", "Dick" = "Richard", "Ted" = "Edward/Theodore", "Chuck" = "Charles", "Dan" = "Daniel", "Dave" = "David", "Ed" = "Edward", "Jack" = "John", "Jeff" = "Jeffrey", "Jerry" = "Gerald/Jerome", "Larry" = "Lawrence", "Pat" = "Patrick/Patricia", "Rick" = "Richard", "Ron" = "Ronald", "Sam" = "Samuel", "Steve" = "Stephen", "Tim" = "Timothy"
4. Handle misspellings with tolerance (e.g. "HORTEN" ~ "HORTON")
5. Middle initials may or may not be present
6. Names may be truncated or abbreviated
7. Case should be ignored entirely

## Confidence Scoring
- 1.0: Exact match after normalization (same first + last)
- 0.90-0.99: Strong match (first initial matches full name, or minor spelling difference)
- 0.85-0.89: Good match (nickname to full name, or two minor differences)
- 0.50-0.84: Possible match (partial match, needs human review)
- 0.0-0.49: No meaningful match

## Response Format
Return ONLY this JSON structure with no markdown fences:
{
  "candidates": [
    {
      "driverId": "<uuid>",
      "confidence": 0.95,
      "reasoning": "Brief explanation of why this matches or doesn't"
    }
  ]
}

Rules for the candidates array:
- Include ALL fleet drivers with confidence >= 0.3
- Sort by confidence descending
- If no driver matches above 0.3, return an empty candidates array
- Maximum 5 candidates`;
}

function parseAiResponse(content) {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

function validateMatchResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('AI returned invalid response structure');
  }
  if (!Array.isArray(result.candidates)) {
    throw new Error('AI response missing candidates array');
  }
  // Ensure each candidate has required fields
  result.candidates = result.candidates
    .filter((c) => c && typeof c.driverId === 'string' && typeof c.confidence === 'number')
    .map((c) => ({
      driverId: c.driverId,
      confidence: Math.min(1, Math.max(0, c.confidence)),
      reasoning: (c.reasoning || '').toString().slice(0, 500),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  return result;
}

function classifyMatch(candidates) {
  if (!candidates.length) {
    return { match: null, status: 'no_match' };
  }

  const top = candidates[0];
  if (top.confidence >= CONFIDENCE_AUTO_MATCH) {
    return { match: top, status: 'auto_match' };
  }
  if (top.confidence >= CONFIDENCE_SUGGEST) {
    return { match: top, status: 'suggest' };
  }
  return { match: null, status: 'no_match' };
}

async function handleFmcsaDriverMatch(req, res) {
  const startedAt = Date.now();
  try {
    const { fmcsaDriverName, fleetDrivers } = req.body || {};

    if (!fmcsaDriverName || typeof fmcsaDriverName !== 'string' || !fmcsaDriverName.trim()) {
      return res.status(400).json({
        success: false,
        error: 'fmcsaDriverName string is required',
        code: 'AI_BAD_REQUEST',
      });
    }

    if (!fleetDrivers || !Array.isArray(fleetDrivers) || fleetDrivers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'fleetDrivers array is required and must not be empty',
        code: 'AI_BAD_REQUEST',
      });
    }

    // Cap fleet drivers to avoid oversized prompts
    const MAX_FLEET_DRIVERS = 200;
    const driversToMatch = fleetDrivers.slice(0, MAX_FLEET_DRIVERS);

    const prompt = buildDriverMatchPrompt(fmcsaDriverName.trim(), driversToMatch);
    const client = getAnthropicClient();

    const message = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const processingTimeMs = Date.now() - startedAt;
    const aiContent = message.content?.[0]?.text || '{}';

    let result;
    try {
      result = parseAiResponse(aiContent);
      result = validateMatchResult(result);
    } catch (parseErr) {
      // eslint-disable-next-line no-console
      console.error('[ai-service] fmcsa driver match parse error', parseErr.message);
      return res.status(502).json({
        success: false,
        error: 'AI returned unparseable response',
        code: 'AI_PARSE_ERROR',
      });
    }

    const { match, status } = classifyMatch(result.candidates);

    logAiInteraction({
      userId: null,
      route: '/fmcsa/match-driver',
      message: `FMCSA driver match: "${fmcsaDriverName}" against ${driversToMatch.length} fleet drivers — ${status}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs,
    });

    return res.json({
      success: true,
      match: match
        ? {
            driverId: match.driverId,
            confidence: match.confidence,
            reasoning: match.reasoning,
          }
        : null,
      status,
      candidates: result.candidates,
      meta: {
        model: message.model,
        processingTimeMs,
        driversEvaluated: driversToMatch.length,
        fmcsaDriverName: fmcsaDriverName.trim(),
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] fmcsa driver match error', err);

    logAiInteraction({
      userId: null,
      route: '/fmcsa/match-driver',
      message: null,
      conversationId: null,
      success: false,
      errorCode: 'AI_UNAVAILABLE',
      processingTimeMs: Date.now() - startedAt,
    });

    return res.status(502).json({
      success: false,
      error: 'AI service unavailable',
      code: 'AI_UNAVAILABLE',
    });
  }
}

module.exports = {
  handleFmcsaDriverMatch,
  // Exported for testing
  buildDriverMatchPrompt,
  parseAiResponse,
  validateMatchResult,
  classifyMatch,
  CONFIDENCE_AUTO_MATCH,
  CONFIDENCE_SUGGEST,
};
