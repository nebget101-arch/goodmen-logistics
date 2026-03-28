'use strict';

/**
 * FN-406: AI-assisted fuel import preprocessing handler.
 * Analyzes raw CSV/XLSX headers + sample rows to produce:
 *   - Column mapping with confidence scores
 *   - Product type inference
 *   - Row split proposals
 *   - Skip/flag detection (Money Code, card-less)
 */

const { logAiInteraction } = require('../analytics/logger');

// Normalized fields the AI maps raw headers to
const FUEL_NORMALIZED_FIELDS = [
  { key: 'transaction_date', label: 'Transaction Date', required: true },
  { key: 'gallons', label: 'Gallons', required: true },
  { key: 'amount', label: 'Total Amount', required: true },
  { key: 'unit_number_raw', label: 'Truck Unit', required: false },
  { key: 'driver_name_raw', label: 'Driver Name', required: false },
  { key: 'card_number_masked', label: 'Card Number', required: false },
  { key: 'vendor_name', label: 'Vendor / Station', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'state', label: 'State', required: false },
  { key: 'price_per_gallon', label: 'Price Per Gallon', required: false },
  { key: 'odometer', label: 'Odometer', required: false },
  { key: 'product_type', label: 'Product Type', required: false },
  { key: 'posted_date', label: 'Posted Date', required: false },
  { key: 'provider_name', label: 'Provider Name', required: false },
  { key: 'external_transaction_id', label: 'External Transaction ID', required: false },
  { key: 'category', label: 'Category', required: false },
];

const MAX_SAMPLE_ROWS = 20;

function buildFuelPreprocessPrompt(headers, sampleRows, providerName) {
  const fieldList = FUEL_NORMALIZED_FIELDS
    .map(f => `  - "${f.key}" (${f.label})${f.required ? ' [REQUIRED]' : ''}`)
    .join('\n');

  return `You are a fuel transaction data analyst for a fleet management system called FleetNeuron.

You will be given raw CSV/XLSX column headers and sample data rows from a fuel card vendor report.
${providerName ? `The reported provider is: ${providerName}` : 'The provider is unknown.'}

## Your Task

Analyze the headers and sample rows, then return a JSON object with the following structure:

### 1. columnMapping
Map each of these normalized fields to the best-matching raw header (or null if no match):
${fieldList}

For each mapping, include a confidence score (0.0 to 1.0).

### 2. productTypeColumn
Identify which raw header (if any) contains product type info (e.g., "Diesel", "DEF", "Reefer").
Return the raw header name or null.

### 3. splitStrategy
Detect if rows need splitting:
- "multi_column": Multiple product-amount columns exist (e.g., "Diesel Gallons", "DEF Gallons", "Reefer Gallons")
- "description_parse": A single description/product column contains values that map to multiple product types
- "none": Standard single-product rows

Include details about which columns would be split.

### 4. rowAnalysis
Count how many rows are:
- normalRows: Standard fuel transactions
- splitRows: Rows needing product-type splitting
- skipRows: Money Code rows (monetary advances with no fuel product), card-less rows with $0 gallons
- flaggedRows: Ambiguous or low-confidence rows

### 5. skippedRowIndices
Array of 0-based row indices that should be skipped.

### 6. flaggedRows
Array of { rowNumber, reason, confidence } for rows needing human review.

### 7. overallConfidence
Float 0.0-1.0 representing overall mapping quality.

## Rules
- Money Code detection: rows with amount > 0 but gallons = 0 and no product type
- Card-less detection: rows missing card number entirely
- Be conservative with confidence — if unsure, use 0.5 or lower
- Return ONLY valid JSON, no markdown fences, no explanation

## Raw Headers
${JSON.stringify(headers)}

## Sample Rows (up to ${MAX_SAMPLE_ROWS})
${JSON.stringify(sampleRows.slice(0, MAX_SAMPLE_ROWS), null, 2)}

## Response Format
Return ONLY this JSON structure:
{
  "columnMapping": { "<normalized_key>": { "rawHeader": "<header>" | null, "confidence": 0.95 } },
  "productTypeColumn": "<header>" | null,
  "splitStrategy": { "type": "multi_column" | "description_parse" | "none", "details": {} },
  "rowAnalysis": { "totalRows": N, "normalRows": N, "splitRows": N, "skipRows": N, "flaggedRows": N },
  "skippedRowIndices": [],
  "flaggedRows": [],
  "overallConfidence": 0.88
}`;
}

function parseAiResponse(content) {
  // Strip markdown fences if present
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

function validateAiResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('AI returned invalid response structure');
  }
  if (!result.columnMapping || typeof result.columnMapping !== 'object') {
    throw new Error('AI response missing columnMapping');
  }
  if (typeof result.overallConfidence !== 'number') {
    result.overallConfidence = 0.5;
  }
  if (!result.rowAnalysis) {
    result.rowAnalysis = { totalRows: 0, normalRows: 0, splitRows: 0, skipRows: 0, flaggedRows: 0 };
  }
  if (!result.splitStrategy) {
    result.splitStrategy = { type: 'none', details: {} };
  }
  if (!Array.isArray(result.skippedRowIndices)) {
    result.skippedRowIndices = [];
  }
  if (!Array.isArray(result.flaggedRows)) {
    result.flaggedRows = [];
  }
  return result;
}

async function handleFuelPreprocess(req, res, deps) {
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

    const prompt = buildFuelPreprocessPrompt(headers, sampleRows, providerName);

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You are a precise data mapping assistant. Return ONLY valid JSON.' },
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
      result = validateAiResult(result);
    } catch (parseErr) {
      // eslint-disable-next-line no-console
      console.error('[ai-service] fuel preprocess parse error', parseErr.message);
      return res.status(502).json({
        success: false,
        error: 'AI returned unparseable response',
        code: 'AI_PARSE_ERROR',
      });
    }

    // Inject total row count from caller (AI only sees sample)
    if (totalRows) {
      result.rowAnalysis.totalRows = totalRows;
    }

    logAiInteraction({
      userId: null,
      route: '/fuel/preprocess',
      message: `Fuel preprocess: ${headers.length} headers, ${sampleRows.length} sample rows`,
      conversationId: null,
      success: true,
      errorCode: null,
      processingTimeMs,
    });

    return res.json({
      success: true,
      data: result,
      meta: {
        model: completion.model,
        processingTimeMs,
        headersAnalyzed: headers.length,
        sampleRowsAnalyzed: Math.min(sampleRows.length, MAX_SAMPLE_ROWS),
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-service] fuel preprocess error', err);

    logAiInteraction({
      userId: null,
      route: '/fuel/preprocess',
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
  handleFuelPreprocess,
};
