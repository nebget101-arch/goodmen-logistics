'use strict';

const { runImport } = require('./runner');
const censusV1 = require('./parsers/census.v1');

/**
 * data.transportation.gov dataset 4a2k-zf79 ("Motor Carrier Registrations Census").
 * The CSV export endpoint follows Socrata's standard download-CSV URL contract
 * and is what FN-1415 will hit on the cron schedule.
 */
const DEFAULT_CENSUS_URL =
  'https://data.transportation.gov/api/views/4a2k-zf79/rows.csv?accessType=DOWNLOAD';

/**
 * Build the SQL for one batched UPSERT against fmcsa.carriers.
 *
 * The WHERE clause on DO UPDATE makes unchanged rows a no-op (they don't get
 * RETURNING'd and don't bump fmcsa_synced_at) — that's how we hit AC #5
 * "Re-running the same job is a no-op for unchanged rows".
 *
 * `xmax = 0` distinguishes a freshly inserted row (xmax = 0) from one that
 * collided and was updated (xmax = the locker xid).
 */
const CENSUS_COLUMNS = [
  'dot',
  'mc_number',
  'mx_number',
  'ff_number',
  'legal_name',
  'dba_name',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip_code',
  'country',
  'phone',
  'fax',
  'email',
  'power_units',
  'drivers',
  'mileage',
  'mileage_year',
  'hazmat_flag',
  'passenger_flag',
  'operation_classification',
  'status',
];

const COMPARE_COLUMNS = CENSUS_COLUMNS.filter((c) => c !== 'dot');

function buildPlaceholders(rowCount, colCount, trailingLiterals = '') {
  // knex.raw uses '?' placeholders and translates them to pg's $N internally.
  const oneTuple = `(${new Array(colCount).fill('?').join(',')}${trailingLiterals})`;
  return new Array(rowCount).fill(oneTuple).join(',');
}

async function upsertCensusBatch(knex, records) {
  if (records.length === 0) return { inserted: 0, updated: 0 };

  const bindings = [];
  for (const r of records) {
    for (const col of CENSUS_COLUMNS) bindings.push(r[col]);
  }

  // Three trailing literal columns: fmcsa_synced_at, created_at, updated_at = NOW()
  const placeholders = buildPlaceholders(records.length, CENSUS_COLUMNS.length, ', NOW(), NOW(), NOW()');
  const insertCols = CENSUS_COLUMNS.join(', ');
  const updateSet = COMPARE_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`)
    .concat(['fmcsa_synced_at = NOW()', 'updated_at = NOW()'])
    .join(', ');
  const distinctClause = COMPARE_COLUMNS.map(
    (c) => `fmcsa.carriers.${c} IS DISTINCT FROM EXCLUDED.${c}`,
  ).join(' OR ');

  const sql = `
    INSERT INTO fmcsa.carriers (${insertCols}, fmcsa_synced_at, created_at, updated_at)
    VALUES ${placeholders}
    ON CONFLICT (dot) DO UPDATE SET ${updateSet}
    WHERE ${distinctClause}
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

const censusImporter = {
  file: 'census',
  parser: {
    buildHeaderMap: censusV1.buildHeaderMap,
    parseRow: censusV1.parseCensusRow,
  },
  upsertBatch: upsertCensusBatch,
};

/**
 * Run the FMCSA Census import end-to-end. Returns import-run summary.
 *
 * @param {object} opts
 * @param {import('knex').Knex} opts.knex
 * @param {object} [opts.source]            - {url|filePath|stream}; defaults to the public dataset URL
 * @param {string} [opts.triggeredBy]       - 'manual' | 'cron'
 * @param {string} [opts.triggeredByUserId]
 * @param {number} [opts.batchSize]
 */
async function runCensusImport({
  knex,
  source = { url: DEFAULT_CENSUS_URL },
  triggeredBy = 'manual',
  triggeredByUserId = null,
  batchSize,
} = {}) {
  return runImport({
    knex,
    source,
    triggeredBy,
    triggeredByUserId,
    importerSpec: censusImporter,
    batchSize,
  });
}

module.exports = {
  runCensusImport,
  DEFAULT_CENSUS_URL,
  // Exported for tests
  _internals: { upsertCensusBatch, CENSUS_COLUMNS, COMPARE_COLUMNS, censusImporter },
};
