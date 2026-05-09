'use strict';

/**
 * Pure helpers for the spreadsheet → loads import (FN-1590).
 *
 * Extracted from `loads-import-service` so they can be unit-tested in
 * isolation without pulling in the R2 / DB / fetch transitive dependencies
 * of the full service.
 */

function trimOrNull(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Apply a column mapping to a raw row, producing FleetNeuron-shape values.
 * `columnMapping` is the AI-supplied (or hand-edited) shape:
 *   { load_number: { sourceHeader, confidence }, ... }
 * We only consult `sourceHeader`. Confidence flows through to commit.
 */
function applyColumnMapping(rawRow, columnMapping) {
  const out = {};
  if (!columnMapping || typeof columnMapping !== 'object') return out;
  for (const [field, def] of Object.entries(columnMapping)) {
    if (!def) continue;
    const sourceHeader = def.sourceHeader || def.source_header || null;
    if (!sourceHeader) continue;
    const raw = rawRow[sourceHeader];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      out[field] = String(raw).trim();
    }
  }
  return out;
}

/**
 * Build PICKUP/DELIVERY stop records from a normalized row. Skips empty
 * stops (no city/state/zip). Supports the `single` (one PU + one DEL) and
 * `extra_columns` (pickup2_*, delivery2_*) multi-stop patterns.
 */
function buildStopsFromRow(normalized) {
  const stops = [];
  const pattern = normalized._stops_hint?.pattern || 'single';

  function pushStop(type, prefix, sequence) {
    const city = trimOrNull(normalized[`${prefix}_city`]);
    const state = trimOrNull(normalized[`${prefix}_state`]);
    const zip = trimOrNull(normalized[`${prefix}_zip`]);
    const date = trimOrNull(normalized[`${prefix}_date`]);
    if (!city && !state && !zip) return;
    stops.push({ stopType: type, city, state, zip, stopDate: date, sequence });
  }

  if (pattern === 'extra_columns') {
    let seq = 1;
    pushStop('PICKUP', 'pickup', seq); if (stops.length === seq) seq = stops.length + 1;
    pushStop('PICKUP', 'pickup2', seq); if (stops.length === seq) seq = stops.length + 1;
    pushStop('DELIVERY', 'delivery', seq); if (stops.length === seq) seq = stops.length + 1;
    pushStop('DELIVERY', 'delivery2', seq);
  } else {
    pushStop('PICKUP', 'pickup', 1);
    pushStop('DELIVERY', 'delivery', stops.length + 1);
  }
  return stops;
}

/**
 * Coerce a free-text rate value (which may include `$`, `,`, etc.) to a
 * finite Number. Returns 0 on failure so the loads.rate column (NOT NULL,
 * default 0) stays valid.
 */
function coerceRate(value) {
  const trimmed = trimOrNull(value);
  if (trimmed == null) return 0;
  const n = Number(trimmed.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse an import-source date cell into an ISO `YYYY-MM-DD` string
 * suitable for `pickup_date`/`delivery_date`/`completed_date` (PostgreSQL
 * `DATE`). Returns null when the input is empty or unparseable.
 *
 * Inputs we have to cope with from CSV/XLSX:
 *   - `Date` instances (xlsx parser hands these back when cellDates: true)
 *   - ISO strings: `2026-05-07`, `2026-05-07T00:00:00.000Z`
 *   - JS `toString()` form: `Thu May 07 2026 00:00:00 GMT+0000 (UTC)`
 *   - US locale: `5/7/2026`, `05/07/2026`, `5/7/26`
 *   - EU locale: `07/05/2026` is ambiguous and we DO NOT try to detect it —
 *     mm/dd/yyyy is the documented expectation; users with ambiguous data
 *     should normalize before upload.
 *   - Empty string / whitespace / non-strings → null
 *
 * We deliberately avoid third-party date libs to keep the shared package
 * dependency footprint small.
 */
function parseImportDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? formatDateOnly(value) : null;
  }
  const text = String(value).trim();
  if (!text) return null;

  // Already-ISO `YYYY-MM-DD` (with or without time component) — short-circuit
  // so we don't drift into the host timezone.
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(text);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m}-${d}`;
  }

  // US-style `M/D/YYYY` or `MM/DD/YY`. Two-digit years map to 20YY (post-2000).
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (slashMatch) {
    let [, mm, dd, yy] = slashMatch;
    if (yy.length === 2) yy = `20${yy}`;
    const m = mm.padStart(2, '0');
    const d = dd.padStart(2, '0');
    return `${yy}-${m}-${d}`;
  }

  // Fallback: hand it to Date and pull Y/M/D from the parsed value. Covers
  // `Thu May 07 2026 00:00:00 GMT+0000 (UTC)` and `2026-05-07T...` not caught
  // above. We use UTC accessors to avoid host-timezone slippage.
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return null;
  return formatDateOnly(parsed);
}

function formatDateOnly(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = {
  trimOrNull,
  applyColumnMapping,
  buildStopsFromRow,
  coerceRate,
  parseImportDate
};
