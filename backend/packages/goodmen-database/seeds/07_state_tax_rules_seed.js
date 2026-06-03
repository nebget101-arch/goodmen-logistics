'use strict';

/**
 * FN-1537 — Seed state_tax_rules from docs/reference/state-sales-tax-rules-2026.csv
 *
 * Idempotent: INSERT ... ON CONFLICT (state_code) DO UPDATE so the seed can
 * be re-run after the CSV is amended (rate change, statute change, etc.) and
 * existing rows pick up the new values plus a fresh `updated_at`.
 *
 * The CSV is the source of truth for humans (with citations + commentary in
 * the companion `.md`); this seed reads it directly so a code-side data drift
 * is impossible.
 *
 * Column contract (see `docs/reference/state-sales-tax-rules-2026.md`):
 *   state_code, state_name, default_sales_tax_rate, labor_taxable,
 *   parts_taxable, fees_taxable, notes, source_url, effective_from
 */

const fs = require('fs');
const path = require('path');

// Path: backend/packages/goodmen-database/seeds → repo root → docs/reference/...
const CSV_PATH = path.join(
  __dirname, '..', '..', '..', '..',
  'docs', 'reference', 'state-sales-tax-rules-2026.csv'
);

const EXPECTED_HEADERS = [
  'state_code',
  'state_name',
  'default_sales_tax_rate',
  'labor_taxable',
  'parts_taxable',
  'fees_taxable',
  'notes',
  'source_url',
  'effective_from',
];

const EXPECTED_ROW_COUNT = 51; // 50 states + DC

/**
 * Minimal RFC 4180 CSV parser: handles quoted fields containing commas,
 * embedded newlines inside quoted fields, and "" escapes for literal quotes.
 * Sufficient for this dataset; not a substitute for `csv-parse` for general use.
 *
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      // End of record. Skip \r\n pair as a single terminator.
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      // Skip blank lines (e.g., trailing newline at end of file).
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }

  // Flush trailing field/row when the file does not end with a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }

  return rows;
}

function parseBool(value) {
  const v = String(value).trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new Error(`Invalid boolean value in CSV: "${value}"`);
}

function rowsToRecords(matrix) {
  const [header, ...data] = matrix;

  // Validate header shape so a CSV reorder fails loudly instead of silently corrupting data.
  if (header.length !== EXPECTED_HEADERS.length) {
    throw new Error(
      `state_tax_rules CSV header has ${header.length} columns; expected ${EXPECTED_HEADERS.length}`
    );
  }
  for (let i = 0; i < EXPECTED_HEADERS.length; i += 1) {
    if (header[i].trim() !== EXPECTED_HEADERS[i]) {
      throw new Error(
        `state_tax_rules CSV header[${i}]="${header[i]}"; expected "${EXPECTED_HEADERS[i]}"`
      );
    }
  }

  return data.map((cols, idx) => {
    if (cols.length !== EXPECTED_HEADERS.length) {
      throw new Error(
        `state_tax_rules CSV row ${idx + 2} has ${cols.length} columns; expected ${EXPECTED_HEADERS.length}`
      );
    }
    const [
      state_code,
      state_name,
      default_sales_tax_rate,
      labor_taxable,
      parts_taxable,
      fees_taxable,
      notes,
      source_url,
      effective_from,
    ] = cols;

    return {
      state_code: state_code.trim().toUpperCase(),
      state_name: state_name.trim(),
      default_sales_tax_rate: Number(default_sales_tax_rate),
      labor_taxable: parseBool(labor_taxable),
      parts_taxable: parseBool(parts_taxable),
      fees_taxable: parseBool(fees_taxable),
      notes: notes.length ? notes : null,
      source_url: source_url.length ? source_url : null,
      effective_from,
    };
  });
}

exports.seed = async function seed(knex) {
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const records = rowsToRecords(parseCsv(csvText));

  if (records.length !== EXPECTED_ROW_COUNT) {
    throw new Error(
      `state_tax_rules seed: expected ${EXPECTED_ROW_COUNT} rows in CSV, got ${records.length}`
    );
  }

  // Single round-trip upsert. Postgres-native ON CONFLICT keeps the seed
  // idempotent without a per-row SELECT.
  await knex('state_tax_rules')
    .insert(records.map((r) => ({ ...r, updated_at: knex.fn.now() })))
    .onConflict('state_code')
    .merge([
      'state_name',
      'default_sales_tax_rate',
      'labor_taxable',
      'parts_taxable',
      'fees_taxable',
      'notes',
      'source_url',
      'effective_from',
      'effective_to',
      'updated_at',
    ]);

  // Sanity check — fail loudly if the row count drifts.
  const [{ count }] = await knex('state_tax_rules').count('* as count');
  if (Number(count) < EXPECTED_ROW_COUNT) {
    throw new Error(
      `state_tax_rules seed: post-seed row count ${count} < expected ${EXPECTED_ROW_COUNT}`
    );
  }
};
