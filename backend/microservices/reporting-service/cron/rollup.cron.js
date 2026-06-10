'use strict';

/**
 * FN-1279: Nightly rollup cron entry point.
 *
 * Standalone script invoked by the Render Cron Job service at 02:00 UTC.
 * Computes rollup metrics for the previous UTC day across all active tenants
 * and upserts into daily_incident_metrics, daily_vendor_sla, daily_payment_metrics.
 *
 * Override the target day via: ROLLUP_DATE=YYYY-MM-DD node rollup.cron.js
 */

require('dotenv').config();

const knex = require('@goodmen/shared/config/knex');
const { buildRollupService } = require('../services/rollup.service');
const {
  recordRollupStart,
  recordRollupComplete,
  recordRollupFailure
} = require('../telemetry/rollup.telemetry');

function yesterdayUtc(now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

(async () => {
  let day = 'unknown';
  try {
    day = process.env.ROLLUP_DATE || yesterdayUtc();

    const tenantsResult = await knex.raw(
      `SELECT COUNT(*)::int AS count FROM tenants WHERE trial_status IS DISTINCT FROM 'expired'`
    );
    const tenantCount = ((tenantsResult.rows || [])[0] || {}).count || 0;

    recordRollupStart({ day, tenantCount });

    const service = buildRollupService({ knex });
    const start = Date.now();
    const results = await service.runForDay(day);
    const durationMs = Date.now() - start;

    recordRollupComplete({ day, durationMs, results });

    const failed = results.filter((r) => r.errors.length > 0);
    if (failed.length > 0) {
      for (const r of failed) {
        for (const e of r.errors) {
          console.error(`[rollup] error tenant=${r.tenantId} table=${e.table}: ${e.error}`);
        }
      }
      if (failed.length === results.length && results.length > 0) {
        process.exitCode = 1;
      }
    }
  } catch (err) {
    recordRollupFailure({ day, error: err });
    process.exitCode = 1;
  } finally {
    try { await knex.destroy(); } catch (_) {}
  }
})();
