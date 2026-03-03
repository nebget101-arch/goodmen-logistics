const axios = require('axios');
const pdfParse = require('pdf-parse');

// Prompt template used for AI extraction of load details from a PDF.
// Returned here for reference and easier tweaking.
const LOAD_EXTRACTION_PROMPT = `
You are an expert freight dispatcher assistant.
Extract structured load information from the provided document.

Return ONLY a single JSON object, no markdown, no extra text.
The JSON MUST match this exact schema and key names:

{
  "brokerName": string | null,
  "poNumber": string | null,
  "rate": number | null,
  "pickup": {
    "date": string | null,        // ISO date or YYYY-MM-DD
    "city": string | null,
    "state": string | null,
    "zip": string | null,
    "address1": string | null
  },
  "delivery": {
    "date": string | null,        // ISO date or YYYY-MM-DD
    "city": string | null,
    "state": string | null,
    "zip": string | null,
    "address1": string | null
  },
  "notes": string | null,
  "confidence": {
    "brokerName": number,         // 0.0 - 1.0
    "poNumber": number,
    "rate": number,
    "pickup": number,
    "delivery": number
  },
  "rawTextSnippet": string | null
}

Guidelines:
- If a field is not present with high confidence, set it to null and its confidence near 0.
- "rate" should be numeric (no currency symbol), representing the line haul total.
- Prefer dates in YYYY-MM-DD format when possible.
- "rawTextSnippet" should include the 2-3 most relevant lines you used.
`;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_TOKEN || null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

// Hard caps to avoid exceeding org TPM limits once text is extracted.
const MAX_INPUT_CHARS = 120_000; // after filtering/windowing

function filterRelevantLines(text) {
  const lines = text.split(/\r?\n/);
  const keywords = /(pickup|pick-up|delivery|consignee|shipper|rate|total|linehaul|load|reference|broker|carrier|commodity|weight)/i;

  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (keywords.test(lines[i])) {
      const start = Math.max(0, i - 3);
      const end = Math.min(lines.length, i + 6);
      for (let j = start; j < end; j += 1) {
        kept.push(lines[j]);
      }
    }
  }
  return [...new Set(kept)].join('\n');
}

/**
 * Best-effort extraction of load details from a PDF buffer.
 * If OpenAI is not configured, returns a safe placeholder payload so the
 * frontend can continue with manual entry.
 *
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<object>}
 */
async function extractLoadFromPdf(buffer, filename) {
  // Fallback when no AI provider is configured.
  if (!OPENAI_API_KEY) {
    return {
      brokerName: null,
      poNumber: null,
      rate: null,
      pickup: { date: null, city: null, state: null, zip: null, address1: null },
      delivery: { date: null, city: null, state: null, zip: null, address1: null },
      notes: null,
      confidence: {
        brokerName: 0,
        poNumber: 0,
        rate: 0,
        pickup: 0,
        delivery: 0
      },
      rawTextSnippet: null,
      provider: 'none',
      warning: 'OPENAI_API_KEY is not configured; returned empty extraction payload.'
    };
  }

  // Extract text from the PDF. If this fails, fall back to a safe payload.
  let pdfText = '';
  try {
    const parsed = await pdfParse(buffer);
    pdfText = (parsed.text || '').trim();
  } catch (err) {
    return {
      brokerName: null,
      poNumber: null,
      rate: null,
      pickup: { date: null, city: null, state: null, zip: null, address1: null },
      delivery: { date: null, city: null, state: null, zip: null, address1: null },
      notes: null,
      confidence: {
        brokerName: 0,
        poNumber: 0,
        rate: 0,
        pickup: 0,
        delivery: 0
      },
      rawTextSnippet: null,
      provider: 'none',
      warning: 'Failed to read text from PDF (it may be a scanned image). Load not auto-extracted.'
    };
  }

  if (!pdfText) {
    return {
      brokerName: null,
      poNumber: null,
      rate: null,
      pickup: { date: null, city: null, state: null, zip: null, address1: null },
      delivery: { date: null, city: null, state: null, zip: null, address1: null },
      notes: null,
      confidence: {
        brokerName: 0,
        poNumber: 0,
        rate: 0,
        pickup: 0,
        delivery: 0
      },
      rawTextSnippet: null,
      provider: 'none',
      warning: 'No text detected in PDF (likely a scanned image); cannot auto-extract.'
    };
  }

  // Keep only lines near relevant keywords to shrink context.
  const windowed = filterRelevantLines(pdfText) || pdfText;
  let trimmed = windowed;
  let truncated = false;
  if (trimmed.length > MAX_INPUT_CHARS) {
    trimmed = trimmed.slice(0, MAX_INPUT_CHARS);
    truncated = true;
  }

  const messages = [
    {
      role: 'system',
      content: 'You are a helpful assistant that extracts trucking load details from rate confirmations and BOL PDFs.'
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            LOAD_EXTRACTION_PROMPT +
            `\n\nThe following is text extracted from a rate confirmation or BOL PDF. Filename: ${filename}\n\n` +
            (truncated
              ? 'NOTE: Only the most relevant portion of the text was provided due to size limits. Focus on data present in this excerpt.\n\n'
              : '') +
            'PDF_TEXT_START\n' +
            trimmed +
            '\nPDF_TEXT_END'
        }
      ]
    }
  ];

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: OPENAI_MODEL,
      messages,
      response_format: { type: 'json_object' },
      // Keep output small and structured
      max_tokens: 800
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  const choice = response.data?.choices?.[0];
  if (!choice?.message?.content) {
    throw new Error('AI extraction returned no content');
  }

  let parsed;
  try {
    parsed = JSON.parse(choice.message.content);
  } catch (err) {
    throw new Error('Failed to parse AI extraction JSON response');
  }

  // Basic shape validation; fill any missing core fields with null/defaults.
  const safe = {
    brokerName: parsed.brokerName ?? null,
    poNumber: parsed.poNumber ?? null,
    rate: parsed.rate != null ? Number(parsed.rate) : null,
    pickup: {
      date: parsed.pickup?.date ?? null,
      city: parsed.pickup?.city ?? null,
      state: parsed.pickup?.state ?? null,
      zip: parsed.pickup?.zip ?? null,
      address1: parsed.pickup?.address1 ?? null
    },
    delivery: {
      date: parsed.delivery?.date ?? null,
      city: parsed.delivery?.city ?? null,
      state: parsed.delivery?.state ?? null,
      zip: parsed.delivery?.zip ?? null,
      address1: parsed.delivery?.address1 ?? null
    },
    notes: parsed.notes ?? null,
    confidence: {
      brokerName: typeof parsed.confidence?.brokerName === 'number' ? parsed.confidence.brokerName : 0,
      poNumber: typeof parsed.confidence?.poNumber === 'number' ? parsed.confidence.poNumber : 0,
      rate: typeof parsed.confidence?.rate === 'number' ? parsed.confidence.rate : 0,
      pickup: typeof parsed.confidence?.pickup === 'number' ? parsed.confidence.pickup : 0,
      delivery: typeof parsed.confidence?.delivery === 'number' ? parsed.confidence.delivery : 0
    },
    rawTextSnippet: parsed.rawTextSnippet ?? null,
    provider: 'openai',
    model: OPENAI_MODEL
  };

  return safe;
}

module.exports = {
  extractLoadFromPdf,
  LOAD_EXTRACTION_PROMPT
};

