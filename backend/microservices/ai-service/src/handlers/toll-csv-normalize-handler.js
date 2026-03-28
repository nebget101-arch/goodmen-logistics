'use strict';

/**
 * FN-434: AI-powered toll CSV normalization handler.
 * Analyzes raw CSV headers + sample rows from toll provider exports
 * and returns column mappings, normalized data, and confidence scores.
 */

const { logAiInteraction } = require('../analytics/logger');

const TOLL_NORMALIZED_FIELDS = [
  { key: 'transaction_date', label: 'Transaction Date', required: true },
  { key: 'amount', label: 'Toll Amount', required: true },
  { key: 'provider_name', label: 'Toll Provider / Authority', required: false },
  { key: 'plaza_name', label: 'Plaza / Facility Name', required: false },
  { key: 'entry_location', label: 'Entry Location', required: false },
  { key: 'exit_location', label: 'Exit Location', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'state', label: 'State (2-letter)', required: false },
  { key: 'device_number', label: 'Transponder / Device Number', required: false },
  { key: 'plate_number', label: 'License Plate Number', required: false },
  { key: 'vehicle_class', label: 'Vehicle Class / Axle Count', required: false },
  { key: 'external_transaction_id', label: 'Transaction ID / Reference #', required: false },
  { key: 'posted_date', label: 'Posted / Settlement Date', required: false },
  { key: 'discount_amount', label: 'Discount Amount', required: false },
  { key: 'payment_type', label: 'Payment Type (tag/cash/video)', required: false },
];

const MAX_SAMPLE_ROWS = 20;

function buildTollNormalizePrompt(headers, sampleRows, providerName) {
  const fieldList = TOLL_NORMALIZED_FIELDS
    .map(f => `  - "${f.key}" (${f.label})${f.required ? ' [REQUIRED]' : ''}`)
    .join('\n');

  const headerStr = JSON.stringify(headers);
  const sampleStr = sampleRows.slice(0, MAX_SAMPLE_ROWS)
    .map((row, i) => `Row ${i + 1}: ${JSON.stringify(row)}`)
    .join('\n');

  return `You are a toll transaction data analyst for a fleet management system called FleetNeuron.

You will be given raw CSV column headers and sample data rows from a toll provider export.
${providerName ? `The reported provider is: ${providerName}` : 'The provider is unknown.'}

## Your Task

Analyze the headers and sample rows, then return a JSON object with:

### 1. columnMapping
Map each of these normalized fields to the best-matching raw CSV header (or null if no match):
${fieldList}

For each mapping, include a confidence score (0.0 to 1.0).

Format:
{
  "fieldName": { "rawHeader": "<CSV column name>", "confidence": 0.95 }
}

### 2. providerDetected
Identify the toll provider if recognizable. Known providers:
- BestPass, PrePass, EZPass (multi-state), SunPass (FL), FasTrak (CA)
- Illinois Tollway / I-PASS, Indiana Toll Road, Kansas Turnpike
- TxTag (TX), Peach Pass (GA), Good To Go! (WA), Pay-By-Plate MA

### 3. dateFormat
Detect the date format used in the CSV. Return the pattern (e.g., "MM/DD/YYYY", "YYYY-MM-DD", "DD-Mon-YY").

### 4. amountFormat
Describe the amount format: has currency symbol? has commas? negative values format?

### 5. locationStrategy
How location data appears:
- "separate_columns": city, state, plaza in different columns
- "merged_field": single column with combined location info (needs splitting)
- "entry_exit": separate entry/exit columns

### 6. normalizedSampleRows
Return the first 5 sample rows with data normalized to target schema:
- Dates in YYYY-MM-DD format
- Amounts as plain numbers (no $, no commas)
- State codes as 2-letter uppercase
- Split merged location fields into plaza_name, city, state

### 7. duplicateIndices
Array of 0-based row indices that appear to be duplicates of each other (same date + amount + location).

### 8. overallConfidence
A single 0.0–1.0 score for overall mapping quality.

## Raw CSV Headers
${headerStr}

## Sample Data Rows
${sampleStr}

## Output Format
Return ONLY valid JSON matching the schema above. No markdown fences.`;
}

function parseAiResponse(content) {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

function validateNormalizeResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('AI returned invalid response structure');
  }
  if (!result.columnMapping || typeof result.columnMapping !== 'object') {
    result.columnMapping = {};
  }
  if (typeof result.overallConfidence !== 'number') {
    result.overallConfidence = 0.5;
  }
  if (!result.providerDetected) {
    result.providerDetected = null;
  }
  if (!result.dateFormat) {
    result.dateFormat = null;
  }
  if (!result.amountFormat) {
    result.amountFormat = null;
  }
  if (!result.locationStrategy) {
    result.locationStrategy = 'separate_columns';
  }
  if (!Array.isArray(result.normalizedSampleRows)) {
    result.normalizedSampleRows = [];
  }
  if (!Array.isArray(result.duplicateIndices)) {
    result.duplicateIndices = [];
  }
  return result;
}

async function handleTollCsvNormalize(req, res, deps) {
  const startedAt = Date.now();
  try {
    const { openai } = deps;
    const { headers, sampleRows, totalRows, providerName } = req.body || {};

    if (!headers || !Array.isArray(headers) || headers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'headers array is required',
        code: 'AI_BAD_REQUEST',
      });
    }

    if (!sampleRows || !Array.isArray(sampleRows) || sampleRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'sampleRows array is required',
        code: 'AI_BAD_REQUEST',
      });
    }

    const prompt = buildTollNormalizePrompt(headers, sampleRows, providerName);

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You are a precise toll data mapping assistant. Return ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const processingTimeMs = Date.now() - startedAt;
    const aiContent = completion.choices[0]?.message?.content || '{}';

    let result;
    try {
      result = parseAiResponse(aiContent);
      result = validateNormalizeResult(result);
    } catch (parseErr) {
      console.error('[ai-service] toll CSV normalize parse error', parseErr.message);
      return res.status(502).json({
        success: false,
        error: 'AI returned unparseable response',
        code: 'AI_PARSE_ERROR',
      });
    }

    if (totalRows) {
      result.totalRows = totalRows;
    }

    logAiInteraction({
      userId: null,
      route: '/tolls/csv-normalize',
      message: `Toll CSV normalize: ${headers.length} headers, ${sampleRows.length} sample rows, confidence ${result.overallConfidence}`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs,
    });

    return res.json({
      success: true,
      data: result,
      processingTimeMs,
    });
  } catch (err) {
    const processingTimeMs = Date.now() - startedAt;
    console.error('[ai-service] toll CSV normalize error', err.message || err);

    logAiInteraction({
      userId: null,
      route: '/tolls/csv-normalize',
      message: `Toll CSV normalize failed: ${err.message || 'Unknown error'}`,
      conversationId: null,
      success: false,
      errorCode: err.status ? `HTTP_${err.status}` : 'AI_ERROR',
      processingTimeMs,
    });

    return res.status(502).json({
      success: false,
      error: 'AI toll CSV normalization failed',
      code: 'AI_NORMALIZE_ERROR',
      details: err.message || 'Unknown error',
    });
  }
}

module.exports = { handleTollCsvNormalize };
