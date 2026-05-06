'use strict';

/**
 * FN-1452 — Adapters that bridge each per-driver call signature to the
 * `(knex, { dryRun }) → { rowsInserted, rowsUpdated, rowsSkipped }` shape that
 * `fmcsa-import-queue.js`'s `registerImporter()` expects.
 *
 * On `dryRun` each adapter short-circuits to zero rows BEFORE touching the
 * network or DB. That preserves the queue ledger AC ("dryRun continues to
 * short-circuit at zero rows") and avoids the duplicate `import_runs` row
 * the underlying driver would otherwise create on its own.
 *
 * Inspection / Crash / SMS sources are read from env vars; missing vars throw
 * an actionable error that the queue propagates into `import_runs.error_message`
 * so the worker doesn't crash and the operator sees a clear remediation hint.
 *
 * This file is split out from index.js so unit tests can require it without
 * pulling in `bull` / `ioredis` (which goodmen-shared does not declare as
 * direct dependencies — only the integrations-service does).
 */

const axios = require('axios');
const fs = require('fs');

const { runCensusImport, DEFAULT_CENSUS_URL } = require('./census');
const { runAuthorityImport, DEFAULT_AUTHORITY_URL } = require('./authority');
const { runInspectionImport } = require('./inspections');
const { runCrashImport } = require('./crashes');
const { runSmsImport } = require('./sms');

const LOG_PREFIX = '[fmcsa-import]';

/**
 * Resolve a `source` job-data descriptor into a Readable stream.
 *
 * Mirrors the helper that lives in index.js so this file stays free of the
 * Bull / ioredis import chain. Kept private because callers should go through
 * the registered importers; exposed via `_internals` for tests only.
 *
 * @param {object} source
 * @param {'url'|'path'} source.type
 * @param {string} source.value
 * @param {{user?: string, pass?: string}} [source.auth]
 * @returns {Promise<NodeJS.ReadableStream>}
 */
async function openSourceStream(source) {
  if (!source || !source.type || !source.value) {
    throw new Error(`${LOG_PREFIX} source must be { type: 'url'|'path', value }`);
  }

  if (source.type === 'path') {
    return fs.createReadStream(source.value);
  }

  if (source.type === 'url') {
    const user = (source.auth && source.auth.user) || process.env.FMCSA_DOWNLOAD_USER;
    const pass = (source.auth && source.auth.pass) || process.env.FMCSA_DOWNLOAD_PASS;
    const requestConfig = {
      method: 'GET',
      url: source.value,
      responseType: 'stream',
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    };
    if (user && pass) {
      requestConfig.auth = { username: user, password: pass };
    }
    const response = await axios(requestConfig);
    return response.data;
  }

  throw new Error(`${LOG_PREFIX} unsupported source.type='${source.type}'`);
}

const ZERO_RESULT = { rowsInserted: 0, rowsUpdated: 0, rowsSkipped: 0 };

function mapRunnerCounts(result) {
  const counts = (result && result.counts) || {};
  return {
    rowsInserted: Number.isFinite(counts.inserted) ? counts.inserted : 0,
    rowsUpdated: Number.isFinite(counts.updated) ? counts.updated : 0,
    rowsSkipped: Number.isFinite(counts.skipped) ? counts.skipped : 0,
  };
}

async function censusImporterAdapter(knex, { dryRun } = {}) {
  if (dryRun) return { ...ZERO_RESULT };
  const result = await runCensusImport({
    knex,
    source: { url: DEFAULT_CENSUS_URL },
    triggeredBy: 'manual',
  });
  return mapRunnerCounts(result);
}

async function authorityImporterAdapter(knex, { dryRun } = {}) {
  if (dryRun) return { ...ZERO_RESULT };
  const result = await runAuthorityImport({
    knex,
    source: { url: DEFAULT_AUTHORITY_URL },
    triggeredBy: 'manual',
  });
  return mapRunnerCounts(result);
}

function buildSnapshotAdapter(file, runner, urlEnvVar) {
  return async function snapshotAdapter(_knex, { dryRun } = {}) {
    if (dryRun) return { ...ZERO_RESULT };
    const url = process.env[urlEnvVar];
    if (!url) {
      throw new Error(
        `${urlEnvVar} is not set — cannot run '${file}' import. ` +
          `Set ${urlEnvVar} (and FMCSA_DOWNLOAD_USER/FMCSA_DOWNLOAD_PASS if the snapshot endpoint requires Basic auth), ` +
          `or trigger this file with dryRun=true.`,
      );
    }
    const stream = await openSourceStream({ type: 'url', value: url });
    const result = await runner({ source: stream, triggeredBy: 'manual' });
    return {
      rowsInserted: Number.isFinite(result && result.rowsInserted) ? result.rowsInserted : 0,
      rowsUpdated: Number.isFinite(result && result.rowsUpdated) ? result.rowsUpdated : 0,
      rowsSkipped: Number.isFinite(result && result.rowsSkipped) ? result.rowsSkipped : 0,
    };
  };
}

const inspectionsImporterAdapter = buildSnapshotAdapter('inspections', runInspectionImport, 'FMCSA_INSPECTION_URL');
const crashesImporterAdapter = buildSnapshotAdapter('crashes', runCrashImport, 'FMCSA_CRASH_URL');
const smsImporterAdapter = buildSnapshotAdapter('sms', runSmsImport, 'FMCSA_SMS_URL');

/**
 * Returns the [file, importerFn] pairs the integrations-service bootstrap
 * passes to `fmcsa-import-queue.registerImporter()`. Order matches
 * SUPPORTED_FILES in fmcsa-import-queue.js so audits stay readable.
 */
function getRegisteredImporters() {
  return [
    ['census', censusImporterAdapter],
    ['authority', authorityImporterAdapter],
    ['inspections', inspectionsImporterAdapter],
    ['crashes', crashesImporterAdapter],
    ['sms', smsImporterAdapter],
  ];
}

module.exports = {
  getRegisteredImporters,
  _internals: {
    openSourceStream,
    censusImporterAdapter,
    authorityImporterAdapter,
    inspectionsImporterAdapter,
    crashesImporterAdapter,
    smsImporterAdapter,
  },
};
