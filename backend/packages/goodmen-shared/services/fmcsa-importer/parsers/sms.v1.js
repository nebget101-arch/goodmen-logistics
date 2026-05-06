'use strict';

/**
 * FMCSA SMS BASIC scores parser — v1.
 *
 * One row per (DOT, BASIC, measurement period). The measurement period
 * column (RUNDATE) becomes computed_at — the composite-PK third column on
 * fmcsa.basic_scores.
 *
 * Expected CSV columns:
 *   DOT_NUMBER           - carrier DOT (numeric)
 *   BASIC                - BASIC name (e.g. UNSAFE_DRIVING, HOS, VEHICLE_MAINT)
 *   MEASURE              - measure_value (decimal)
 *   PERCENTILE           - percentile (decimal)
 *   SAFETY_EVENT_GROUP   - text label (e.g. STRAIGHT_1, COMBINATION_2)
 *   RUNDATE              - measurement period / snapshot date — drives computed_at.
 *                          ISO timestamp or YYYY-MM-DD acceptable.
 */

const { parse } = require('csv-parse');

function toInt(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function toDecimal(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toComputedAt(v) {
  if (!v) return null;
  const trimmed = String(v).trim();
  if (!trimmed) return null;
  // Accept full ISO with time
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return new Date(trimmed).toISOString();
  // YYYY-MM-DD → midnight UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return new Date(`${trimmed}T00:00:00Z`).toISOString();
  // MM/DD/YYYY → YYYY-MM-DDT00:00:00Z
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mm, dd, yyyy] = m;
    return new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00Z`).toISOString();
  }
  // Fallback: let JS try
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function makeScore(row) {
  return {
    dot: toInt(row.DOT_NUMBER),
    basic: row.BASIC ? String(row.BASIC).trim() : '',
    computed_at: toComputedAt(row.RUNDATE),
    measure_value: toDecimal(row.MEASURE),
    percentile: toDecimal(row.PERCENTILE),
    safety_event_group: row.SAFETY_EVENT_GROUP ? String(row.SAFETY_EVENT_GROUP).trim() : null,
  };
}

/**
 * Parse a SMS BASIC scores CSV stream.
 *
 * @param {NodeJS.ReadableStream} stream
 * @returns {AsyncIterable<object>}
 */
async function* parseStream(stream) {
  const csv = stream.pipe(
    parse({
      columns: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    })
  );

  for await (const row of csv) {
    const score = makeScore(row);
    if (!score.dot || !score.basic || !score.computed_at) continue;
    yield score;
  }
}

module.exports = {
  parse: parseStream,
  _internals: { toInt, toDecimal, toComputedAt },
};
