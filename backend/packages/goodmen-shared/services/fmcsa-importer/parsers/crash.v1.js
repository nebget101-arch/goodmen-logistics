'use strict';

/**
 * FMCSA Crash file parser — v1.
 *
 * One row per crash report. Yields one crash object per row.
 *
 * Expected CSV columns:
 *   REPORT_NUMBER  - crash_report_number (PK)
 *   DOT_NUMBER     - carrier DOT
 *   REPORT_DATE    - crash_date (YYYY-MM-DD or MM/DD/YYYY)
 *   REPORT_STATE   - state code
 *   FATALITIES     - integer count of fatalities
 *   INJURIES       - integer count of injuries
 *   TOW_AWAY       - 'Y' if a tow-away occurred
 */

const { parse } = require('csv-parse');

function parseDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return trimmed.slice(0, 10);
}

function toInt(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function flagYesNo(value) {
  if (value === null || value === undefined) return false;
  const v = String(value).trim().toUpperCase();
  return v === 'Y' || v === 'YES' || v === 'TRUE' || v === '1';
}

function makeCrash(row) {
  return {
    crash_report_number: String(row.REPORT_NUMBER).trim(),
    dot: toInt(row.DOT_NUMBER),
    crash_date: parseDate(row.REPORT_DATE),
    state: row.REPORT_STATE ? String(row.REPORT_STATE).trim() : null,
    fatal_flag: toInt(row.FATALITIES) > 0,
    injury_flag: toInt(row.INJURIES) > 0,
    tow_flag: flagYesNo(row.TOW_AWAY),
  };
}

/**
 * Parse a crash CSV stream.
 *
 * @param {NodeJS.ReadableStream} stream
 * @returns {AsyncIterable<object>}  yields one crash row per crash report.
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
    const reportNumber = row.REPORT_NUMBER ? String(row.REPORT_NUMBER).trim() : '';
    if (!reportNumber) continue;
    yield makeCrash(row);
  }
}

module.exports = {
  parse: parseStream,
  _internals: { parseDate, toInt, flagYesNo },
};
