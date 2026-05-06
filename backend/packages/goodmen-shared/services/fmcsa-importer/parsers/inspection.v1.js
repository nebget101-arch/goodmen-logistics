'use strict';

/**
 * FMCSA Inspection file parser — v1.
 *
 * Streams an FMCSA inspection CSV (one row per violation, grouped by
 * REPORT_NUMBER) and yields one `{ inspection, violations[] }` object per
 * inspection report. Inspection-level fields (counts, severity_weight) are
 * aggregated from the violation rows that share a REPORT_NUMBER.
 *
 * Versioned (`v1`) so we can drop in a new parser when FMCSA changes the
 * file shape, without touching the importer driver.
 *
 * Expected CSV columns (header row required):
 *   REPORT_NUMBER         - inspection_report_number (PK)
 *   DOT_NUMBER            - carrier DOT
 *   INSP_DATE             - inspection_date (YYYY-MM-DD or MM/DD/YYYY)
 *   REPORT_STATE          - state code
 *   INSP_LEVEL            - inspection level (1-6)
 *   UNIT_TYPE_DESC        - 'Vehicle' | 'Driver' | 'Hazmat' (per row)
 *   VIOL_CODE             - violation code (composite key)
 *   VIOL_DESCR            - violation description
 *   VIOLATION_SEQUENCE    - sequence within the inspection
 *   OOS_INDICATOR         - 'Y' if out-of-service
 *   SEVERITY_WEIGHT       - integer severity weight per violation row
 *
 * Real FMCSA exports sort rows by REPORT_NUMBER, so we use a simple
 * "current report" buffer that flushes on key change. This keeps memory
 * flat regardless of file size.
 */

const { parse } = require('csv-parse');

const UNIT_VEHICLE = 'vehicle';
const UNIT_DRIVER = 'driver';
const UNIT_HAZMAT = 'hazmat';

function classifyUnit(unitTypeDesc) {
  if (!unitTypeDesc) return null;
  const v = String(unitTypeDesc).trim().toLowerCase();
  if (v.includes('hazmat')) return UNIT_HAZMAT;
  if (v.includes('driver')) return UNIT_DRIVER;
  if (v.includes('vehicle') || v.includes('power unit') || v.includes('truck') || v.includes('trailer')) {
    return UNIT_VEHICLE;
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  // ISO YYYY-MM-DD pass-through
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  // MM/DD/YYYY → YYYY-MM-DD
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

function isOos(value) {
  if (value === null || value === undefined) return false;
  return String(value).trim().toUpperCase() === 'Y';
}

function makeInspection(row) {
  return {
    inspection_report_number: String(row.REPORT_NUMBER).trim(),
    dot: toInt(row.DOT_NUMBER),
    inspection_date: parseDate(row.INSP_DATE),
    state: row.REPORT_STATE ? String(row.REPORT_STATE).trim() : null,
    level: row.INSP_LEVEL ? toInt(row.INSP_LEVEL) : null,
    vehicle_count: 0,
    driver_count: 0,
    hazmat_count: 0,
    vehicle_oos_count: 0,
    driver_oos_count: 0,
    hazmat_oos_count: 0,
    severity_weight: 0,
  };
}

function applyRowToInspection(inspection, row) {
  const unit = classifyUnit(row.UNIT_TYPE_DESC);
  const oos = isOos(row.OOS_INDICATOR);
  const severity = toInt(row.SEVERITY_WEIGHT);

  if (unit === UNIT_VEHICLE) {
    inspection.vehicle_count += 1;
    if (oos) inspection.vehicle_oos_count += 1;
  } else if (unit === UNIT_DRIVER) {
    inspection.driver_count += 1;
    if (oos) inspection.driver_oos_count += 1;
  } else if (unit === UNIT_HAZMAT) {
    inspection.hazmat_count += 1;
    if (oos) inspection.hazmat_oos_count += 1;
  }
  inspection.severity_weight += severity;
}

function makeViolation(row, fallbackSequence) {
  const code = row.VIOL_CODE ? String(row.VIOL_CODE).trim() : '';
  if (!code) return null;
  const seq = toInt(row.VIOLATION_SEQUENCE);
  return {
    inspection_report_number: String(row.REPORT_NUMBER).trim(),
    violation_code: code,
    sequence: seq > 0 ? seq : fallbackSequence,
    description: row.VIOL_DESCR ? String(row.VIOL_DESCR).trim() : null,
    oos_flag: isOos(row.OOS_INDICATOR),
    severity_weight: toInt(row.SEVERITY_WEIGHT),
  };
}

/**
 * Parse an inspection CSV stream.
 *
 * @param {NodeJS.ReadableStream} stream - readable stream (e.g. fs.createReadStream)
 * @returns {AsyncIterable<{inspection: object, violations: object[]}>}
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

  let current = null;
  let currentViolations = [];
  let fallbackSeq = 0;

  for await (const row of csv) {
    const reportNumber = row.REPORT_NUMBER ? String(row.REPORT_NUMBER).trim() : '';
    if (!reportNumber) continue;

    if (current && current.inspection_report_number !== reportNumber) {
      yield { inspection: current, violations: currentViolations };
      current = null;
      currentViolations = [];
      fallbackSeq = 0;
    }

    if (!current) {
      current = makeInspection(row);
    }

    applyRowToInspection(current, row);

    fallbackSeq += 1;
    const v = makeViolation(row, fallbackSeq);
    if (v) currentViolations.push(v);
  }

  if (current) {
    yield { inspection: current, violations: currentViolations };
  }
}

module.exports = {
  parse: parseStream,
  // Exported for unit testing
  _internals: { classifyUnit, parseDate, toInt, isOos },
};
