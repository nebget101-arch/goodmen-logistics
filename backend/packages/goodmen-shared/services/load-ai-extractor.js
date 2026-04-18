const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const pdfParse = require('pdf-parse');
const dtLogger = require('../utils/logger');

const execFileAsync = promisify(execFile);

// Prompt template used for AI extraction of load details from a PDF.
const LOAD_EXTRACTION_PROMPT = `
You are an expert freight dispatcher assistant.
Extract structured load information from the provided document.

Return ONLY a single JSON object, no markdown, no extra text.
The JSON MUST match this exact schema and key names:

{
  "brokerName": string | null,
  "poNumber": string | null,
  "loadId": string | null,
  "orderId": string | null,
  "proNumber": string | null,
  "rate": number | null,
  "pickup": {
    "date": string | null,
    "city": string | null,
    "state": string | null,
    "zip": string | null,
    "address1": string | null
  },
  "delivery": {
    "date": string | null,
    "city": string | null,
    "state": string | null,
    "zip": string | null,
    "address1": string | null
  },
  "stops": [
    {
      "type": "PICKUP" | "DELIVERY",
      "sequence": 1,
      "date": string | null,
      "city": string | null,
      "state": string | null,
      "zip": string | null,
      "address1": string | null,
      "appointment_time_from": string | null,
      "appointment_time_to": string | null,
      "contact_name": string | null,
      "contact_phone": string | null,
      "facility_name": string | null,
      "reference_number": string | null
    }
  ],
  "commodity": string | null,
  "weight_lbs": number | null,
  "pieces": number | null,
  "special_instructions": string | null,
  "is_hazmat": boolean | null,
  "detention_free_hours": number | null,
  "temperature_min": number | null,
  "temperature_max": number | null,
  "notes": string | null,
  "confidence": { "brokerName": number, "poNumber": number, "rate": number, "pickup": number, "delivery": number },
  "rawTextSnippet": string | null
}

Guidelines:
- If a field is not present with high confidence, set it to null and its confidence near 0.
- loadId/orderId/proNumber: extract Load #, Order #, PRO #, Reference #, conf# when present.
- "rate": numeric only, line haul total (e.g. "Line Haul" line). Prefer dates YYYY-MM-DD.
- "rawTextSnippet": 2-3 most relevant lines you used.

Stops (REQUIRED – always return this array):
- "stops" MUST be an array listing every pickup and delivery in order. Each item: type "PICKUP" or "DELIVERY", sequence (1, 2, 3...), and date/city/state/zip/address1 when known.
- One pickup only: stops = [{ type: "PICKUP", sequence: 1, ... }].
- One pickup + one delivery: stops = [{ type: "PICKUP", sequence: 1, ... }, { type: "DELIVERY", sequence: 2, ... }].
- Multiple pickups and/or deliveries: include every stop in order. Do not merge multiple stops into one.
- Multi-stop routes (A->B->C->D): extract ALL stops in route order. A rate con may have 2, 3, 4, or more stops. Output every one.

Stop-level fields (per stop):
- "appointment_time_from" / "appointment_time_to": appointment or time window for the stop (e.g. "08:00" and "12:00" for "8:00 AM - 12:00 PM"). Use 24-hour HH:MM format. If only a single appointment time is given, put it in "appointment_time_from" and set "appointment_time_to" to null. If no time window is mentioned, set both to null.
- "contact_name": facility contact person name (e.g. "John Smith"). null if not listed.
- "contact_phone": facility contact phone number. null if not listed.
- "facility_name": name of the warehouse, distribution center, shipper, or consignee (e.g. "Amazon FBA - MDW2", "Walmart DC #6087"). null if not listed.
- "reference_number": stop-level reference, PO, or appointment number specific to that stop (often labeled REF#, PO#, Appt#, DN#). null if not listed. This is different from the top-level poNumber/loadId.

Shipment Stops section (common on rate cons):
- Many rate confirmations have a "Shipment Stops" or similar section with lettered stops: A, B, C, D, E, F, etc.
- "PICK" (or "Pick", "Pickup") = type "PICKUP". "DROP" (or "Drop", "Drop-off", "Delivery") = type "DELIVERY".
- Each letter (A, B, C...) is exactly one stop. Count all letters you see: if the document shows A, B, C, D, E, F then output exactly 6 stops. Do not merge two DROP stops into one even if they are in the same city (e.g. two Dunn, NC stops are two separate stops with different addresses or REF#).
- Use the address and date that appear with each stop block. Each stop has its own date line (e.g. OCT 18 for A, OCT 20 for B and C, OCT 21 for D, E, F). Convert to YYYY-MM-DD. Do not reuse the previous stop's date for the next stop.
- Example: A=PICK, B–F=DROP means 1 pickup and 5 deliveries -> 6 entries in "stops" (one PICKUP, five DELIVERY), in order. If you see six lettered blocks, output six stops.

Also set "pickup" to the first pickup stop and "delivery" to the last delivery stop. If only one address appears, put it in stops as type PICKUP and set delivery to null.

Cargo details (top-level fields):
- "commodity": description of the freight/cargo (e.g. "Dry Grocery", "Electronics", "Frozen Meat"). null if not listed.
- "weight_lbs": total shipment weight in pounds (numeric only). null if not listed.
- "pieces": total piece/pallet/unit count (numeric only). null if not listed.

Special instructions and flags (top-level fields):
- "special_instructions": free-text with any special handling, driver instructions, appointment requirements, detention rules, or delivery notes found in the document. Concatenate multiple instructions separated by "; ". null if none found.
- "is_hazmat": true if the load is marked as hazardous material (HazMat, HAZMAT, Hazardous). false if explicitly marked non-hazmat. null if not mentioned.
- "detention_free_hours": number of free detention hours before charges apply (e.g. 2 if "2 hours free detention"). null if not mentioned.
- "temperature_min": minimum required temperature in Fahrenheit for reefer/temp-controlled loads. null if not a temp-controlled load or not mentioned.
- "temperature_max": maximum required temperature in Fahrenheit for reefer/temp-controlled loads. null if not mentioned.

Document structure:
- In multi-page rate confirmations, the first pages are often terms/boilerplate; load details (stops, rate, dates, addresses) are frequently on the final pages. Prefer and prioritize information from the end of the provided text when present.
`;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_API_TOKEN || null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const ANTHROPIC_VISION_MODEL = process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-20250514';

// ---------------------------------------------------------------------------
// Confidence scoring thresholds (FN-738)
// ---------------------------------------------------------------------------
/** Scores above this threshold are tier "green". */
const CONFIDENCE_TIER_GREEN  = 0.95;
/** Scores between this and green are tier "yellow"; below is "red". */
const CONFIDENCE_TIER_YELLOW = 0.80;
/** Minimum overall_confidence to auto-approve (bulk mode only). */
const AUTO_APPROVE_THRESHOLD = 0.90;

/**
 * Maps a 0–1 confidence score to a display tier.
 * @param {number} score
 * @returns {'green'|'yellow'|'red'}
 */
function confidenceTier(score) {
  if (score > CONFIDENCE_TIER_GREEN)  return 'green';
  if (score >= CONFIDENCE_TIER_YELLOW) return 'yellow';
  return 'red';
}

/**
 * Computes overall_confidence as the minimum of the four required fields:
 * brokerName, rate, pickup (first stop), and delivery (last stop).
 * This is intentionally conservative — if any required field is weak the
 * overall score reflects that uncertainty.
 * @param {{ brokerName: number, rate: number, pickup: number, delivery: number }} c
 * @returns {number}
 */
function computeOverallConfidence(c) {
  const required = [
    typeof c.brokerName === 'number' ? c.brokerName : 0,
    typeof c.rate       === 'number' ? c.rate       : 0,
    typeof c.pickup     === 'number' ? c.pickup     : 0,
    typeof c.delivery   === 'number' ? c.delivery   : 0,
  ];
  return Math.min(...required);
}

const MAX_INPUT_CHARS = 120_000;

// Only treat as garbled when obviously corrupted: majority CJK/specials/control and almost no printable.
const GARBLED_WEIRD_RATIO = 0.50;   // reject only if >50% of chars are weird
const GARBLED_MAX_PRINTABLE_RATIO = 0.05; // and <5% printable (so we only reject obvious garbage)

// Broad "printable" set: letters, digits, space, common punctuation and symbols in rate cons
const PRINTABLE_REGEX = /[A-Za-z0-9\s,.:;#@()\/\-$%&'"*+=\[\]_;<>?`{}~\u2013\u2014\u2018\u2019\u201C\u201D\n\r\t]/g;

function getTextQuality(text = '') {
  if (!text || text.length < 50) return { weirdRatio: 1, printableRatio: 0 };
  const sample = text.slice(0, 4000);
  const weird =
    (sample.match(/[\u3000-\u9FFF]/g) || []).length +
    (sample.match(/[\uFFF0-\uFFFF]/g) || []).length +
    (sample.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  const printable = (sample.match(PRINTABLE_REGEX) || []).length;
  return {
    weirdRatio: weird / Math.max(sample.length, 1),
    printableRatio: printable / Math.max(sample.length, 1)
  };
}

function looksGarbled(text = '') {
  const { weirdRatio, printableRatio } = getTextQuality(text);
  if (!text || text.length < 50) return true;
  return weirdRatio > GARBLED_WEIRD_RATIO && printableRatio < GARBLED_MAX_PRINTABLE_RATIO;
}

// When pdf-parse has any noticeable weird chars (font-mapping garbage), try pdftotext and use it if cleaner.
const SUSPICIOUS_WEIRD_RATIO = 0.06;

// ---------------------------------------------------------------------------
// Primary: pdf-parse
// ---------------------------------------------------------------------------
async function extractWithPdfParse(buffer) {
  const parsed = await pdfParse(buffer);
  return (parsed.text || '').trim();
}

// ---------------------------------------------------------------------------
// Get PDF page count via pdfinfo (Poppler)
// ---------------------------------------------------------------------------
async function getPdfPageCount(buffer) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ratecon-'));
  const pdfPath = path.join(dir, 'input.pdf');
  try {
    await fs.promises.writeFile(pdfPath, buffer);
    const { stdout } = await execFileAsync('pdfinfo', [pdfPath], { encoding: 'utf8' });
    const m = (stdout || '').match(/Pages:\s*(\d+)/);
    const n = m ? parseInt(m[1], 10) : 0;
    return n > 0 ? n : 0;
  } catch (_) {
    return 0;
  } finally {
    try {
      await fs.promises.unlink(pdfPath).catch(() => {});
      await fs.promises.rmdir(dir).catch(() => {});
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Fallback: pdftotext -layout (Poppler; preserves layout and often decodes fonts correctly)
// firstPage/lastPage are 1-based; if omitted, all pages are extracted.
// ---------------------------------------------------------------------------
async function extractWithPdftotext(buffer, opts = {}) {
  const { firstPage, lastPage } = opts;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ratecon-'));
  const pdfPath = path.join(dir, 'input.pdf');
  const txtPath = path.join(dir, 'output.txt');
  try {
    await fs.promises.writeFile(pdfPath, buffer);
    const args = ['-layout'];
    if (firstPage != null && firstPage > 0) args.push('-f', String(firstPage));
    if (lastPage != null && lastPage > 0) args.push('-l', String(lastPage));
    args.push(pdfPath, txtPath);
    await execFileAsync('pdftotext', args);
    const text = await fs.promises.readFile(txtPath, 'utf8');
    return text.trim();
  } finally {
    try {
      await fs.promises.unlink(pdfPath).catch(() => {});
      await fs.promises.unlink(txtPath).catch(() => {});
      await fs.promises.rmdir(dir).catch(() => {});
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Scanned PDF detection heuristic (FN-739)
// ---------------------------------------------------------------------------
const SCANNED_MIN_CHARS = 100;
const SCANNED_ALPHA_RATIO = 0.20;

function isScannedPdf(text) {
  if (!text || text.length < SCANNED_MIN_CHARS) return true;
  const sample = text.slice(0, 4000);
  const alphanumeric = (sample.match(/[A-Za-z0-9]/g) || []).length;
  const ratio = alphanumeric / Math.max(sample.length, 1);
  return ratio < SCANNED_ALPHA_RATIO;
}

// ---------------------------------------------------------------------------
// Vision fallback: convert PDF to images and send to Claude Vision API (FN-739)
// ---------------------------------------------------------------------------
async function extractWithVision(buffer, filename) {
  if (!ANTHROPIC_API_KEY) {
    dtLogger.warn('load_ai_vision_skipped_no_key', { filename });
    return null;
  }

  dtLogger.info('load_ai_vision_start', { filename, bufferLength: buffer?.length });

  // Convert PDF pages to PNG using pdftoppm (Poppler)
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ratecon-vision-'));
  const pdfPath = path.join(dir, 'input.pdf');

  try {
    await fs.promises.writeFile(pdfPath, buffer);

    // Render up to 5 pages as PNG (rate cons rarely exceed 5 pages)
    const maxPages = 5;
    await execFileAsync('pdftoppm', [
      '-png', '-r', '200', '-l', String(maxPages),
      pdfPath, path.join(dir, 'page')
    ], { timeout: 30000 });

    // Read generated PNG files
    const files = await fs.promises.readdir(dir);
    const pngFiles = files
      .filter(f => f.endsWith('.png'))
      .sort();

    if (pngFiles.length === 0) {
      dtLogger.warn('load_ai_vision_no_images', { filename });
      return null;
    }

    dtLogger.info('load_ai_vision_pages_rendered', { filename, pageCount: pngFiles.length });

    // Build image content blocks for Claude Vision
    const imageBlocks = [];
    for (const png of pngFiles.slice(0, maxPages)) {
      const imgBuffer = await fs.promises.readFile(path.join(dir, png));
      const base64 = imgBuffer.toString('base64');
      imageBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: base64
        }
      });
    }

    // Add the extraction prompt as text
    imageBlocks.push({
      type: 'text',
      text: LOAD_EXTRACTION_PROMPT +
        `\n\nThe above images are pages from a rate confirmation or BOL PDF. Filename: ${filename || 'unknown'}. ` +
        `This is a scanned/image PDF so text extraction failed. Extract all visible load details from the images.`
    });

    // Call Claude Vision API
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: ANTHROPIC_VISION_MODEL,
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: imageBlocks
          }
        ]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        timeout: 90000
      }
    );

    const content = response.data?.content?.[0]?.text;
    if (!content) {
      dtLogger.warn('load_ai_vision_no_response', { filename });
      return null;
    }

    // Parse JSON from response (strip markdown fences if present)
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr);

    dtLogger.info('load_ai_vision_success', {
      filename,
      brokerName: parsed.brokerName || null,
      rate: parsed.rate || null,
      stopsCount: parsed.stops?.length || 0,
      model: ANTHROPIC_VISION_MODEL
    });

    return parsed;
  } catch (err) {
    dtLogger.error('load_ai_vision_failed', err, {
      filename,
      message: err?.message,
      code: err?.response?.status
    });
    return null;
  } finally {
    // Clean up temp files
    try {
      const files = await fs.promises.readdir(dir);
      for (const f of files) {
        await fs.promises.unlink(path.join(dir, f)).catch(() => {});
      }
      await fs.promises.rmdir(dir).catch(() => {});
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Fallback 2: OCR (optional; enable if tesseract + pdf-to-image available)
// ---------------------------------------------------------------------------
async function extractWithOcr(buffer) {
  // Optional: use pdf2pic or pdf-poppler to render pages, then tesseract to OCR.
  // Example: const pdf2pic = require('pdf2pic'); const Tesseract = require('tesseract.js');
  // For now we do not add heavy deps; return null so pipeline continues without OCR.
  return null;
}

// ---------------------------------------------------------------------------
// Multi-stage text extraction: try pdf-parse, then pdftotext, then OCR
// ---------------------------------------------------------------------------
async function getPdfText(buffer) {
  let pdfText = '';
  let source = 'none';

  try {
    pdfText = await extractWithPdfParse(buffer);
    source = 'pdf-parse';
  } catch (err) {
    // continue to fallbacks
  }

  // When pdf-parse returns no text (e.g. scanned/image PDF), try pdftotext before giving up
  const MIN_USEFUL_LENGTH = 50;
  const LAST_PAGES_COUNT = 5; // load details are often on final pages
  if (!pdfText || pdfText.length < MIN_USEFUL_LENGTH) {
    dtLogger.info('load_ai_extract_pdf_parse_empty_or_short', { length: (pdfText || '').length, trying: 'pdftotext' });
    try {
      let altText = await extractWithPdftotext(buffer);
      dtLogger.info('load_ai_extract_pdftotext_result', { scope: 'full', length: (altText || '').length });
      if (altText && altText.length > 20) {
        dtLogger.info('load_ai_extract_using_pdftotext', { reason: 'pdf-parse had no/short text', pdftotextLength: altText.length });
        return { text: altText, source: 'pdftotext' };
      }
      // Full-doc pdftotext was empty/short; try last N pages only (rate/load details often at end)
      const numPages = await getPdfPageCount(buffer);
      if (numPages > 1) {
        const firstPage = Math.max(1, numPages - LAST_PAGES_COUNT + 1);
        dtLogger.info('load_ai_extract_trying_last_pages', { numPages, firstPage, lastPage: numPages });
        altText = await extractWithPdftotext(buffer, { firstPage, lastPage: numPages });
        dtLogger.info('load_ai_extract_pdftotext_result', { scope: 'last_pages', firstPage, lastPage: numPages, length: (altText || '').length });
        if (altText && altText.length > 20) {
          dtLogger.info('load_ai_extract_using_pdftotext', { reason: 'last pages only', pdftotextLength: altText.length, pages: `${firstPage}-${numPages}` });
          return { text: altText, source: 'pdftotext' };
        }
      }
    } catch (e) {
      dtLogger.warn('load_ai_extract_pdftotext_failed', { error: e?.message || String(e), code: e?.code });
    }
    if (!pdfText) return { text: '', source };
  }

  // If pdf-parse text looks suspicious (weird chars = font-mapping garbage), try pdftotext and prefer it if cleaner
  const quality = getTextQuality(pdfText);
  if (pdfText && pdfText.length > 100) {
    dtLogger.info('load_ai_extract_pdf_quality', {
      source: 'pdf-parse',
      weirdRatio: Math.round(quality.weirdRatio * 1000) / 1000,
      printableRatio: Math.round(quality.printableRatio * 1000) / 1000,
      willTryPdftotext: quality.weirdRatio > SUSPICIOUS_WEIRD_RATIO
    });
  }
  if (pdfText && quality.weirdRatio > SUSPICIOUS_WEIRD_RATIO) {
    dtLogger.info('load_ai_extract_suspicious_pdf_parse', {
      weirdRatio: quality.weirdRatio,
      printableRatio: quality.printableRatio,
      trying: 'pdftotext'
    });
    try {
      const altText = await extractWithPdftotext(buffer);
      if (altText && altText.length > 20) {
        const altQuality = getTextQuality(altText);
        if (altQuality.weirdRatio < quality.weirdRatio || altQuality.printableRatio > quality.printableRatio) {
          dtLogger.info('load_ai_extract_using_pdftotext', {
            reason: 'pdf-parse had high weird ratio',
            pdfParseWeird: quality.weirdRatio,
            pdftotextWeird: altQuality.weirdRatio
          });
          return { text: altText, source: 'pdftotext' };
        }
        dtLogger.info('load_ai_extract_pdftotext_not_cleaner', {
          pdftotextWeird: altQuality.weirdRatio,
          pdfParseWeird: quality.weirdRatio
        });
      }
    } catch (e) {
      dtLogger.warn('load_ai_extract_pdftotext_failed', {
        error: e?.message || String(e),
        code: e?.code
      });
    }
  }

  if (pdfText && !looksGarbled(pdfText)) {
    return { text: pdfText, source };
  }

  try {
    const altText = await extractWithPdftotext(buffer);
    if (altText && altText.length > 20 && !looksGarbled(altText)) {
      return { text: altText, source: 'pdftotext' };
    }
    if (altText && altText.length > 20) {
      pdfText = altText;
      source = 'pdftotext';
    }
  } catch (e) {
    // pdftotext not installed or failed
  }

  if (pdfText && !looksGarbled(pdfText)) {
    return { text: pdfText, source };
  }

  try {
    const ocrText = await extractWithOcr(buffer);
    if (ocrText && ocrText.length > 20 && !looksGarbled(ocrText)) {
      return { text: ocrText, source: 'ocr' };
    }
  } catch (_) {}

  return { text: pdfText || '', source };
}

// ---------------------------------------------------------------------------
// Keyword-based filtering – only when text is clean (so we don't drop good content)
// ---------------------------------------------------------------------------
function filterRelevantLines(text) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const keywords = /(shipment|stops|pick|drop|pickup|pick-up|delivery|consignee|shipper|origin|destination|deliver to|ship to|rate|total|linehaul|line haul|load|reference|broker|carrier|commodity|weight|address|conf#|order#|pieces|pkwy|street|blvd|ave|drive|appointment|lbs|hazmat|hazardous|reefer|temperature|temp\b|detention|contact|phone|special\s*instructions|handling|pallets?|instructions)/i;
  const isShipmentStopsLine = /(shipment\s*stops|^\s*[A-F]\s*$|PICK|DROP)/i;
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (keywords.test(lines[i])) {
      const start = Math.max(0, i - 3);
      const extra = isShipmentStopsLine.test(lines[i]) ? 25 : 10;
      const end = Math.min(lines.length, i + extra);
      for (let j = start; j < end; j += 1) kept.push(lines[j]);
    }
  }
  return [...new Set(kept)].join('\n');
}

// ---------------------------------------------------------------------------
// Regex pre-parser: extract candidate values to give the model anchors
// ---------------------------------------------------------------------------
function preParseHints(text) {
  if (!text || looksGarbled(text)) return {};
  const hints = {};
  const lineHaul = text.match(/line\s*haul\s*rate\s*[\$]?\s*([0-9,]+\.?\d*)/i) || text.match(/rate\s*[\$]?\s*([0-9,]+\.?\d{2})/i);
  if (lineHaul) hints.rate = lineHaul[1].replace(/,/g, '');
  const dates = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/g) || text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/gi);
  if (dates && dates.length) hints.dates = [...new Set(dates)].slice(0, 10);
  const cityStateZip = text.match(/([A-Z][a-zA-Z\s]+)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/g);
  if (cityStateZip && cityStateZip.length) hints.cityStateZips = [...new Set(cityStateZip)].slice(0, 15);
  const refs = text.match(/(?:ref#|reference#|conf#|order#|load#|pro#)\s*[\s:]?\s*([A-Za-z0-9_-]+)/gi) || text.match(/\b(\d{5,})\s*(?:RC|rate|conf)?\b/gi);
  if (refs && refs.length) hints.refs = [...new Set(refs)].slice(0, 5).map((s) => s.replace(/^[^#]*#?\s*[\s:]*/i, '').trim());
  return hints;
}

// ---------------------------------------------------------------------------
// PDF hash cache helpers (FN-741)
// ---------------------------------------------------------------------------

/** Lazily require knex so the module can load in environments without a DB. */
function _getDb() {
  try {
    // eslint-disable-next-line global-require
    return require('../internal/db').knex;
  } catch (_) {
    return null;
  }
}

const CACHE_TTL_DAYS = 7;

/**
 * Compute a SHA-256 hex digest of the raw PDF bytes.
 * This is the primary key for the load_ai_extractions cache table.
 */
function computePdfHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Look up a cached extraction result by (tenant_id, pdf_hash).
 * Returns the cached row `{ extracted_data, extraction_method }` if fresh
 * (within CACHE_TTL_DAYS), otherwise null. Swallows DB errors so callers
 * always fall back to live extraction.
 */
async function getCachedExtraction(tenantId, pdfHash) {
  const db = _getDb();
  if (!db || !tenantId || !pdfHash) return null;
  try {
    const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const row = await db('load_ai_extractions')
      .where({ tenant_id: tenantId, pdf_hash: pdfHash })
      .where('created_at', '>=', cutoff)
      .select('extracted_data', 'extraction_method')
      .first();
    return row || null;
  } catch (err) {
    dtLogger.warn('load_ai_cache_read_failed', { error: err?.message, tenantId });
    return null;
  }
}

/**
 * Persist a successful extraction result in the cache.
 * Uses INSERT … ON CONFLICT DO UPDATE so a re-upload of the same PDF within
 * the TTL refreshes the created_at timestamp. Swallows errors so a write
 * failure never surfaces to the caller.
 */
async function storeCachedExtraction(tenantId, pdfHash, extractedData, extractionMethod) {
  const db = _getDb();
  if (!db || !tenantId || !pdfHash) return;
  try {
    await db.raw(
      `INSERT INTO load_ai_extractions
         (tenant_id, pdf_hash, extracted_data, extraction_method, created_at)
       VALUES (?, ?, ?::jsonb, ?, now())
       ON CONFLICT (tenant_id, pdf_hash)
       DO UPDATE SET extracted_data    = EXCLUDED.extracted_data,
                     extraction_method = EXCLUDED.extraction_method,
                     created_at        = now()`,
      [tenantId, pdfHash, JSON.stringify(extractedData), extractionMethod || null]
    );
    dtLogger.info('load_ai_cache_stored', { tenantId, hash: pdfHash.slice(0, 12) });
  } catch (err) {
    dtLogger.warn('load_ai_cache_write_failed', { error: err?.message, tenantId });
  }
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------
/**
 * Extract load data from a PDF buffer using AI.
 *
 * @param {Buffer}  buffer    - PDF file bytes
 * @param {string}  filename  - Original filename (for logging/prompt context)
 * @param {{ mode?: 'single'|'bulk', tenantId?: string, skipCache?: boolean }} [opts={}]
 *   `mode='bulk'` enables auto-approval when overall_confidence >= AUTO_APPROVE_THRESHOLD.
 *   `tenantId`   enables PDF hash caching (load_ai_extractions table).
 *   `skipCache`  bypasses cache read even when tenantId is set.
 */
async function extractLoadFromPdf(buffer, filename, opts = {}) {
  const mode     = opts.mode     || 'single';
  const tenantId = opts.tenantId || null;

  // ── Cache check ────────────────────────────────────────────────────────────
  // Hash computed once; reused for the store step at the end of the function.
  let pdfHash = null;
  if (tenantId && !opts.skipCache) {
    pdfHash = computePdfHash(buffer);
    const cached = await getCachedExtraction(tenantId, pdfHash);
    if (cached) {
      dtLogger.info('load_ai_cache_hit', {
        tenantId,
        hash: pdfHash.slice(0, 12),
        method: cached.extraction_method,
      });
      return { ...cached.extracted_data, cache_hit: true };
    }
  }

  dtLogger.info('load_ai_extract_start', { filename: filename || 'unknown', bufferLength: buffer?.length, mode });

  /** Zero-value confidence block used in error / no-API-key returns. */
  const ZERO_CONFIDENCE = {
    confidence:           { brokerName: 0, poNumber: 0, rate: 0, pickup: 0, delivery: 0 },
    confidence_tiers:     { brokerName: 'red', poNumber: 'red', rate: 'red', pickup: 'red', delivery: 'red' },
    overall_confidence:   0,
    overall_confidence_tier: 'red',
    auto_approve:         false,
  };
  if (!OPENAI_API_KEY) {
    dtLogger.warn('load_ai_extract_skipped_no_key', { filename });
    return {
      brokerName: null,
      poNumber: null,
      rate: null,
      pickup: { date: null, city: null, state: null, zip: null, address1: null },
      delivery: { date: null, city: null, state: null, zip: null, address1: null },
      stops: [],
      commodity: null,
      weight_lbs: null,
      pieces: null,
      special_instructions: null,
      is_hazmat: null,
      detention_free_hours: null,
      temperature_min: null,
      temperature_max: null,
      notes: null,
      ...ZERO_CONFIDENCE,
      rawTextSnippet: null,
      provider: 'none',
      warning: 'OPENAI_API_KEY is not configured; returned empty extraction payload.'
    };
  }

  let pdfText = '';
  let extractionSource = 'none';
  try {
    const result = await getPdfText(buffer);
    pdfText = result.text || '';
    extractionSource = result.source;
    dtLogger.info('load_ai_extract_pdf_text', { source: extractionSource, length: pdfText.length });
  } catch (err) {
    dtLogger.error('load_ai_extract_getPdfText_failed', err, { filename });
    return {
      brokerName: null,
      poNumber: null,
      rate: null,
      pickup: { date: null, city: null, state: null, zip: null, address1: null },
      delivery: { date: null, city: null, state: null, zip: null, address1: null },
      stops: [],
      commodity: null,
      weight_lbs: null,
      pieces: null,
      special_instructions: null,
      is_hazmat: null,
      detention_free_hours: null,
      temperature_min: null,
      temperature_max: null,
      notes: null,
      ...ZERO_CONFIDENCE,
      rawTextSnippet: null,
      provider: 'none',
      warning: 'Failed to read text from PDF (it may be a scanned image or corrupted). Load not auto-extracted.'
    };
  }

  // FN-739: Vision fallback for scanned/empty/garbled PDFs
  const needsVisionFallback = !pdfText || isScannedPdf(pdfText) || looksGarbled(pdfText);

  if (needsVisionFallback) {
    const reason = !pdfText ? 'no_text' : isScannedPdf(pdfText) ? 'scanned' : 'garbled';
    dtLogger.info('load_ai_extract_vision_fallback', { reason, textLength: (pdfText || '').length, filename });

    const visionResult = await extractWithVision(buffer, filename);
    if (visionResult) {
      // Normalize vision result to match standard schema (including FN-740 stop fields)
      let stops = [];
      if (Array.isArray(visionResult.stops) && visionResult.stops.length > 0) {
        stops = visionResult.stops.map((s, idx) => ({
          type: (s.type || '').toString().trim().toUpperCase() === 'DELIVERY' ? 'DELIVERY' : 'PICKUP',
          sequence: typeof s.sequence === 'number' ? s.sequence : idx + 1,
          date: s.date ?? null, city: s.city ?? null, state: s.state ?? null,
          zip: s.zip != null ? String(s.zip).trim() : null, address1: s.address1 ?? null,
          appointment_time_from: s.appointment_time_from ?? null,
          appointment_time_to: s.appointment_time_to ?? null,
          contact_name: s.contact_name ?? null,
          contact_phone: s.contact_phone ?? null,
          facility_name: s.facility_name ?? null,
          reference_number: s.reference_number ?? null,
        })).sort((a, b) => a.sequence - b.sequence);
      }

      return {
        brokerName: visionResult.brokerName ?? null,
        poNumber: visionResult.poNumber ?? null,
        loadId: (visionResult.loadId || '').toString().trim() || null,
        orderId: (visionResult.orderId || '').toString().trim() || null,
        proNumber: (visionResult.proNumber || '').toString().trim() || null,
        rate: visionResult.rate != null ? Number(visionResult.rate) : null,
        pickup: {
          date: visionResult.pickup?.date ?? null, city: visionResult.pickup?.city ?? null,
          state: visionResult.pickup?.state ?? null, zip: visionResult.pickup?.zip ?? null,
          address1: visionResult.pickup?.address1 ?? null
        },
        delivery: {
          date: visionResult.delivery?.date ?? null, city: visionResult.delivery?.city ?? null,
          state: visionResult.delivery?.state ?? null, zip: visionResult.delivery?.zip ?? null,
          address1: visionResult.delivery?.address1 ?? null
        },
        stops,
        commodity: visionResult.commodity ?? null,
        weight_lbs: visionResult.weight_lbs ?? null,
        pieces: visionResult.pieces ?? null,
        special_instructions: visionResult.special_instructions ?? null,
        is_hazmat: visionResult.is_hazmat ?? null,
        detention_free_hours: visionResult.detention_free_hours ?? null,
        temperature_min: visionResult.temperature_min ?? null,
        temperature_max: visionResult.temperature_max ?? null,
        notes: visionResult.notes ?? null,
        confidence: {
          brokerName: typeof visionResult.confidence?.brokerName === 'number' ? visionResult.confidence.brokerName : 0,
          poNumber: typeof visionResult.confidence?.poNumber === 'number' ? visionResult.confidence.poNumber : 0,
          rate: typeof visionResult.confidence?.rate === 'number' ? visionResult.confidence.rate : 0,
          pickup: typeof visionResult.confidence?.pickup === 'number' ? visionResult.confidence.pickup : 0,
          delivery: typeof visionResult.confidence?.delivery === 'number' ? visionResult.confidence.delivery : 0
        },
        rawTextSnippet: visionResult.rawTextSnippet ?? null,
        provider: 'anthropic',
        model: ANTHROPIC_VISION_MODEL,
        extraction_method: 'vision',
        vision_fallback_reason: reason
      };
    }

    // Vision also failed — return consistent shape with all FN-740 fields nulled
    const _visionFailBase = {
      brokerName: null, poNumber: null, rate: null,
      pickup: { date: null, city: null, state: null, zip: null, address1: null },
      delivery: { date: null, city: null, state: null, zip: null, address1: null },
      stops: [],
      commodity: null, weight_lbs: null, pieces: null,
      special_instructions: null, is_hazmat: null,
      detention_free_hours: null, temperature_min: null, temperature_max: null,
      notes: null, confidence: { brokerName: 0, poNumber: 0, rate: 0, pickup: 0, delivery: 0 },
      rawTextSnippet: null, provider: 'none', extraction_method: 'none',
    };
    if (!pdfText) {
      return { ..._visionFailBase, warning: 'No text detected in PDF (scanned image) and vision fallback unavailable.' };
    }
    return { ..._visionFailBase, warning: `PDF text appears corrupted. Vision fallback also failed. Source: ${extractionSource}.` };
  }

  dtLogger.info('load_ai_extract_calling_openai', { source: extractionSource, trimmedLength: Math.min(pdfText.length, MAX_INPUT_CHARS) });
  const hints = preParseHints(pdfText);
  const windowed = filterRelevantLines(pdfText) || pdfText;
  const useFullText = windowed.length < 500 && pdfText.length > 500;
  let trimmed = useFullText ? pdfText : windowed;
  let truncated = false;
  if (trimmed.length > MAX_INPUT_CHARS) {
    trimmed = trimmed.slice(0, MAX_INPUT_CHARS);
    truncated = true;
  }

  const encodingHint = useFullText
    ? ' The text may have encoding or font issues; extract any clearly readable values (numbers, dates, addresses, company names) you can identify.\n\n'
    : '';
  const hintsBlock =
    Object.keys(hints).length > 0
      ? `\nPre-extracted candidate values (use as anchors if they appear in the text):\n${JSON.stringify(hints)}\n\n`
      : '';

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
            `\n\nThe following is text extracted from a rate confirmation or BOL PDF. Filename: ${filename} (extraction method: ${extractionSource})\n\n` +
            encodingHint +
            hintsBlock +
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
      max_tokens: 2500
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

  let stops = [];
  if (Array.isArray(parsed.stops) && parsed.stops.length > 0) {
    stops = parsed.stops
      .map((s, idx) => ({
        type: (s.type || '').toString().trim().toUpperCase() === 'DELIVERY' ? 'DELIVERY' : 'PICKUP',
        sequence: typeof s.sequence === 'number' ? s.sequence : idx + 1,
        date: s.date ?? null,
        city: s.city ?? null,
        state: s.state ?? null,
        zip: s.zip != null ? String(s.zip).trim() : null,
        address1: s.address1 ?? null,
        appointment_time_from: s.appointment_time_from ?? null,
        appointment_time_to: s.appointment_time_to ?? null,
        contact_name: s.contact_name ?? null,
        contact_phone: s.contact_phone ?? null,
        facility_name: s.facility_name ?? null,
        reference_number: s.reference_number ?? null
      }))
      .sort((a, b) => a.sequence - b.sequence);
  }
  if (stops.length === 0) {
    const p = parsed.pickup || {};
    const d = parsed.delivery || {};
    const hasPickup = p.city || p.state || p.zip || p.address1;
    const hasDelivery = d.city || d.state || d.zip || d.address1;
    if (hasPickup) {
      stops.push({
        type: 'PICKUP',
        sequence: 1,
        date: p.date ?? null,
        city: p.city ?? null,
        state: p.state ?? null,
        zip: p.zip != null ? String(p.zip).trim() : null,
        address1: p.address1 ?? null,
        appointment_time_from: null,
        appointment_time_to: null,
        contact_name: null,
        contact_phone: null,
        facility_name: null,
        reference_number: null
      });
    }
    if (hasDelivery) {
      stops.push({
        type: 'DELIVERY',
        sequence: 2,
        date: d.date ?? null,
        city: d.city ?? null,
        state: d.state ?? null,
        zip: d.zip != null ? String(d.zip).trim() : null,
        address1: d.address1 ?? null,
        appointment_time_from: null,
        appointment_time_to: null,
        contact_name: null,
        contact_phone: null,
        facility_name: null,
        reference_number: null
      });
    }
  }

  const safe = {
    brokerName: parsed.brokerName ?? null,
    poNumber: parsed.poNumber ?? null,
    loadId: (parsed.loadId || '').toString().trim() || null,
    orderId: (parsed.orderId || '').toString().trim() || null,
    proNumber: (parsed.proNumber || '').toString().trim() || null,
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
    stops,
    commodity: parsed.commodity ?? null,
    weight_lbs: parsed.weight_lbs != null ? Number(parsed.weight_lbs) : null,
    pieces: parsed.pieces != null ? Number(parsed.pieces) : null,
    special_instructions: parsed.special_instructions ?? null,
    is_hazmat: typeof parsed.is_hazmat === 'boolean' ? parsed.is_hazmat : null,
    detention_free_hours: parsed.detention_free_hours != null ? Number(parsed.detention_free_hours) : null,
    temperature_min: parsed.temperature_min != null ? Number(parsed.temperature_min) : null,
    temperature_max: parsed.temperature_max != null ? Number(parsed.temperature_max) : null,
    notes: parsed.notes ?? null,
  };

  const rawConf = {
    brokerName: typeof parsed.confidence?.brokerName === 'number' ? parsed.confidence.brokerName : 0,
    poNumber:   typeof parsed.confidence?.poNumber   === 'number' ? parsed.confidence.poNumber   : 0,
    rate:       typeof parsed.confidence?.rate       === 'number' ? parsed.confidence.rate       : 0,
    pickup:     typeof parsed.confidence?.pickup     === 'number' ? parsed.confidence.pickup     : 0,
    delivery:   typeof parsed.confidence?.delivery   === 'number' ? parsed.confidence.delivery   : 0,
  };
  const overallConf = computeOverallConfidence(rawConf);

  Object.assign(safe, {
    confidence: rawConf,
    confidence_tiers: {
      brokerName: confidenceTier(rawConf.brokerName),
      poNumber:   confidenceTier(rawConf.poNumber),
      rate:       confidenceTier(rawConf.rate),
      pickup:     confidenceTier(rawConf.pickup),
      delivery:   confidenceTier(rawConf.delivery),
    },
    overall_confidence:      overallConf,
    overall_confidence_tier: confidenceTier(overallConf),
    auto_approve:            mode === 'bulk' && overallConf >= AUTO_APPROVE_THRESHOLD,
    rawTextSnippet: parsed.rawTextSnippet ?? null,
    provider: 'openai',
    model: OPENAI_MODEL,
    extraction_method: 'text',
  });

  // ── Cache write ────────────────────────────────────────────────────────────
  if (tenantId && pdfHash) {
    await storeCachedExtraction(tenantId, pdfHash, safe, extractionSource);
  }

  return safe;
}

module.exports = {
  extractLoadFromPdf,
  LOAD_EXTRACTION_PROMPT,
  looksGarbled,
  isScannedPdf,
  extractWithPdftotext,
  extractWithVision,
  preParseHints,
  confidenceTier,
  computeOverallConfidence,
  AUTO_APPROVE_THRESHOLD,
  CONFIDENCE_TIER_GREEN,
  CONFIDENCE_TIER_YELLOW,
  computePdfHash,
  getCachedExtraction,
  storeCachedExtraction,
  CACHE_TTL_DAYS,
};
