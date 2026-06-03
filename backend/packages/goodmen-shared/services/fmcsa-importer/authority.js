'use strict';

const { runImport } = require('./runner');
const authorityV1 = require('./parsers/authority.v1');

/**
 * data.transportation.gov dataset 6qg9-x4f8 ("Carrier - All With History").
 * One row per (DOT, MC/MX/FF docket, authority_type) snapshot — including
 * historical state changes — so we keep the most recent record per key.
 *
 * Like the census driver, this hits Socrata's `/resource/{id}.csv` endpoint
 * with `$limit/$offset` paging and an `X-App-Token` header (FN-1455). The
 * legacy `/api/views/<id>/rows.csv?accessType=DOWNLOAD` URL began returning
 * HTTP 400 for anonymous bulk pulls.
 */
const SOCRATA_BASE_URL = 'https://data.transportation.gov';
const AUTHORITY_DATASET_ID = '6qg9-x4f8';
const DEFAULT_AUTHORITY_URL = `${SOCRATA_BASE_URL}/resource/${AUTHORITY_DATASET_ID}.csv`;

const AUTHORITY_INSERT_COLUMNS = [
  'dot',
  'mc_number',
  'authority_type',
  'status',
  'authority_status_changed_at',
  'insurance_carriers',
  'insurance_amounts',
];

const AUTHORITY_COMPARE_COLUMNS = ['status', 'authority_status_changed_at'];

function buildPlaceholders(rowCount, colCount, trailingLiterals = '') {
  // knex.raw uses '?' placeholders and translates them to pg's $N internally.
  const oneTuple = `(${new Array(colCount).fill('?').join(',')}${trailingLiterals})`;
  return new Array(rowCount).fill(oneTuple).join(',');
}

/**
 * Dedupe within the batch: many rows can share the same (dot, mc_number, authority_type)
 * — the file is "all with history" so each status change is its own row. Pre-collapsing
 * inside the batch avoids "ON CONFLICT DO UPDATE cannot affect row a second time" errors,
 * which Postgres raises when a single statement targets the same conflict tuple twice.
 */
function dedupeAuthorityRecords(records) {
  const map = new Map();
  for (const r of records) {
    const key = `${r.dot}|${r.mc_number}|${r.authority_type}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, r);
      continue;
    }
    const prevDate = prev.authority_status_changed_at;
    const nextDate = r.authority_status_changed_at;
    // Newer record wins; ties favour whichever was seen later (file order).
    if (nextDate && (!prevDate || nextDate >= prevDate)) {
      map.set(key, r);
    }
  }
  return Array.from(map.values());
}

async function upsertAuthorityBatch(knex, recordsRaw) {
  if (recordsRaw.length === 0) return { inserted: 0, updated: 0 };
  const records = dedupeAuthorityRecords(recordsRaw);

  const bindings = [];
  for (const r of records) {
    bindings.push(r.dot);
    bindings.push(r.mc_number);
    bindings.push(r.authority_type);
    bindings.push(r.status);
    bindings.push(r.authority_status_changed_at);
    bindings.push(JSON.stringify(r.insurance_carriers || []));
    bindings.push(JSON.stringify(r.insurance_amounts || {}));
  }

  // Three trailing literal columns: fmcsa_synced_at, created_at, updated_at = NOW()
  const placeholders = buildPlaceholders(
    records.length,
    AUTHORITY_INSERT_COLUMNS.length,
    ', NOW(), NOW(), NOW()',
  );

  const insertCols = AUTHORITY_INSERT_COLUMNS.join(', ');
  // Update only when the new row is at least as fresh AND something changed.
  // The freshness guard makes the import resilient to stale snapshots / re-runs.
  const updateSet = [
    'status = EXCLUDED.status',
    'authority_status_changed_at = EXCLUDED.authority_status_changed_at',
    'insurance_carriers = EXCLUDED.insurance_carriers',
    'insurance_amounts = EXCLUDED.insurance_amounts',
    'fmcsa_synced_at = NOW()',
    'updated_at = NOW()',
  ].join(', ');

  const distinctClause = AUTHORITY_COMPARE_COLUMNS.map(
    (c) => `fmcsa.authorities.${c} IS DISTINCT FROM EXCLUDED.${c}`,
  )
    .concat([
      'fmcsa.authorities.insurance_carriers IS DISTINCT FROM EXCLUDED.insurance_carriers',
      'fmcsa.authorities.insurance_amounts IS DISTINCT FROM EXCLUDED.insurance_amounts',
    ])
    .join(' OR ');

  const freshnessClause = `(EXCLUDED.authority_status_changed_at IS NULL
       OR fmcsa.authorities.authority_status_changed_at IS NULL
       OR EXCLUDED.authority_status_changed_at >= fmcsa.authorities.authority_status_changed_at)`;

  const sql = `
    INSERT INTO fmcsa.authorities (
      ${insertCols}, fmcsa_synced_at, created_at, updated_at
    )
    VALUES ${placeholders}
    ON CONFLICT (dot, mc_number, authority_type) DO UPDATE SET ${updateSet}
    WHERE ${freshnessClause} AND (${distinctClause})
    RETURNING (xmax = 0) AS inserted
  `;

  const result = await knex.raw(sql, bindings);
  let inserted = 0;
  let updated = 0;
  for (const row of result.rows) {
    if (row.inserted) inserted++;
    else updated++;
  }
  return { inserted, updated };
}

const authorityImporter = {
  file: 'authority',
  parser: {
    buildHeaderMap: authorityV1.buildHeaderMap,
    parseRow: authorityV1.parseAuthorityRow,
  },
  upsertBatch: upsertAuthorityBatch,
};

/**
 * Run the FMCSA Authority import end-to-end. Returns import-run summary.
 *
 * @param {object} opts
 * @param {import('knex').Knex} opts.knex
 * @param {object} [opts.source]            - {url|filePath|stream}; defaults to the public dataset URL
 * @param {string} [opts.triggeredBy]       - 'manual' | 'cron'
 * @param {string} [opts.triggeredByUserId]
 * @param {number} [opts.batchSize]
 */
async function runAuthorityImport({
  knex,
  source = {
    socrataDataset: { baseUrl: SOCRATA_BASE_URL, datasetId: AUTHORITY_DATASET_ID },
  },
  triggeredBy = 'manual',
  triggeredByUserId = null,
  batchSize,
} = {}) {
  return runImport({
    knex,
    source,
    triggeredBy,
    triggeredByUserId,
    importerSpec: authorityImporter,
    batchSize,
  });
}

module.exports = {
  runAuthorityImport,
  DEFAULT_AUTHORITY_URL,
  SOCRATA_BASE_URL,
  AUTHORITY_DATASET_ID,
  // Exported for tests
  _internals: { upsertAuthorityBatch, dedupeAuthorityRecords, authorityImporter },
};
