'use strict';

const Queue = require('bull');
const { scrapeAll } = require('./fmcsa-safer-scraper');

const LOG_PREFIX = '[fmcsa-queue]';

/**
 * Creates and configures the FMCSA scrape queue backed by Bull/Redis.
 *
 * @param {import('knex').Knex} knex  - Knex instance for DB access
 * @param {string} redisUrl           - Redis connection URL (e.g. redis://localhost:6379)
 * @returns {object} Queue API surface
 */
function createScrapeQueue(knex, redisUrl) {
  if (!knex) throw new Error(`${LOG_PREFIX} knex instance is required`);
  if (!redisUrl) throw new Error(`${LOG_PREFIX} redisUrl is required`);

  // ── Queue instance ────────────────────────────────────────────────
  const queue = new Queue('fmcsa-scrape', redisUrl, {
    redis: {
      maxRetriesPerRequest: null,   // prevent crash on connection loss
      enableReadyCheck: false,       // don't block on READY check
      retryStrategy(times) {
        // Retry every 30s, give up after 5 minutes
        if (times > 10) return null;
        return Math.min(times * 3000, 30000);
      },
    },
    limiter: { max: 1, duration: 3000 },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
      timeout: 60000,
    },
  });

  let redisConnected = false;
  queue.on('error', (err) => {
    if (!redisConnected) {
      // Only log once during initial connection attempts
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
    console.error(
      `${LOG_PREFIX} Job ${job.id} (${job.name}) failed:`,
      err.message
    );
  });

  // ── Helpers ───────────────────────────────────────────────────────

  /**
   * Upsert monitored carriers from operating_entities that have a DOT number.
   */
  async function seedMonitoredCarriers() {
    try {
      const entities = await knex('operating_entities')
        .whereNotNull('dot_number')
        .andWhere('dot_number', '!=', '')
        .select('dot_number', 'name', 'legal_name', 'dba_name');

      let inserted = 0;
      for (const entity of entities) {
        const existing = await knex('fmcsa_monitored_carriers')
          .where({ dot_number: entity.dot_number })
          .first();

        if (!existing) {
          await knex('fmcsa_monitored_carriers').insert({
            dot_number: entity.dot_number,
            legal_name: entity.legal_name || entity.name,
            dba_name: entity.dba_name,
            source: 'operating_entity',
            monitoring_active: true,
          });
          inserted++;
        }
      }

      console.log(
        `${LOG_PREFIX} seedMonitoredCarriers complete – ${entities.length} entities checked, ${inserted} new carriers inserted`
      );
    } catch (err) {
      console.error(`${LOG_PREFIX} seedMonitoredCarriers failed:`, err.message);
      throw err;
    }
  }

  /**
   * Create a fmcsa_scrape_jobs row and return it.
   */
  async function createScrapeJobRow(jobType, triggeredBy, totalCarriers) {
    try {
      const [row] = await knex('fmcsa_scrape_jobs')
        .insert({
          job_type: jobType,
          status: 'pending',
          total_carriers: totalCarriers || 0,
          completed_count: 0,
          failed_count: 0,
          triggered_by: triggeredBy || null,
        })
        .returning('*');
      return row;
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to create scrape job row:`, err.message);
      throw err;
    }
  }

  // ── Job processors ────────────────────────────────────────────────

  /**
   * Process a single carrier scrape.
   * Data: { carrierId, scrapeJobId }
   */
  queue.process('scrape-carrier', async (job) => {
    const { carrierId, scrapeJobId } = job.data;

    const carrier = await knex('fmcsa_monitored_carriers')
      .where({ id: carrierId })
      .first();

    if (!carrier) {
      console.warn(
        `${LOG_PREFIX} scrape-carrier: carrier id=${carrierId} not found in DB`
      );
      if (scrapeJobId) {
        await incrementJobCount(scrapeJobId, 'failed_count');
      }
      return { status: 'carrier_not_found' };
    }

    let result;
    try {
      result = await scrapeAll(carrier.dot_number);
    } catch (scrapeErr) {
      console.error(
        `${LOG_PREFIX} scrape-carrier: scrapeAll failed for DOT ${carrier.dot_number}:`,
        scrapeErr.message
      );
      if (scrapeJobId) {
        await incrementJobCount(scrapeJobId, 'failed_count');
      }
      throw scrapeErr; // let Bull retry
    }

    if (!result) {
      console.warn(
        `${LOG_PREFIX} scrape-carrier: no data returned for DOT ${carrier.dot_number}`
      );
      if (scrapeJobId) {
        await incrementJobCount(scrapeJobId, 'failed_count');
      }
      return { status: 'no_data' };
    }

    try {
      await knex('fmcsa_safety_snapshots').insert({
        monitored_carrier_id: carrier.id,
        scraped_at: new Date(),
        source: 'safer_scrape',
        basic_overall_score: result.basic_overall_score || null,
        unsafe_driving_score: result.unsafe_driving_score || null,
        crash_indicator_score: result.crash_indicator_score || null,
        hos_compliance_score: result.hos_compliance_score || null,
        vehicle_maintenance_score: result.vehicle_maintenance_score || null,
        controlled_substance_score: result.controlled_substance_score || null,
        driver_fitness_score: result.driver_fitness_score || null,
        hazmat_compliance_score: result.hazmat_compliance_score || null,
        operating_status: result.operating_status || null,
        out_of_service_date: result.out_of_service_date || null,
        mc_number: result.mc_number || null,
        power_units: result.power_units || null,
        drivers: result.drivers || null,
        insurance_bipd_on_file: result.insurance_bipd_on_file || null,
        insurance_cargo_on_file: result.insurance_cargo_on_file || null,
        insurance_bond_on_file: result.insurance_bond_on_file || null,
        raw_json: JSON.stringify(result),
      });

      // Update legal_name on the carrier if the scraper returned one
      if (result.legal_name) {
        await knex('fmcsa_monitored_carriers')
          .where({ id: carrier.id })
          .update({ legal_name: result.legal_name });
      }

      if (scrapeJobId) {
        await incrementJobCount(scrapeJobId, 'completed_count');
      }
    } catch (dbErr) {
      console.error(
        `${LOG_PREFIX} scrape-carrier: DB insert failed for DOT ${carrier.dot_number}:`,
        dbErr.message
      );
      if (scrapeJobId) {
        await incrementJobCount(scrapeJobId, 'failed_count');
      }
      throw dbErr;
    }

    return { status: 'ok', dotNumber: carrier.dot_number };
  });

  /**
   * Process a full scrape of all monitored carriers.
   * Data: { scrapeJobId }
   */
  queue.process('scrape-all', async (job) => {
    const { scrapeJobId } = job.data;

    try {
      await knex('fmcsa_scrape_jobs')
        .where({ id: scrapeJobId })
        .update({ status: 'running', started_at: new Date() });
    } catch (err) {
      console.error(
        `${LOG_PREFIX} scrape-all: failed to mark job running:`,
        err.message
      );
    }

    // Ensure all operating entities are seeded as monitored carriers
    await seedMonitoredCarriers();

    const carriers = await knex('fmcsa_monitored_carriers')
      .where({ monitoring_active: true })
      .select('id');

    try {
      await knex('fmcsa_scrape_jobs')
        .where({ id: scrapeJobId })
        .update({ total_carriers: carriers.length });
    } catch (err) {
      console.error(
        `${LOG_PREFIX} scrape-all: failed to update total_carriers:`,
        err.message
      );
    }

    console.log(
      `${LOG_PREFIX} scrape-all: enqueuing ${carriers.length} carriers for scrapeJobId=${scrapeJobId}`
    );

    // Enqueue individual carrier scrapes with staggered delays
    const childJobPromises = [];
    for (let i = 0; i < carriers.length; i++) {
      const childJob = queue.add(
        'scrape-carrier',
        { carrierId: carriers[i].id, scrapeJobId },
        { delay: i * 1000 } // stagger by 1s each
      );
      childJobPromises.push(childJob);
    }

    const childJobs = await Promise.all(childJobPromises);

    // Wait for all child jobs to finish, then mark the scrape job complete
    if (childJobs.length > 0) {
      await waitForChildJobs(childJobs);
    }

    try {
      await knex('fmcsa_scrape_jobs')
        .where({ id: scrapeJobId })
        .update({ status: 'completed', completed_at: new Date() });
    } catch (err) {
      console.error(
        `${LOG_PREFIX} scrape-all: failed to mark job completed:`,
        err.message
      );
    }

    console.log(`${LOG_PREFIX} scrape-all: job ${scrapeJobId} completed`);
    return { status: 'completed', totalCarriers: carriers.length };
  });

  /**
   * Daily scheduler trigger processor.
   */
  queue.process('daily-scrape-all', async () => {
    console.log(`${LOG_PREFIX} daily-scrape-all triggered`);
    const scrapeJob = await createScrapeJobRow('daily_scrape', 'scheduler');
    await queue.add('scrape-all', { scrapeJobId: scrapeJob.id });
    return { scrapeJobId: scrapeJob.id };
  });

  // ── Internal utilities ────────────────────────────────────────────

  /**
   * Atomically increment a count column on fmcsa_scrape_jobs.
   */
  async function incrementJobCount(scrapeJobId, column) {
    try {
      await knex('fmcsa_scrape_jobs')
        .where({ id: scrapeJobId })
        .increment(column, 1);
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Failed to increment ${column} for scrapeJobId=${scrapeJobId}:`,
        err.message
      );
    }
  }

  /**
   * Poll until all child Bull jobs have reached a terminal state.
   * Uses a simple interval to avoid tight loops.
   */
  function waitForChildJobs(childJobs) {
    return new Promise((resolve) => {
      const jobIds = childJobs.map((j) => j.id);
      let resolved = false;

      const check = async () => {
        if (resolved) return;
        try {
          const states = await Promise.all(
            jobIds.map((id) => queue.getJobState(id))
          );
          const allDone = states.every(
            (s) => s === 'completed' || s === 'failed'
          );
          if (allDone) {
            resolved = true;
            resolve();
          }
        } catch (err) {
          console.error(
            `${LOG_PREFIX} Error checking child job states:`,
            err.message
          );
        }
      };

      const interval = setInterval(async () => {
        await check();
        if (resolved) clearInterval(interval);
      }, 5000);

      // Safety: resolve after 4 hours regardless to prevent infinite waits
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          clearInterval(interval);
          console.warn(
            `${LOG_PREFIX} waitForChildJobs timed out after 4 hours`
          );
          resolve();
        }
      }, 4 * 60 * 60 * 1000);
    });
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Enqueue a full scrape of all monitored carriers.
   * @param {string} triggeredBy - Who/what triggered the scrape
   * @returns {object} The created fmcsa_scrape_jobs row
   */
  async function enqueueFullScrape(triggeredBy) {
    const scrapeJob = await createScrapeJobRow('full_scrape', triggeredBy);
    await queue.add('scrape-all', { scrapeJobId: scrapeJob.id });
    console.log(
      `${LOG_PREFIX} enqueueFullScrape: scrapeJobId=${scrapeJob.id} enqueued`
    );
    return scrapeJob;
  }

  /**
   * Enqueue a scrape for a single monitored carrier.
   * @param {number|string} carrierId  - fmcsa_monitored_carriers.id
   * @param {string} triggeredBy       - Who/what triggered the scrape
   * @returns {object} The created fmcsa_scrape_jobs row
   */
  async function enqueueSingleScrape(carrierId, triggeredBy) {
    const scrapeJob = await createScrapeJobRow('single_scrape', triggeredBy, 1);
    await queue.add('scrape-carrier', {
      carrierId,
      scrapeJobId: scrapeJob.id,
    });
    console.log(
      `${LOG_PREFIX} enqueueSingleScrape: carrierId=${carrierId}, scrapeJobId=${scrapeJob.id} enqueued`
    );
    return scrapeJob;
  }

  /**
   * Register the daily repeatable job (3 AM UTC).
   */
  function initScheduler() {
    queue.add(
      'daily-scrape-all',
      {},
      {
        repeat: { cron: '0 3 * * *' },
        jobId: 'daily-fmcsa-scrape',
      }
    );
    console.log(`${LOG_PREFIX} Daily scheduler registered (3 AM UTC)`);
  }

  /**
   * Gracefully shut down the queue.
   */
  async function shutdown() {
    console.log(`${LOG_PREFIX} Shutting down queue...`);
    try {
      await queue.close();
      console.log(`${LOG_PREFIX} Queue closed`);
    } catch (err) {
      console.error(`${LOG_PREFIX} Error closing queue:`, err.message);
    }
  }

  return {
    queue,
    enqueueFullScrape,
    enqueueSingleScrape,
    seedMonitoredCarriers,
    initScheduler,
    shutdown,
  };
}

module.exports = { createScrapeQueue };
