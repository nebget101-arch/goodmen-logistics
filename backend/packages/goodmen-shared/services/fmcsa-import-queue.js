'use strict';

const Queue = require('bull');
const Redis = require('ioredis');

const { runCensusImport, runAuthorityImport } = require('./fmcsa-importer');

const LOG_PREFIX = '[fmcsa-import-queue]';

/**
 * FMCSA bulk-file import queue (FN-1413).
 *
 * Long-running streaming downloads of multi-hundred-MB FMCSA CSVs that
 * batch-upsert into `fmcsa.*`. Runs on its own Bull queue so its retry and
 * concurrency policies are isolated from any other queues in the service.
 *
 * Job names produced here:
 *   - 'import-fmcsa-census'
 *   - 'import-fmcsa-authority'
 *
 * Cron scheduling lives in FN-1415; this module only registers processors
 * and exposes manual-trigger helpers.
 */
function createImportQueue(knex, redisUrl) {
  if (!knex) throw new Error(`${LOG_PREFIX} knex instance is required`);
  if (!redisUrl) throw new Error(`${LOG_PREFIX} redisUrl is required`);

  const useTls = redisUrl.startsWith('rediss://');
  const redisOpts = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 3000, 30000);
    },
    ...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
  };

  const queue = new Queue('fmcsa-import', {
    prefix: 'fmcsa-import',
    createClient() {
      return new Redis(redisUrl, { ...redisOpts });
    },
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
      // Bulk imports run for many minutes; the per-job timeout is
      // intentionally generous (90 min) and well above any reasonable
      // legitimate run time so a hang surfaces as a failure.
      timeout: 90 * 60 * 1000,
    },
  });

  let redisConnected = false;
  queue.on('error', (err) => {
    if (!redisConnected) {
      console.warn(`${LOG_PREFIX} Queue error (Redis may be unavailable):`, err.message);
    } else {
      console.error(`${LOG_PREFIX} Queue error:`, err.message);
    }
  });
  queue.client.on('ready', () => {
    redisConnected = true;
    console.log(`${LOG_PREFIX} Redis connected`);
  });
  queue.on('failed', (job, err) => {
    console.error(`${LOG_PREFIX} Job ${job.id} (${job.name}) failed:`, err.message);
  });

  // Concurrency 1 per processor: bulk imports are I/O-heavy and write a lot of
  // hot rows; we don't want two simultaneously fighting for the same rows.
  queue.process('import-fmcsa-census', 1, async (job) => {
    const { source, triggeredBy = 'manual', triggeredByUserId = null, batchSize } = job.data || {};
    console.log(`${LOG_PREFIX} import-fmcsa-census starting (job ${job.id})`);
    const result = await runCensusImport({
      knex,
      source,
      triggeredBy,
      triggeredByUserId,
      batchSize,
    });
    console.log(
      `${LOG_PREFIX} import-fmcsa-census done: runId=${result.runId} ` +
        `inserted=${result.counts.inserted} updated=${result.counts.updated} ` +
        `skipped=${result.counts.skipped} took=${result.durationMs}ms`,
    );
    return result;
  });

  queue.process('import-fmcsa-authority', 1, async (job) => {
    const { source, triggeredBy = 'manual', triggeredByUserId = null, batchSize } = job.data || {};
    console.log(`${LOG_PREFIX} import-fmcsa-authority starting (job ${job.id})`);
    const result = await runAuthorityImport({
      knex,
      source,
      triggeredBy,
      triggeredByUserId,
      batchSize,
    });
    console.log(
      `${LOG_PREFIX} import-fmcsa-authority done: runId=${result.runId} ` +
        `inserted=${result.counts.inserted} updated=${result.counts.updated} ` +
        `skipped=${result.counts.skipped} took=${result.durationMs}ms`,
    );
    return result;
  });

  return {
    queue,
    enqueueCensus(opts = {}) {
      return queue.add('import-fmcsa-census', opts);
    },
    enqueueAuthority(opts = {}) {
      return queue.add('import-fmcsa-authority', opts);
    },
    async close() {
      await queue.close();
    },
  };
}

module.exports = { createImportQueue };
