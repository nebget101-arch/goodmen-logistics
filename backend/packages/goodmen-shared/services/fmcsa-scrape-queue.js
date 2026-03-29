'use strict';

const Queue = require('bull');
const { scrapeAll, scrapeAllBasicDetails, scrapeInspectionDetail } = require('./fmcsa-safer-scraper');
// FN-479: Fire-and-forget risk score recalculation after inspection data imported
const { triggerRecalculation: triggerRiskRecalc } = require('../routes/safety-risk-engine');

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

  // ── Parse Redis URL and build options ─────────────────────────────
  const useTls = redisUrl.startsWith('rediss://');
  const redisOpts = {
    maxRetriesPerRequest: null,   // prevent crash on connection loss
    enableReadyCheck: false,       // don't block on READY check
    retryStrategy(times) {
      if (times > 10) return null;
      return Math.min(times * 3000, 30000);
    },
    ...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
  };

  // ── Queue instance ────────────────────────────────────────────────
  // IMPORTANT: Do NOT pass `redis: redisUrl` alongside `createClient` —
  // Bull ignores createClient when redis is present, causing default
  // ioredis options (maxRetriesPerRequest=20) which crash the process.
  const Redis = require('ioredis');
  const queue = new Queue('fmcsa-scrape', {
    prefix: 'fmcsa',
    createClient(type) {
      return new Redis(redisUrl, { ...redisOpts });
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
      // result from scrapeAll() already uses DB column names
      await knex('fmcsa_safety_snapshots').insert({
        monitored_carrier_id: carrier.id,
        scraped_at: new Date(),
        ...result,
        raw_json: result.raw_json ? JSON.stringify(result.raw_json) : null,
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

    // FN-479: Recalculate risk scores for drivers matched to inspections under this carrier
    try {
      const matchedDrivers = await knex('fmcsa_inspections')
        .whereNotNull('driver_id')
        .where('carrier_id', carrier.dot_number)
        .distinct('tenant_id', 'driver_id');
      for (const { tenant_id, driver_id } of matchedDrivers) {
        triggerRiskRecalc(tenant_id, driver_id).catch(() => {});
      }
    } catch (riskErr) {
      console.warn(`${LOG_PREFIX} risk recalc trigger failed:`, riskErr.message);
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

  /**
   * Process SMS BASIC detail scraping for a single carrier.
   * Scrapes all 7 BASIC detail pages and stores results in the
   * fmcsa_basic_details, fmcsa_basic_measures_history,
   * fmcsa_violations, and fmcsa_inspection_history tables.
   *
   * Data: { carrierId, scrapeJobId? }
   */
  queue.process('scrape-basic-details', async (job) => {
    const { carrierId, scrapeJobId } = job.data;

    const carrier = await knex('fmcsa_monitored_carriers')
      .where({ id: carrierId })
      .first();

    if (!carrier) {
      console.warn(
        `${LOG_PREFIX} scrape-basic-details: carrier id=${carrierId} not found`
      );
      if (scrapeJobId) await incrementJobCount(scrapeJobId, 'failed_count');
      return { status: 'carrier_not_found' };
    }

    let basicDetails;
    try {
      basicDetails = await scrapeAllBasicDetails(carrier.dot_number);
    } catch (err) {
      console.error(
        `${LOG_PREFIX} scrape-basic-details: failed for DOT ${carrier.dot_number}:`,
        err.message
      );
      if (scrapeJobId) await incrementJobCount(scrapeJobId, 'failed_count');
      throw err;
    }

    if (!basicDetails || basicDetails.length === 0) {
      console.warn(
        `${LOG_PREFIX} scrape-basic-details: no BASIC data for DOT ${carrier.dot_number}`
      );
      if (scrapeJobId) await incrementJobCount(scrapeJobId, 'completed_count');
      return { status: 'no_data' };
    }

    try {
      const scrapedAt = new Date();

      for (const detail of basicDetails) {
        // Insert the BASIC detail record
        const [basicDetailRow] = await knex('fmcsa_basic_details')
          .insert({
            monitored_carrier_id: carrier.id,
            basic_name: detail.basic_name,
            measure_value: detail.measure_value,
            percentile: detail.percentile,
            threshold: detail.threshold,
            safety_event_group: detail.safety_event_group,
            acute_critical_violations: detail.acute_critical_violations,
            investigation_results_text: detail.investigation_results_text,
            record_period: detail.record_period,
            scraped_at: scrapedAt,
            raw_json: JSON.stringify(detail),
          })
          .returning('id');

        const basicDetailId = basicDetailRow.id;

        // Insert measure history data points
        if (detail.measures_history && detail.measures_history.length > 0) {
          const historyRows = detail.measures_history
            .filter((h) => h.snapshot_date)
            .map((h) => ({
              basic_detail_id: basicDetailId,
              snapshot_date: h.snapshot_date,
              measure_value: h.measure_value,
              history_value: h.history_value,
              release_type: h.release_type,
              release_id: h.release_id,
            }));
          if (historyRows.length > 0) {
            await knex('fmcsa_basic_measures_history').insert(historyRows);
          }
        }

        // Insert violation summary records
        if (detail.violations && detail.violations.length > 0) {
          const violRows = detail.violations.map((v) => ({
            basic_detail_id: basicDetailId,
            violation_code: v.violation_code,
            description: v.description,
            violation_count: v.violation_count,
            oos_violation_count: v.oos_violation_count,
            severity_weight: v.severity_weight,
          }));
          await knex('fmcsa_violations').insert(violRows);
        }

        // Insert inspection history records
        if (detail.inspections && detail.inspections.length > 0) {
          const inspRows = detail.inspections.map((insp) => ({
            basic_detail_id: basicDetailId,
            inspection_date: insp.inspection_date,
            report_number: insp.report_number,
            report_state: insp.report_state,
            plate_number: insp.plate_number,
            plate_state: insp.plate_state,
            vehicle_type: insp.vehicle_type,
            severity_weight: insp.severity_weight,
            time_weight: insp.time_weight,
            total_weight: insp.total_weight,
            violations: JSON.stringify(insp.violations || []),
          }));
          await knex('fmcsa_inspection_history').insert(inspRows);

          // Scrape detailed inspection reports for each inspection
          for (const insp of detail.inspections) {
            if (!insp.fmcsa_inspection_id) continue;
            // Skip if already scraped
            const exists = await knex('fmcsa_inspection_details')
              .where({ inspection_id: insp.fmcsa_inspection_id })
              .first();
            if (exists) continue;

            try {
              const inspDetail = await scrapeInspectionDetail(insp.fmcsa_inspection_id);
              if (inspDetail) {
                await knex('fmcsa_inspection_details').insert({
                  monitored_carrier_id: carrier.id,
                  inspection_id: insp.fmcsa_inspection_id,
                  report_number: inspDetail.report_number,
                  report_state: inspDetail.report_state,
                  state: inspDetail.state,
                  inspection_date: inspDetail.inspection_date,
                  start_time: inspDetail.start_time,
                  end_time: inspDetail.end_time,
                  level: inspDetail.level,
                  facility: inspDetail.facility,
                  post_crash: inspDetail.post_crash,
                  hazmat_placard: inspDetail.hazmat_placard,
                  vehicles: JSON.stringify(inspDetail.vehicles || []),
                  violations: JSON.stringify(inspDetail.violations || []),
                });
              }
              // Small delay between inspection detail fetches
              await new Promise((r) => setTimeout(r, 500));
            } catch (inspErr) {
              console.warn(
                `${LOG_PREFIX} Failed to scrape inspection detail ${insp.fmcsa_inspection_id}:`,
                inspErr.message
              );
            }
          }
        }
      }

      if (scrapeJobId) await incrementJobCount(scrapeJobId, 'completed_count');
    } catch (dbErr) {
      console.error(
        `${LOG_PREFIX} scrape-basic-details: DB insert failed for DOT ${carrier.dot_number}:`,
        dbErr.message
      );
      if (scrapeJobId) await incrementJobCount(scrapeJobId, 'failed_count');
      throw dbErr;
    }

    return {
      status: 'ok',
      dotNumber: carrier.dot_number,
      basicsScraped: basicDetails.length,
    };
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
            jobIds.map(async (id) => {
              const job = await queue.getJob(id);
              return job ? job.getState() : 'completed';
            })
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
   * Enqueue a BASIC detail scrape for a single carrier.
   * @param {number|string} carrierId  - fmcsa_monitored_carriers.id
   * @param {string} triggeredBy       - Who/what triggered the scrape
   * @returns {object} The created fmcsa_scrape_jobs row
   */
  async function enqueueBasicDetailScrape(carrierId, triggeredBy) {
    const scrapeJob = await createScrapeJobRow('basic_detail_scrape', triggeredBy, 1);
    await queue.add('scrape-basic-details', {
      carrierId,
      scrapeJobId: scrapeJob.id,
    });
    console.log(
      `${LOG_PREFIX} enqueueBasicDetailScrape: carrierId=${carrierId}, scrapeJobId=${scrapeJob.id} enqueued`
    );
    return scrapeJob;
  }

  /**
   * Enqueue BASIC detail scrapes for all monitored carriers.
   * @param {string} triggeredBy - Who/what triggered the scrape
   * @returns {object} The created fmcsa_scrape_jobs row
   */
  async function enqueueFullBasicDetailScrape(triggeredBy) {
    await seedMonitoredCarriers();

    const carriers = await knex('fmcsa_monitored_carriers')
      .where({ monitoring_active: true })
      .select('id');

    const scrapeJob = await createScrapeJobRow(
      'full_basic_detail_scrape',
      triggeredBy,
      carriers.length
    );

    // Stagger each carrier by 15s — each carrier makes ~14 HTTP requests (7 BASICs × 2)
    for (let i = 0; i < carriers.length; i++) {
      await queue.add(
        'scrape-basic-details',
        { carrierId: carriers[i].id, scrapeJobId: scrapeJob.id },
        { delay: i * 15000 }
      );
    }

    console.log(
      `${LOG_PREFIX} enqueueFullBasicDetailScrape: ${carriers.length} carriers enqueued, scrapeJobId=${scrapeJob.id}`
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
    enqueueBasicDetailScrape,
    enqueueFullBasicDetailScrape,
    seedMonitoredCarriers,
    initScheduler,
    shutdown,
  };
}

module.exports = { createScrapeQueue };
