'use strict';

/**
 * Versioned parser for the FMCSA "Carrier - All With History" file
 * (data.transportation.gov dataset 6qg9-x4f8) — operating-authority records
 * for carriers, brokers, and freight forwarders.
 *
 * v1 — handles the column names FMCSA publishes as of 2026-05. Like the
 * census parser, header lookup is case-insensitive and accepts a few
 * historical synonyms; rename → add v2, never edit v1 in place.
 */

const COLUMN_ALIASES = {
  dot: ['DOT_NUMBER', 'USDOT_NUMBER'],
  mc_number: ['MC_MX_FF_NUMBER', 'DOCKET_NUMBER', 'MC_NUMBER'],
  authority_type: ['AUTHORITY_TYPE', 'AUTH_TYPE'],
  status: ['AUTHORITY_STATUS', 'STATUS_CODE', 'STATUS'],
  status_changed_at: [
    'AUTHORITY_STATUS_CHANGE_DATE',
    'STATUS_CHANGE_DATE',
    'EFFECTIVE_DATE',
    'ORIG_AUTH_GRT_DATE',
  ],
  insurance_carrier: ['INS_CARRIER', 'INSURANCE_CARRIER'],
  insurance_form: ['INS_FORM_CODE', 'INSURANCE_FORM'],
  insurance_amount_required: [
    'BIPD_INSURANCE_REQUIRED_AMOUNT',
    'BIPD_INSURANCE_REQUIRED',
    'INSURANCE_REQUIRED_AMOUNT',
  ],
  insurance_amount_on_file: [
    'BIPD_INSURANCE_ON_FILE_AMOUNT',
    'BIPD_INSURANCE_ON_FILE',
    'INSURANCE_ON_FILE_AMOUNT',
  ],
};

function buildHeaderMap(headers) {
  const upper = new Map();
  for (const h of headers) upper.set(h.trim().toUpperCase(), h);

  const out = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const found = upper.get(alias.toUpperCase());
      if (found) {
        out[field] = found;
        break;
      }
    }
  }
  return out;
}

function trimOrNull(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

function bigIntFromDot(v) {
  const t = trimOrNull(v);
  if (t == null) return null;
  const cleaned = t.replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function moneyOrNull(v) {
  const t = trimOrNull(v);
  if (t == null) return null;
  const cleaned = t.replace(/[$,\s]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize FMCSA authority-type strings into the canonical buckets the
 * acceptance criteria expect: "Carrier", "Broker", "Freight Forwarder".
 * Anything else is preserved verbatim (so we don't silently lose new types).
 */
function normalizeAuthorityType(raw) {
  const t = trimOrNull(raw);
  if (t == null) return null;
  const upper = t.toUpperCase();
  if (upper.includes('FORWARDER')) return 'Freight Forwarder';
  if (upper.includes('BROKER')) return 'Broker';
  if (
    upper === 'COMMON' ||
    upper === 'CONTRACT' ||
    upper === 'CARRIER' ||
    upper.includes('COMMON CARRIER') ||
    upper.includes('CONTRACT CARRIER') ||
    upper.includes('MOTOR CARRIER')
  ) {
    return 'Carrier';
  }
  return t;
}

/**
 * Parse a date-ish string into an ISO timestamp. FMCSA emits dates in
 * MM/DD/YYYY in the bulk files; we also accept ISO 8601 just in case.
 */
function parseDateOrNull(v) {
  const t = trimOrNull(v);
  if (t == null) return null;

  // ISO YYYY-MM-DD or full ISO timestamp
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // MM/DD/YYYY (FMCSA's usual format)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const month = m[1].padStart(2, '0');
    const day = m[2].padStart(2, '0');
    const year = m[3];
    const d = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/**
 * Convert one parsed CSV row into a normalized authority record.
 * Returns null if the row lacks a DOT number, MC number, or authority type
 * (any of which would make the composite PK invalid).
 */
function parseAuthorityRow(row, headerMap) {
  const dot = bigIntFromDot(row[headerMap.dot]);
  if (!dot) return null;

  const mc_number = trimOrNull(row[headerMap.mc_number]);
  if (!mc_number) return null;

  const authority_type = normalizeAuthorityType(row[headerMap.authority_type]);
  if (!authority_type) return null;

  const insurance_carriers = [];
  const ins_carrier = trimOrNull(row[headerMap.insurance_carrier]);
  if (ins_carrier) insurance_carriers.push(ins_carrier);

  const insurance_amounts = {};
  const required = moneyOrNull(row[headerMap.insurance_amount_required]);
  const onFile = moneyOrNull(row[headerMap.insurance_amount_on_file]);
  if (required != null) insurance_amounts.required = required;
  if (onFile != null) insurance_amounts.on_file = onFile;

  return {
    dot,
    mc_number,
    authority_type,
    status: trimOrNull(row[headerMap.status]),
    authority_status_changed_at: parseDateOrNull(row[headerMap.status_changed_at]),
    insurance_carriers,
    insurance_amounts,
  };
}

module.exports = {
  COLUMN_ALIASES,
  buildHeaderMap,
  parseAuthorityRow,
  normalizeAuthorityType,
  _internals: { trimOrNull, moneyOrNull, parseDateOrNull },
};
