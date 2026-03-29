'use strict';

/**
 * FN-478: PSP (Pre-employment Screening Program) report extraction service.
 *
 * Uses the Anthropic Messages API (Claude Vision) to extract structured
 * inspection, violation, and crash data from PSP report images or PDFs.
 * Falls back gracefully when ANTHROPIC_API_KEY is not configured.
 */

const axios = require('axios');
const dtLogger = require('../utils/logger');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-20250514';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const SUPPORTED_DOC_TYPES = ['application/pdf'];

const PSP_EXTRACTION_PROMPT = `You are a compliance analyst for a trucking fleet management system (FleetNeuron).
You have been given a PSP (Pre-employment Screening Program) report issued by the FMCSA.

Extract ALL data from this report and return a JSON object with this exact structure:

{
  "driver_name": "<full name or null>",
  "driver_license": "<CDL number or null>",
  "driver_license_state": "<2-letter state or null>",
  "inspections": [
    {
      "report_number": "<string or null>",
      "inspection_date": "<YYYY-MM-DD or null>",
      "state": "<2-letter state code>",
      "level": "<'I', 'II', 'III', 'IV', 'V', or 'VI'>",
      "driver_oos": <boolean — true if driver was placed out of service>,
      "vehicle_oos": <boolean — true if vehicle was placed out of service>,
      "hazmat": <boolean>,
      "total_weight": <number or null>,
      "time_weight": <number or null>,
      "violations": [
        {
          "code": "<violation code, e.g. '392.2'>",
          "description": "<violation description>",
          "basic_category": "<one of: 'Unsafe Driving', 'HOS Compliance', 'Vehicle Maintenance', 'Controlled Substances/Alcohol', 'Driver Fitness', 'Hazmat', 'Crash Indicator', 'Other'>",
          "oos": <boolean — true if violation caused out-of-service>,
          "unit": "<unit number or null>",
          "severity_weight": <number or null>
        }
      ]
    }
  ],
  "crashes": [
    {
      "date": "<YYYY-MM-DD or null>",
      "state": "<2-letter state or null>",
      "report_number": "<string or null>",
      "fatal": <boolean>,
      "injury": <boolean>,
      "tow": <boolean>,
      "hazmat": <boolean>,
      "fatalities": <number, 0 if none>,
      "injuries": <number, 0 if none>
    }
  ],
  "report_date": "<YYYY-MM-DD or null>",
  "period_years": <number — years of history covered, typically 3 for inspections, 5 for crashes>,
  "confidence": <0.0 to 1.0>,
  "warnings": ["<any extraction uncertainties or unclear fields>"]
}

## Rules
1. Extract EVERY inspection record — PSP reports may have 0-50+ inspections.
2. Extract EVERY crash record.
3. Dates must be YYYY-MM-DD format.
4. Inspection levels: Level I = Full Inspection, Level II = Walk-Around, Level III = Driver Only, Level IV = Special Study, Level V = Vehicle Only, Level VI = Enhanced.
5. For violations, map to the closest BASIC category based on the violation code or description.
6. Driver OOS = driver was taken out of service during this inspection.
7. Vehicle OOS = vehicle was placed out of service.
8. If inspections section is empty, return an empty array.
9. Return ONLY valid JSON. No markdown, no explanatory text.`;

/**
 * Build a fallback structure when extraction is unavailable.
 */
function buildFallback(reason) {
  return {
    driver_name: null,
    driver_license: null,
    driver_license_state: null,
    inspections: [],
    crashes: [],
    report_date: null,
    period_years: null,
    confidence: 0,
    warnings: [reason],
    extractionMethod: 'manual'
  };
}

/**
 * Normalize and validate the AI-extracted PSP data.
 */
function normalizeExtraction(raw) {
  const inspections = Array.isArray(raw.inspections)
    ? raw.inspections.map((insp) => ({
        report_number: insp.report_number || null,
        inspection_date: insp.inspection_date || null,
        state: insp.state ? String(insp.state).toUpperCase().slice(0, 2) : null,
        level: insp.level || null,
        driver_oos: !!insp.driver_oos,
        vehicle_oos: !!insp.vehicle_oos,
        hazmat: !!insp.hazmat,
        total_weight: typeof insp.total_weight === 'number' ? insp.total_weight : null,
        time_weight: typeof insp.time_weight === 'number' ? insp.time_weight : null,
        violations: Array.isArray(insp.violations)
          ? insp.violations.map((v) => ({
              code: v.code || null,
              description: v.description || null,
              basic_category: v.basic_category || 'Other',
              oos: !!v.oos,
              unit: v.unit || null,
              severity_weight: typeof v.severity_weight === 'number' ? v.severity_weight : null
            }))
          : []
      }))
    : [];

  const crashes = Array.isArray(raw.crashes)
    ? raw.crashes.map((c) => ({
        date: c.date || null,
        state: c.state ? String(c.state).toUpperCase().slice(0, 2) : null,
        report_number: c.report_number || null,
        fatal: !!c.fatal,
        injury: !!c.injury,
        tow: !!c.tow,
        hazmat: !!c.hazmat,
        fatalities: typeof c.fatalities === 'number' ? c.fatalities : 0,
        injuries: typeof c.injuries === 'number' ? c.injuries : 0
      }))
    : [];

  return {
    driver_name: raw.driver_name || null,
    driver_license: raw.driver_license || null,
    driver_license_state: raw.driver_license_state || null,
    inspections,
    crashes,
    report_date: raw.report_date || null,
    period_years: raw.period_years || null,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    extractionMethod: 'ai'
  };
}

/**
 * Extract structured data from a PSP report image or PDF.
 *
 * @param {Buffer} fileBuffer - File buffer (image or PDF)
 * @param {string} mimeType   - MIME type (image/* or application/pdf)
 * @returns {Promise<object>} Structured PSP data
 */
async function extractPspData(fileBuffer, mimeType) {
  if (!ANTHROPIC_API_KEY) {
    dtLogger.warn('psp_extraction_skipped_no_key', { reason: 'ANTHROPIC_API_KEY not set' });
    return buildFallback('ANTHROPIC_API_KEY is not configured; PSP data must be entered manually.');
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    return buildFallback('Empty file buffer provided.');
  }

  const normalizedType = (mimeType || '').toLowerCase();
  const isImage = SUPPORTED_IMAGE_TYPES.includes(normalizedType);
  const isPdf = SUPPORTED_DOC_TYPES.includes(normalizedType);

  if (!isImage && !isPdf) {
    return buildFallback(`Unsupported file type: ${mimeType}. Supported: images and PDFs.`);
  }

  const fileBase64 = fileBuffer.toString('base64');

  dtLogger.info('psp_extraction_start', { mimeType, sizeBytes: fileBuffer.length });

  // Build the content block depending on file type
  const contentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
    : { type: 'image', source: { type: 'base64', media_type: normalizedType, data: fileBase64 } };

  try {
    const response = await axios.post(
      ANTHROPIC_API_URL,
      {
        model: ANTHROPIC_MODEL,
        max_tokens: 8192,
        system: 'You are a precise PSP report data extraction assistant. Return ONLY valid JSON.',
        messages: [
          {
            role: 'user',
            content: [
              contentBlock,
              { type: 'text', text: PSP_EXTRACTION_PROMPT }
            ]
          }
        ],
        temperature: 0.1
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        timeout: 60000
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
      let raw = textBlock.text.trim();
      if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      dtLogger.error('psp_extraction_json_parse_failed', parseErr, {
        rawResponse: textBlock.text.slice(0, 500)
      });
      throw new Error('Failed to parse AI extraction JSON response');
    }

    const normalized = normalizeExtraction(parsed);
    dtLogger.info('psp_extraction_complete', {
      inspectionCount: normalized.inspections.length,
      crashCount: normalized.crashes.length,
      confidence: normalized.confidence,
      hasDriver: !!normalized.driver_name
    });

    return normalized;
  } catch (err) {
    dtLogger.error('psp_extraction_failed', err, {
      status: err.response?.status,
      message: err.message
    });
    return {
      ...buildFallback(`AI extraction failed: ${err.message}. PSP data must be entered manually.`),
      extractionMethod: 'manual'
    };
  }
}

module.exports = {
  extractPspData,
  normalizeExtraction,
  buildFallback,
  PSP_EXTRACTION_PROMPT
};
