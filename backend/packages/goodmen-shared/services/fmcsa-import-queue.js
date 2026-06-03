'use strict';

/**
 * FN-1424 — FMCSA import control plane.
 *
 * A small Bull-backed queue that:
 *   1. Persists each import attempt to fmcsa.import_runs (the ledger).
 *   2. Looks up the registered importer for the requested file and runs it.
 *   3. Re-runs all five files on a biweekly cron.
 *
 * Importers (FN-1413/FN-1414) register themselves at startup via
 * `registerImporter(file, fn)`. Until they do, manual triggers fail
 * the run with status='error'; dry-run triggers succeed with 0 rows.
 */

const Queue = require('bull');
const fs = require('fs');
const { getFmcsaKnex } = require('./fmcsa-knex');

const LOG_PREFIX = '[fmcsa-import-queue]';
const SUPPORTED_FILES = Object.freeze(['census', 'authority', 'inspections', 'crashes', 'sms']);
const BIWEEKLY_MS = 14 * 24 * 60 * 60 * 1000;

function isCronEnabled() {
  if (process.env.NODE_ENV === 'development') {
    return process.env.FMCSA_IMPORT_CRON_ENABLED === 'true';
  }
  return true;
}

/**
 * Create the import queue. Returns a small API surface that the route
 * layer and the integrations-service bootstrap consume.
 *
 * @param {object}   options
 * @param {string}   options.redisUrl         Redis connection URL (rediss:// for TLS)
 * @param {import('knex').Knex} [options.fmcsaKnex] Override for tests; defaults to getFmcsaKnex()
 */
function createImportQueue({ redisUrl, fmcsaKnex } = {}) {
  if (!redisUrl) throw new Error(`${LOG_PREFIX} redisUrl is required`);

  const knex = fmcsaKnex || getFmcsaKnex();
  const importers = new Map();

  // ── Queue setup ─────────────────────────────────────────────────────
  const useTls = redisUrl.startsWith('rediss://');
  const Redis = require('ioredis');
  const queue = new Queue('fmcsa-imports', {
    prefix: 'fmcsa-imports',
    createClient() {
      return new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy(times) {
          if (times > 10) return null;
          return Math.min(times * 3000, 30000);
        },
        ...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
      });
    },
    defaultJobOptions: {
      attempts: 1, // imports are large — let the ledger record the failure rather than auto-retry
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  });

  let redisConnected = false;
  queue.on('error', (err) => {
    if (!redisConnected) {
      console.warn(`${LOG_PREFIX} queue error (Redis may be unavailable):`, err.message);
    } else {
      console.error(`${LOG_PREFIX} queue error:`, err.message);
    }
  });
  queue.client.on('ready', () => {
    redisConnected = true;
    console.log(`${LOG_PREFIX} Redis connected`);
  });
  // FN-1453: flip the flag back on disconnect so isReady() reflects current
  // state, not just whether Redis was ever reachable. ioredis emits 'end'
  // after retries are exhausted; 'close' on each socket tear-down.
  queue.client.on('end', () => { redisConnected = false; });
  queue.client.on('close', () => { redisConnected = false; });
  queue.on('failed', (job, err) => {
    console.error(`${LOG_PREFIX} job ${job.id} failed:`, err.message);
  });

  function isReady() {
    return redisConnected;
  }

  // ── Importer registry ───────────────────────────────────────────────

  /**
   * Register an importer for a given file. The function receives
   * `(knex, { dryRun })` and must resolve with `{ rowsInserted, rowsUpdated, rowsSkipped }`.
   * FN-1413 (census/authority) and FN-1414 (inspections/crashes/sms) populate this.
   */
  function registerImporter(file, fn) {
    if (!SUPPORTED_FILES.includes(file)) {
      throw new Error(`${LOG_PREFIX} unsupported file: ${file}`);
    }
    if (typeof fn !== 'function') {
      throw new Error(`${LOG_PREFIX} importer for ${file} must be a function`);
    }
    importers.set(file, fn);
  }

  // ── Job processor ───────────────────────────────────────────────────

  queue.process('run-import', async (job) => {
    const { runId, file, dryRun, source } = job.data;
    if (!runId) throw new Error('run-import job is missing runId');

    try {
      await knex('fmcsa.import_runs')
        .where({ id: runId })
        .update({ status: 'running', updated_at: knex.fn.now() });

      const importer = importers.get(file);
      if (!importer) {
        // Stories FN-1413 / FN-1414 will register importers. Until they do:
        //   - dry runs succeed with 0 rows (the AC permits this).
        //   - real runs fail loudly so the operator notices.
        if (dryRun) {
          await knex('fmcsa.import_runs')
            .where({ id: runId })
            .update({
              status: 'success',
              finished_at: knex.fn.now(),
              rows_inserted: 0,
              rows_updated: 0,
              rows_skipped: 0,
              updated_at: knex.fn.now(),
            });
          return { runId, file, status: 'success', dryRun: true, rowsInserted: 0 };
        }
        const message = `No importer registered for file '${file}'`;
        await knex('fmcsa.import_runs')
          .where({ id: runId })
          .update({
            status: 'error',
            finished_at: knex.fn.now(),
            error_message: message,
            updated_at: knex.fn.now(),
          });
        throw new Error(message);
      }

      try {
        const result = (await importer(knex, { dryRun, source })) || {};
        const rowsInserted = Number.isFinite(result.rowsInserted) ? result.rowsInserted : 0;
        const rowsUpdated = Number.isFinite(result.rowsUpdated) ? result.rowsUpdated : 0;
        const rowsSkipped = Number.isFinite(result.rowsSkipped) ? result.rowsSkipped : 0;
        await knex('fmcsa.import_runs')
          .where({ id: runId })
          .update({
            status: 'success',
            finished_at: knex.fn.now(),
            rows_inserted: dryRun ? 0 : rowsInserted,
            rows_updated: dryRun ? 0 : rowsUpdated,
            rows_skipped: dryRun ? 0 : rowsSkipped,
            updated_at: knex.fn.now(),
          });
        return { runId, file, status: 'success' };
      } catch (err) {
        await knex('fmcsa.import_runs')
          .where({ id: runId })
          .update({
            status: 'error',
            finished_at: knex.fn.now(),
            error_message: err.message?.slice(0, 1000) || String(err),
            updated_at: knex.fn.now(),
          });
        throw err;
      }
    } finally {
      // FN-1457: best-effort cleanup of uploaded tmp files. Runs even on
      // failure so partial / errored runs don't leak disk on the worker.
      if (source && source.type === 'path' && source.value) {
        fs.promises.unlink(source.value).catch(() => {});
      }
    }
  });

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Create a ledger row in 'queued' state and enqueue a Bull job.
   * Returns the inserted row.
   *
   * `source` (FN-1457) is optional. When supplied, it's forwarded on the
   * job data so the registered importer can prefer it over the
   * `FMCSA_*_URL` env-var fallback. Shape:
   *   { type: 'path' | 'url', value: string, auth?: { user, pass } }
   */
  async function enqueueImportRun({
    file,
    dryRun = false,
    triggeredBy,
    triggeredByUserId = null,
    source = null,
  }) {
    if (!SUPPORTED_FILES.includes(file)) {
      throw new Error(`unsupported file: ${file}`);
    }
    if (triggeredBy !== 'manual' && triggeredBy !== 'cron') {
      throw new Error(`triggeredBy must be 'manual' or 'cron'`);
    }
    const [row] = await knex('fmcsa.import_runs')
      .insert({
        file,
        triggered_by: triggeredBy,
        triggered_by_user_id: triggeredBy === 'manual' ? triggeredByUserId : null,
        status: 'queued',
      })
      .returning(['id', 'file', 'triggered_by', 'triggered_by_user_id', 'started_at', 'finished_at', 'status']);

    const jobData = { runId: row.id, file, dryRun: !!dryRun };
    if (source) jobData.source = source;
    await queue.add('run-import', jobData);
    return row;
  }

  /**
   * Return the most recent runs (default 50, max 200), ordered by started_at DESC.
   */
  async function listRecentRuns(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Number.parseInt(limit, 10) || 50));
    return knex('fmcsa.import_runs')
      .orderBy('started_at', 'desc')
      .limit(safeLimit);
  }

  /**
   * Register the biweekly cron. No-op when disabled by NODE_ENV gating.
   * Honors FMCSA_IMPORT_CRON if set (a cron expression), otherwise uses
   * Bull's repeat-every-N-ms for true 14-day cadence.
   */
  async function initScheduler() {
    if (!isCronEnabled()) {
      console.log(`${LOG_PREFIX} cron disabled (NODE_ENV=${process.env.NODE_ENV}, FMCSA_IMPORT_CRON_ENABLED=${process.env.FMCSA_IMPORT_CRON_ENABLED})`);
      return;
    }
    const repeat = process.env.FMCSA_IMPORT_CRON
      ? { cron: process.env.FMCSA_IMPORT_CRON }
      : { every: BIWEEKLY_MS };

    await queue.add(
      'cron-trigger',
      {},
      { repeat, jobId: 'fmcsa-import-cron' }
    );
    console.log(`${LOG_PREFIX} cron registered (${JSON.stringify(repeat)})`);
  }

  // Cron-trigger processor: enqueues one run-import job per supported file.
  queue.process('cron-trigger', async () => {
    console.log(`${LOG_PREFIX} cron-trigger fired — enqueuing all ${SUPPORTED_FILES.length} importers`);
    const results = [];
    for (const file of SUPPORTED_FILES) {
      const row = await enqueueImportRun({ file, dryRun: false, triggeredBy: 'cron' });
      results.push({ runId: row.id, file });
    }
    return { runs: results };
  });

  async function shutdown() {
    try {
      await queue.close();
    } catch (err) {
      console.error(`${LOG_PREFIX} error closing queue:`, err.message);
    }
  }

  return {
    queue,
    enqueueImportRun,
    listRecentRuns,
    initScheduler,
    registerImporter,
    shutdown,
    isReady,
  };
}

module.exports = {
  createImportQueue,
  SUPPORTED_FILES,
  BIWEEKLY_MS,
  // Exposed for unit tests:
  _isCronEnabled: isCronEnabled,
};
