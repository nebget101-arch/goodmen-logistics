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

module.exports = {
  trimOrNull,
  applyColumnMapping,
  buildStopsFromRow,
  coerceRate
};
