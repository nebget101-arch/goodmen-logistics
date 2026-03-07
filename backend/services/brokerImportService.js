/**
 * Broker import service: reads brokers_cleaned.csv, normalizes fields,
 * deduplicates by (legal_name + city + state), batch inserts in 1000-row batches.
 */
const fs = require('fs');
const path = require('path');

const BATCH_SIZE = 1000;
const DEFAULT_CSV_PATH = path.join(process.cwd(), 'backend', 'scripts', 'brokers_import_ready.csv');

/** Parse a CSV line handling quoted fields */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === ',' && !inQuotes) || (c === '\r' && !inQuotes)) {
      result.push(current.trim());
      current = '';
    } else if (c !== '\r') {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

/** Normalize string for DB */
function norm(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Normalize to max length */
function normLen(v, maxLen) {
  const s = norm(v);
  return s && maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Parse brokers_cleaned.csv into rows of broker objects.
 * Maps common column names (case-insensitive) to schema.
 */
function parseBrokerCsv(content) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const colMap = {};
  const wanted = [
    'legal_name', 'legalname', 'name', 'dba_name', 'dbaname', 'mc_number', 'mcnumber', 'mc',
    'dot_number', 'dotnumber', 'dot', 'authority_type', 'authoritytype', 'status',
    'phone', 'email', 'street', 'address', 'address1', 'city', 'state', 'zip', 'country'
  ];
  wanted.forEach((w) => {
    const idx = headers.indexOf(w);
    if (idx >= 0) colMap[w] = idx;
  });

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const get = (names) => {
      for (const n of names) {
        const idx = colMap[n];
        if (idx != null && vals[idx] != null && vals[idx].trim() !== '') return vals[idx].trim();
      }
      return null;
    };

    const legalName = get(['legal_name', 'legalname', 'name']);
    if (!legalName) continue;

    rows.push({
      legal_name: legalName,
      dba_name: norm(get(['dba_name', 'dbaname'])),
      mc_number: normLen(get(['mc_number', 'mcnumber', 'mc']), 20),
      dot_number: normLen(get(['dot_number', 'dotnumber', 'dot']), 20),
      authority_type: normLen(get(['authority_type', 'authoritytype']), 20),
      status: normLen(get(['status']), 20),
      phone: normLen(get(['phone']), 20),
      email: norm(get(['email'])),
      street: norm(get(['street', 'address', 'address1'])),
      city: normLen(get(['city']), 100),
      state: normLen(get(['state']), 20),
      zip: normLen(get(['zip']), 20),
      country: normLen(get(['country']), 20) || 'US'
    });
  }
  return rows;
}

/**
 * Deduplicate by (legal_name + city + state), keeping first occurrence.
 */
function deduplicate(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const key = `${(r.legal_name || '').toLowerCase()}|${(r.city || '').toLowerCase()}|${(r.state || '').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Build insert row: only include keys with non-null, non-empty values.
 * Never insert null into the DB for optional fields.
 */
function toInsertRow(r) {
  const row = {};
  const set = (key, val) => {
    if (val != null && String(val).trim() !== '') row[key] = val;
  };
  set('name', r.legal_name);
  set('legal_name', r.legal_name);
  set('dba_name', r.dba_name);
  set('mc_number', r.mc_number);
  set('dot_number', r.dot_number);
  set('authority_type', r.authority_type);
  set('status', r.status);
  set('phone', r.phone);
  set('email', r.email);
  set('street', r.street);
  set('city', r.city);
  set('state', r.state);
  set('zip', r.zip);
  set('country', r.country || 'US');
  return row;
}

/**
 * Import brokers from brokers_cleaned.csv.
 * @param {object} opts - { csvPath, knex, getClient }
 * @returns {Promise<{ inserted: number, skipped: number, duplicates: number }>}
 */
async function importBrokers(opts = {}) {
  const csvPath = opts.csvPath || DEFAULT_CSV_PATH;
  const knex = opts.knex;
  const getClient = opts.getClient;

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parseBrokerCsv(content);
  const beforeDedup = rows.length;
  const deduped = deduplicate(rows);
  const duplicates = beforeDedup - deduped.length;

  // Skip rows with null/empty required field (legal_name)
  const valid = deduped.filter((r) => r.legal_name != null && String(r.legal_name).trim() !== '');
  const skippedNull = deduped.length - valid.length;

  if (!knex) {
    throw new Error('knex instance must be provided');
  }

  let inserted = 0;
  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const batch = valid.slice(i, i + BATCH_SIZE);
    const rowsForInsert = batch.map(toInsertRow).filter((r) => r.legal_name != null);
    if (rowsForInsert.length === 0) continue;
    await knex('brokers').insert(rowsForInsert);
    inserted += rowsForInsert.length;
  }

  return { inserted, skipped: skippedNull, duplicates };
}

module.exports = { importBrokers, parseBrokerCsv, deduplicate };
