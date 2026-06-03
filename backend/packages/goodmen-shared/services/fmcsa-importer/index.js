'use strict';

/**
 * FMCSA bulk-file importer.
 *
 * Two cooperating subsystems live in this module:
 *
 *   1. data.transportation.gov Socrata bulk imports (FN-1413 / FN-1420)
 *        - runCensusImport({ knex, source?, triggeredBy?, ... })
 *        - runAuthorityImport({ knex, source?, triggeredBy?, ... })
 *        - DEFAULT_CENSUS_URL, DEFAULT_AUTHORITY_URL — public dataset endpoints
 *      These are direct, on-demand drivers (no queue here); FN-1415 wires
 *      them to a cron schedule.
 *
 *   2. FMCSA snapshot Bull queue for Inspection / Crash / SMS BASIC scores
 *      (FN-1414 / FN-1422)
 *        - createImportQueue(knex, redisUrl) → { queue, enqueue*, shutdown }
 *      Bull job names exposed by the queue:
 *        - 'import-fmcsa-inspections'
 *        - 'import-fmcsa-crashes'
 *        - 'import-fmcsa-sms'
 *
 * Job data shape (all three queue jobs):
 *   {
 *     source: { type: 'url' | 'path', value: string, auth?: { user, pass } },
 *     triggeredBy: 'manual' | 'cron',
 *     triggeredByUserId?: string
 *   }
 *
 * Auth (URL sources)
 * ──────────────────
 * The FMCSA snapshot endpoints are gated by HTTP Basic Auth. Callers can
 * pass credentials inline via `source.auth = { user, pass }`, or rely on
 * the env-var convention:
 *
 *   FMCSA_DOWNLOAD_USER  - Basic-auth username
 *   FMCSA_DOWNLOAD_PASS  - Basic-auth password
 *
 * **OPEN ITEM**: FMCSA may also require a captcha for unattended downloads
 * (see ticket FN-1422 discussion). This module assumes the caller has
 * already obtained a stable, machine-fetchable URL. If the production URL
 * still hits a captcha, FN-1415 (cron wiring) will need to add a manual-
 * upload fallback or a token-broker step before scheduling can be enabled.
 *
 * Scheduling
 * ──────────
 * **No cron schedule is wired here.** Scheduling (cron repeat jobs, manual
 * trigger HTTP routes) is FN-1415's scope. This module only registers
 * processors and exposes the direct drivers; callers enqueue jobs or invoke
 * runners explicitly.
 */

const Queue = require('bull');
const Redis = require('ioredis');
const axios = require('axios');
const fs = require('fs');

const { runCensusImport, DEFAULT_CENSUS_URL } = require('./census');
const { runAuthorityImport, DEFAULT_AUTHORITY_URL } = require('./authority');
const { runInspectionImport } = require('./inspections');
const { runCrashImport } = require('./crashes');
const { runSmsImport } = require('./sms');

const LOG_PREFIX = '[fmcsa-import]';

const JOB_INSPECTIONS = 'import-fmcsa-inspections';
const JOB_CRASHES = 'import-fmcsa-crashes';
const JOB_SMS = 'import-fmcsa-sms';

const QUEUE_NAME = 'fmcsa-import';
const QUEUE_PREFIX = 'fmcsa-import';

/**
 * Resolve a `source` job-data descriptor into a Readable stream.
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
    return response.data; // Readable stream
  }

  throw new Error(`${LOG_PREFIX} unsupported source.type='${source.type}'`);
}

/**
 * Construct the FMCSA snapshot import queue and register its 3 processors
 * (Inspection / Crash / SMS). Census + Authority imports are NOT routed
 * through this queue — they run directly via runCensusImport /
 * runAuthorityImport.
 *
 * @param {import('knex').Knex} knex      - Knex instance for queue-side
 *                                          bookkeeping. In Phase 1 this is
 *                                          the same instance returned by
 *                                          getFmcsaKnex(); we pass it
 *                                          through anyway so future Phase 2
 *                                          (separate FMCSA DB) is cheap.
 * @param {string}              redisUrl  - Redis connection URL.
 * @returns {{
 *   queue: import('bull').Queue,
 *   enqueueInspectionImport: (data: object) => Promise<import('bull').Job>,
 *   enqueueCrashImport: (data: object) => Promise<import('bull').Job>,
 *   enqueueSmsImport: (data: object) => Promise<import('bull').Job>,
 *   shutdown: () => Promise<void>
 * }}
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

  // Use the createClient pattern (NOT `redis: url`) — Bull v4 needs a real
  // ioredis-style client when redisOpts contains non-default values.
  const queue = new Queue(QUEUE_NAME, {
    prefix: QUEUE_PREFIX,
    createClient() {
      return new Redis(redisUrl, { ...redisOpts });
    },
    defaultJobOptions: {
      attempts: 2,
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
      timeout: 4 * 60 * 60 * 1000, // 4 hours — large FMCSA files take time
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

  // ── Processors ────────────────────────────────────────────────────

  queue.process(JOB_INSPECTIONS, async (job) => {
    const { source, triggeredBy, triggeredByUserId } = job.data || {};
    console.log(`${LOG_PREFIX} job ${job.id} ${JOB_INSPECTIONS} starting`);
    const stream = await openSourceStream(source);
    return runInspectionImport({ source: stream, triggeredBy, triggeredByUserId });
  });

  queue.process(JOB_CRASHES, async (job) => {
    const { source, triggeredBy, triggeredByUserId } = job.data || {};
    console.log(`${LOG_PREFIX} job ${job.id} ${JOB_CRASHES} starting`);
    const stream = await openSourceStream(source);
    return runCrashImport({ source: stream, triggeredBy, triggeredByUserId });
  });

  queue.process(JOB_SMS, async (job) => {
    const { source, triggeredBy, triggeredByUserId } = job.data || {};
    console.log(`${LOG_PREFIX} job ${job.id} ${JOB_SMS} starting`);
    const stream = await openSourceStream(source);
    return runSmsImport({ source: stream, triggeredBy, triggeredByUserId });
  });

  // ── Enqueue helpers ───────────────────────────────────────────────

  function validateData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error(`${LOG_PREFIX} job data must be an object`);
    }
    if (!data.source || !data.source.type || !data.source.value) {
      throw new Error(`${LOG_PREFIX} job data.source must be { type, value }`);
    }
    if (data.triggeredBy !== 'manual' && data.triggeredBy !== 'cron') {
      throw new Error(`${LOG_PREFIX} job data.triggeredBy must be 'manual' or 'cron'`);
    }
  }

  async function enqueueInspectionImport(data) {
    validateData(data);
    return queue.add(JOB_INSPECTIONS, data);
  }

  async function enqueueCrashImport(data) {
    validateData(data);
    return queue.add(JOB_CRASHES, data);
  }

  async function enqueueSmsImport(data) {
    validateData(data);
    return queue.add(JOB_SMS, data);
  }

  async function shutdown() {
    console.log(`${LOG_PREFIX} shutting down queue...`);
    try {
      await queue.close();
      console.log(`${LOG_PREFIX} queue closed`);
    } catch (err) {
      console.error(`${LOG_PREFIX} error closing queue:`, err.message);
    }
  }

  return {
    queue,
    enqueueInspectionImport,
    enqueueCrashImport,
    enqueueSmsImport,
    shutdown,
  };
}

// FN-1452 — adapters that bridge the per-driver signatures to the queue's
// `(knex, { dryRun }) → { rowsInserted, rowsUpdated, rowsSkipped }` shape live
// in their own file so unit tests can require them without pulling in `bull`.
const { getRegisteredImporters } = require('./register-importers');

module.exports = {
  // Direct drivers (Census + Authority — Socrata datasets)
  runCensusImport,
  runAuthorityImport,
  DEFAULT_CENSUS_URL,
  DEFAULT_AUTHORITY_URL,

  // Bull queue (Inspection + Crash + SMS — FMCSA snapshot files)
  createImportQueue,
  runInspectionImport,
  runCrashImport,
  runSmsImport,
  parsers: {
    inspectionV1: require('./parsers/inspection.v1'),
    crashV1: require('./parsers/crash.v1'),
    smsV1: require('./parsers/sms.v1'),
  },
  // FN-1452 — registry adapters consumed by integrations-service bootstrap.
  getRegisteredImporters,
  // For testability of the source-resolution helper
  _internals: { openSourceStream },
  // Constants in case callers want to inspect job names
  JOB_INSPECTIONS,
  JOB_CRASHES,
  JOB_SMS,
};
