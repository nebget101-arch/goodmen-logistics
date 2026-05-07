'use strict';

/**
 * FN-1452 — Adapters that bridge each per-driver call signature to the
 * `(knex, { dryRun, source? }) → { rowsInserted, rowsUpdated, rowsSkipped }` shape that
 * `fmcsa-import-queue.js`'s `registerImporter()` expects.
 *
 * On `dryRun` each adapter short-circuits to zero rows BEFORE touching the
 * network or DB. That preserves the queue ledger AC ("dryRun continues to
 * short-circuit at zero rows") and avoids the duplicate `import_runs` row
 * the underlying driver would otherwise create on its own.
 *
 * FN-1457 — when an explicit `source` descriptor is supplied (manual file
 * upload), each adapter prefers it over the `FMCSA_*_URL` env-var fallback.
 *
 *   - census/authority adapters translate `{ type: 'path', value }` to
 *     `{ filePath: value }` and `{ type: 'url', value }` to `{ url: value }`
 *     because `runCensusImport` / `runAuthorityImport` already accept
 *     `{ stream, filePath, url, socrataDataset }` via the runner's `openSource`.
 *   - inspections/crashes/sms adapters open the stream via the existing
 *     `openSourceStream` helper and pass it as `source: stream` to their runner.
 *
 * The "throw if env var unset" path remains as the safety net when no `source`
 * is supplied (i.e. cron triggers and pre-FN-1457 manual triggers).
 *
 * This file is split out from index.js so unit tests can require it without
 * pulling in `bull` / `ioredis` (which goodmen-shared does not declare as
 * direct dependencies — only the integrations-service does).
 */

const axios = require('axios');
const fs = require('fs');

const { runCensusImport } = require('./census');
const { runAuthorityImport } = require('./authority');
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

/**
 * Translate a queue `source` descriptor into the runner's
 * `{ filePath | url }` shape. Returns `null` when no source was supplied so
 * callers fall back to the runner's default Socrata paged source.
 */
function sourceToRunnerInput(source) {
  if (!source) return null;
  if (source.type === 'path') return { filePath: source.value };
  if (source.type === 'url') return { url: source.value };
  throw new Error(`${LOG_PREFIX} unsupported source.type='${source.type}'`);
}

async function censusImporterAdapter(knex, { dryRun, source } = {}) {
  if (dryRun) return { ...ZERO_RESULT };
  const runnerSource = sourceToRunnerInput(source);
  // When source is supplied (FN-1457 manual upload), the runner reads from it.
  // Otherwise runCensusImport defaults to the paged Socrata `/resource/{id}.csv`
  // with `X-App-Token: $FMCSA_SOCRATA_APP_TOKEN` (FN-1455).
  const opts = { knex, triggeredBy: 'manual' };
  if (runnerSource) opts.source = runnerSource;
  const result = await runCensusImport(opts);
  return mapRunnerCounts(result);
}

async function authorityImporterAdapter(knex, { dryRun, source } = {}) {
  if (dryRun) return { ...ZERO_RESULT };
  const runnerSource = sourceToRunnerInput(source);
  const opts = { knex, triggeredBy: 'manual' };
  if (runnerSource) opts.source = runnerSource;
  const result = await runAuthorityImport(opts);
  return mapRunnerCounts(result);
}

function buildSnapshotAdapter(file, runner, urlEnvVar) {
  return async function snapshotAdapter(_knex, { dryRun, source } = {}) {
    if (dryRun) return { ...ZERO_RESULT };
    let stream;
    if (source) {
      stream = await openSourceStream(source);
    } else {
      const url = process.env[urlEnvVar];
      if (!url) {
        throw new Error(
          `${urlEnvVar} is not set — cannot run '${file}' import. ` +
            `Set ${urlEnvVar} (and FMCSA_DOWNLOAD_USER/FMCSA_DOWNLOAD_PASS if the snapshot endpoint requires Basic auth), ` +
            `upload a bulk file via POST /api/fmcsa/imports/run-upload, ` +
            `or trigger this file with dryRun=true.`,
        );
      }
      stream = await openSourceStream({ type: 'url', value: url });
    }
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
    sourceToRunnerInput,
    censusImporterAdapter,
    authorityImporterAdapter,
    inspectionsImporterAdapter,
    crashesImporterAdapter,
    smsImporterAdapter,
  },
};
