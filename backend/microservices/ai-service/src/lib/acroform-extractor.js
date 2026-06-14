'use strict';

/**
 * FN-1838: Deterministic AcroForm field extraction for the agreement
 * detect-fields path.
 *
 * The vision detector (agreement-fields-handler.js) assumes a SCANNED document
 * with no form layer. A genuine *fillable* PDF (AcroForm) has empty widget
 * boxes with no visible ink, so vision sees a blank page and returns 0 fields.
 * When a PDF already carries an AcroForm layer the embedded field definitions
 * (name, type, page, widget rectangle) are higher-fidelity and deterministic —
 * we read them directly here and skip vision entirely.
 *
 * Coordinate convention (docs/design/agreements-bbox-coordinates.md):
 *   bbox = [x, y, w, h] in PDF points, ORIGIN top-left, +y down.
 * PDF native widget rectangles are bottom-left origin, so we flip the y-axis
 * using the page height. This is the same `bbox` the placement editor (FN-1807)
 * draws in and the signed-PDF overlay (FN-1797) consumes, so detected boxes line
 * up without any further transform.
 *
 * Output fields are shaped like the vision detector's raw fields so the handler
 * can run them through the same `normalizeDetection` guard (with bbox clamping
 * disabled, since points are not 0..1):
 *   { key, label, type, page, bbox, suggestedRole, suggestedValue, confidence }
 */

const {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFNumber,
  PDFString,
  PDFHexString
} = require('pdf-lib');

const PDF_MAGIC = Buffer.from('%PDF-');

/** True when the buffer begins with the `%PDF-` signature. */
function isPdfBytes(buf) {
  if (!buf || !buf.length || buf.length < PDF_MAGIC.length) return false;
  // Some PDFs have a few junk bytes before the header; scan the first 1KB.
  const head = buf.subarray(0, Math.min(buf.length, 1024));
  return head.indexOf(PDF_MAGIC) !== -1;
}

// --- low-level pdf-lib value helpers ---------------------------------------

/** A PDFName value (e.g. /Tx) → bare string ("Tx"), else null. */
function nameToString(value) {
  if (value instanceof PDFName) {
    const s = value.asString();
    return s.startsWith('/') ? s.slice(1) : s;
  }
  return null;
}

/** A PDF string/hex-string → decoded JS string, else null. */
function decodeTextValue(value) {
  if (value instanceof PDFHexString) return value.decodeText();
  if (value instanceof PDFString) return value.asString();
  return null;
}

/** A PDFNumber (or anything number-coercible) → finite number, else fallback. */
function numberValue(value, fallback = 0) {
  if (value instanceof PDFNumber) return value.asNumber();
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Look up `key` on a field/widget dict, walking up the `Parent` chain so
 * inherited attributes (FT, Ff) resolve even when a widget is a Kid of its
 * field. Returns the resolved value or null.
 */
function getInheritable(dict, key) {
  let cur = dict;
  const seen = new Set();
  while (cur instanceof PDFDict && !seen.has(cur)) {
    seen.add(cur);
    const v = cur.lookup(PDFName.of(key));
    if (v !== undefined && v !== null) return v;
    const parent = cur.lookup(PDFName.of('Parent'));
    cur = parent instanceof PDFDict ? parent : null;
  }
  return null;
}

/**
 * Fully-qualified field name: join the partial `T` entries from the widget up
 * through its `Parent` chain (e.g. "section1.lessee_name"). Falls back to '' if
 * the field is unnamed.
 */
function fullyQualifiedName(dict) {
  const parts = [];
  let cur = dict;
  const seen = new Set();
  while (cur instanceof PDFDict && !seen.has(cur)) {
    seen.add(cur);
    const t = decodeTextValue(cur.lookup(PDFName.of('T')));
    if (t) parts.unshift(t);
    const parent = cur.lookup(PDFName.of('Parent'));
    cur = parent instanceof PDFDict ? parent : null;
  }
  return parts.join('.');
}

// --- classification heuristics ---------------------------------------------

// AcroForm button field flags (PDF spec, 1-based bit positions):
//   bit 17 (1<<16) = Pushbutton, bit 16 (1<<15) = Radio.
const FF_PUSHBUTTON = 1 << 16;

/**
 * Map an AcroForm field type (FT) to the contract field type. Text fields are
 * refined by name/label (a "signature"/"initials"/"date"/amount blank that is
 * authored as a text widget). Returns null for fields we deliberately skip
 * (pushbuttons are actions, not fillable values).
 */
function classifyType(ft, fieldDict, nameLabel) {
  if (ft === 'Sig') return 'signature';
  if (ft === 'Btn') {
    const ff = numberValue(getInheritable(fieldDict, 'Ff'), 0);
    if (ff & FF_PUSHBUTTON) return null; // action button, not a fillable value
    return 'checkbox'; // checkbox or radio group
  }
  // Tx (text) and Ch (choice/dropdown) are free-text style blanks.
  const s = (nameLabel || '').toLowerCase();
  if (/initial/.test(s)) return 'initials';
  if (/sign(ature)?\b/.test(s)) return 'signature';
  if (/\bdate\b|\bdated\b/.test(s)) return 'date';
  if (/(amount|number|\bno\.?\b|qty|quantity|mileage|miles|\bvin\b|count|\brate\b|\bfee\b|price|total|payment|\bamt\b)/.test(s)) {
    return 'number';
  }
  return 'text';
}

const INTERNAL_RE = /(lessor|landlord|compan|carrier|\bfleet\b|operator|\bagent\b|representative|\brep\b|broker|dispatcher|\boffice\b|internal|\bowner\b|goodmen)/;
const SIGNER_RE = /(lessee|driver|customer|tenant|signer|applicant|employee|contractor|borrower|renter|counterparty|\byou\b|\byour\b)/;

/**
 * Heuristic internal-vs-signer role from the field name/label. "internal" =
 * filled by our staff (company/lessor side); "signer" = filled by the external
 * counterparty (lessee/driver). With no keyword match, signature/initials
 * default to the signer; everything else defaults to internal.
 */
function inferRole(nameLabel, type) {
  const s = (nameLabel || '').toLowerCase();
  const internal = INTERNAL_RE.test(s);
  const signer = SIGNER_RE.test(s);
  if (signer && !internal) return 'signer';
  if (internal && !signer) return 'internal';
  if (signer && internal) return 'signer'; // ambiguous → counterparty
  if (type === 'signature' || type === 'initials') return 'signer';
  return 'internal';
}

/** Turn a raw AcroForm field name into a human label ("lessee_name" → "Lessee Name"). */
function humanizeLabel(name) {
  if (!name) return null;
  const spaced = name
    .replace(/[._\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase → words
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return null;
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Convert a PDF widget /Rect ([x1,y1,x2,y2], bottom-left origin) to the
 * canonical top-left points bbox [x, y, w, h]. Returns null when the rect is
 * malformed or degenerate (zero area).
 */
function rectToTopLeftBbox(rectArray, pageHeight) {
  if (!(rectArray instanceof PDFArray) || rectArray.size() < 4) return null;
  const x1 = numberValue(rectArray.lookup(0), NaN);
  const y1 = numberValue(rectArray.lookup(1), NaN);
  const x2 = numberValue(rectArray.lookup(2), NaN);
  const y2 = numberValue(rectArray.lookup(3), NaN);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const x = Math.min(x1, x2);
  const yBottom = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (w <= 0 || h <= 0) return null;
  const yTop = pageHeight - yBottom - h; // bottom-left → top-left origin
  return [round2(Math.max(0, x)), round2(Math.max(0, yTop)), round2(w), round2(h)];
}

/**
 * Walk every page's widget annotations and emit one raw detection field per
 * placed form widget. A field with widgets on several pages (e.g. repeated
 * per-page initials) yields one entry per page. Returns [] when the document
 * has no placeable AcroForm widgets.
 */
function collectFields(pdfDoc) {
  const pages = pdfDoc.getPages();
  const fields = [];

  pages.forEach((page, pageIndex) => {
    let annots;
    try {
      annots = page.node.Annots();
    } catch (_e) {
      annots = null;
    }
    if (!(annots instanceof PDFArray)) return;

    const { height: pageHeight } = page.getSize();

    for (let i = 0; i < annots.size(); i += 1) {
      let annot;
      try {
        annot = annots.lookup(i);
      } catch (_e) {
        continue;
      }
      if (!(annot instanceof PDFDict)) continue;

      const subtype = nameToString(annot.lookup(PDFName.of('Subtype')));
      if (subtype !== 'Widget') continue;

      const ft = nameToString(getInheritable(annot, 'FT'));
      if (!ft) continue; // a Widget that is not a form field

      const name = fullyQualifiedName(annot);
      const label = humanizeLabel(name) || name || `Field ${fields.length + 1}`;
      const nameLabel = `${name} ${label}`;

      const type = classifyType(ft, annot, nameLabel);
      if (!type) continue; // pushbutton or otherwise non-fillable

      const bbox = rectToTopLeftBbox(annot.lookup(PDFName.of('Rect')), pageHeight);
      if (!bbox) continue; // no usable geometry → let it fall through

      fields.push({
        key: name || label,
        label,
        type,
        page: pageIndex + 1,
        bbox,
        suggestedRole: inferRole(nameLabel, type),
        suggestedValue: null,
        confidence: 1.0
      });
    }
  });

  return fields;
}

function inferDocumentType(fields) {
  const blob = fields.map((f) => `${f.key} ${f.label}`).join(' ').toLowerCase();
  return /leas|lessor|lessee/.test(blob) ? 'lease_agreement' : 'generic';
}

/**
 * Attempt deterministic AcroForm extraction from PDF bytes.
 *
 * Returns `{ hasForm: true, documentType, pageCount, fields }` when the PDF
 * carries placeable form widgets, otherwise `{ hasForm: false }` (caller falls
 * back to vision). Never throws — any parse failure degrades to hasForm:false.
 *
 * @param {Buffer|Uint8Array} bytes - raw PDF bytes
 */
async function extractAcroFormFields(bytes) {
  if (!isPdfBytes(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []))) {
    return { hasForm: false };
  }

  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      ignoreEncryption: true,
      throwOnInvalidObject: false
    });
  } catch (_e) {
    return { hasForm: false };
  }

  let fields;
  try {
    fields = collectFields(pdfDoc);
  } catch (_e) {
    return { hasForm: false };
  }

  if (!fields.length) return { hasForm: false };

  return {
    hasForm: true,
    documentType: inferDocumentType(fields),
    pageCount: pdfDoc.getPageCount(),
    fields
  };
}

module.exports = {
  extractAcroFormFields,
  isPdfBytes,
  // exported for unit tests
  classifyType,
  inferRole,
  humanizeLabel,
  rectToTopLeftBbox,
  collectFields
};
