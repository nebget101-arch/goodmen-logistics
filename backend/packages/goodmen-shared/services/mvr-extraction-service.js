/**
 * FN-264: MVR (Motor Vehicle Report) AI extraction service.
 *
 * Uses the Anthropic Messages API (Claude) to extract structured MVR data
 * from raw PDF text. Falls back to a manual-entry skeleton when
 * ANTHROPIC_API_KEY is not configured.
 */

const axios = require('axios');
const dtLogger = require('../utils/logger');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const MVR_EXTRACTION_PROMPT = `You are an expert compliance analyst for a trucking fleet management company.
Extract structured MVR (Motor Vehicle Report) data from the provided text.

Return ONLY a single JSON object with no markdown, no extra text.
The JSON MUST match this exact schema and key names:

{
  "licenseNumber": string | null,
  "licenseState": string | null,
  "licenseStatus": string | null,
  "licenseClass": string | null,
  "licenseExpiry": string | null,
  "endorsements": string | null,
  "restrictions": string | null,
  "violations": [
    {
      "date": string | null,
      "description": string | null,
      "code": string | null,
      "points": number | null,
      "disposition": string | null
    }
  ],
  "accidents": [
    {
      "date": string | null,
      "description": string | null,
      "fatalities": number | null,
      "injuries": number | null,
      "hazmat": boolean | null,
      "type": string | null
    }
  ],
  "pointsTotal": number | null,
  "reportDate": string | null
}

Guidelines:
- Dates should be in YYYY-MM-DD format when possible.
- licenseStatus should be one of: "valid", "suspended", "revoked", "expired", or the exact text if none match.
- licenseClass should be the CDL class (A, B, C) or full class description.
- endorsements: comma-separated list of endorsement codes (H, N, T, P, S, X, etc.).
- restrictions: comma-separated list of restriction codes or descriptions.
- violations array: include every violation/conviction listed. Each entry needs date, description, violation code, points assessed, and disposition (convicted, dismissed, pending, etc.).
- accidents array: include every accident listed. fatalities and injuries are counts. hazmat indicates hazardous materials involvement. type is the accident classification.
- pointsTotal: sum of all active points on the record. If not explicitly stated, sum from the violations array.
- reportDate: the date the MVR report was generated/pulled.
- If a field is not found in the text, set it to null.
- For arrays, return an empty array [] if no entries are found.`;

/**
 * Build a fallback manual-entry structure when AI extraction is unavailable.
 */
function buildManualEntryFallback() {
  return {
    licenseNumber: null,
    licenseState: null,
    licenseStatus: null,
    licenseClass: null,
    licenseExpiry: null,
    endorsements: null,
    restrictions: null,
    violations: [],
    accidents: [],
    pointsTotal: null,
    reportDate: null,
    extractionMethod: 'manual',
    warning: 'ANTHROPIC_API_KEY is not configured; MVR data must be entered manually.'
  };
}

/**
 * Validate and normalize the extracted MVR data structure.
 */
function normalizeExtractedData(parsed) {
  const violations = Array.isArray(parsed.violations)
    ? parsed.violations.map((v) => ({
        date: v.date ?? null,
        description: v.description ?? null,
        code: v.code ?? null,
        points: typeof v.points === 'number' ? v.points : null,
        disposition: v.disposition ?? null
      }))
    : [];

  const accidents = Array.isArray(parsed.accidents)
    ? parsed.accidents.map((a) => ({
        date: a.date ?? null,
        description: a.description ?? null,
        fatalities: typeof a.fatalities === 'number' ? a.fatalities : null,
        injuries: typeof a.injuries === 'number' ? a.injuries : null,
        hazmat: typeof a.hazmat === 'boolean' ? a.hazmat : null,
        type: a.type ?? null
      }))
    : [];

  // Compute pointsTotal from violations if not provided
  let pointsTotal = typeof parsed.pointsTotal === 'number' ? parsed.pointsTotal : null;
  if (pointsTotal === null && violations.length > 0) {
    const sum = violations.reduce((acc, v) => acc + (v.points || 0), 0);
    if (sum > 0) pointsTotal = sum;
  }

  return {
    licenseNumber: parsed.licenseNumber ?? null,
    licenseState: parsed.licenseState ?? null,
    licenseStatus: parsed.licenseStatus ?? null,
    licenseClass: parsed.licenseClass ?? null,
    licenseExpiry: parsed.licenseExpiry ?? null,
    endorsements: parsed.endorsements ?? null,
    restrictions: parsed.restrictions ?? null,
    violations,
    accidents,
    pointsTotal,
    reportDate: parsed.reportDate ?? null,
    extractionMethod: 'ai'
  };
}

/**
 * Extract structured MVR data from raw PDF text using Claude.
 *
 * @param {string} pdfText - Raw text extracted from the MVR PDF
 * @returns {Promise<object>} Structured MVR data
 */
async function extractMvrData(pdfText) {
  if (!ANTHROPIC_API_KEY) {
    dtLogger.warn('mvr_extraction_skipped_no_key', { reason: 'ANTHROPIC_API_KEY not set' });
    return buildManualEntryFallback();
  }

  if (!pdfText || pdfText.trim().length < 20) {
    dtLogger.warn('mvr_extraction_skipped_no_text', { length: (pdfText || '').length });
    return {
      ...buildManualEntryFallback(),
      extractionMethod: 'manual',
      warning: 'Insufficient text extracted from PDF for AI analysis.'
    };
  }

  // Truncate very long text to stay within token limits
  const MAX_CHARS = 80_000;
  const trimmed = pdfText.length > MAX_CHARS ? pdfText.slice(0, MAX_CHARS) : pdfText;

  dtLogger.info('mvr_extraction_start', { textLength: trimmed.length });

  try {
    const response = await axios.post(
      ANTHROPIC_API_URL,
      {
        model: ANTHROPIC_MODEL,
        max_tokens: 2000,
        system: MVR_EXTRACTION_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Extract MVR data from the following report text:\n\nMVR_TEXT_START\n${trimmed}\nMVR_TEXT_END`
          }
        ]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const content = response.data?.content;
    if (!content || !Array.isArray(content) || content.length === 0) {
      throw new Error('Anthropic API returned no content blocks');
    }

    const textBlock = content.find((b) => b.type === 'text');
    if (!textBlock?.text) {
      throw new Error('Anthropic API returned no text content');
    }

    let parsed;
    try {
      // Strip any markdown code fences if present
      let raw = textBlock.text.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      dtLogger.error('mvr_extraction_json_parse_failed', parseErr, {
        rawResponse: textBlock.text.slice(0, 500)
      });
      throw new Error('Failed to parse AI extraction JSON response');
    }

    const normalized = normalizeExtractedData(parsed);
    dtLogger.info('mvr_extraction_complete', {
      violationCount: normalized.violations.length,
      accidentCount: normalized.accidents.length,
      pointsTotal: normalized.pointsTotal,
      hasLicense: !!normalized.licenseNumber
    });

    return normalized;
  } catch (error) {
    dtLogger.error('mvr_extraction_failed', error, {
      status: error.response?.status,
      message: error.message
    });

    // Return manual-entry fallback on AI failure
    return {
      ...buildManualEntryFallback(),
      warning: `AI extraction failed: ${error.message}. MVR data must be entered manually.`
    };
  }
}

module.exports = {
  extractMvrData,
  normalizeExtractedData,
  buildManualEntryFallback,
  MVR_EXTRACTION_PROMPT
};
