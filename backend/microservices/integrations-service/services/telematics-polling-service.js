'use strict';

/**
 * Telematics polling-fallback service — FN-1661
 *
 * When a device stops delivering webhooks (provider outage, misconfigured
 * endpoint), we fall back to pulling its last known position over the provider
 * REST API. A device is "stale" when `last_seen_at` is older than
 * TELEMATICS_POLL_STALE_MINUTES (default 10) — or never set.
 *
 * Trigger: an external Render cron job hits POST /api/telematics/poll, or the
 * in-process interval scheduler (`startPollingScheduler`) runs it every
 * TELEMATICS_POLL_INTERVAL_MINUTES. Both paths call `runPollingFallback`.
 *
 * Schema-defensive: no-ops cleanly when telematics tables are absent.
 */

const knex = require('@goodmen/shared/config/knex');
const dtLogger = require('@goodmen/shared/utils/logger');
const { getAdapter } = require('@goodmen/shared/services/telematics');
const { persistPings, DEVICES_TABLE, PROVIDERS_TABLE } = require('./telematics-ingest-service');

const STALE_MINUTES = parseInt(process.env.TELEMATICS_POLL_STALE_MINUTES || '10', 10);
const MAX_DEVICES_PER_RUN = parseInt(
  process.env.TELEMATICS_POLL_MAX_DEVICES || '500',
  10
);

async function hasTable(table) {
  return knex.schema.hasTable(table).catch(() => false);
}

/**
 * Return stale devices joined to their provider code, capped at
 * MAX_DEVICES_PER_RUN. A device is stale when last_seen_at < now - N minutes
 * or is null.
 */
async function findStaleDevices({ staleMinutes = STALE_MINUTES } = {}) {
  if (!(await hasTable(DEVICES_TABLE)) || !(await hasTable(PROVIDERS_TABLE))) {
    return [];
  }
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  try {
    return await knex(`${DEVICES_TABLE} as d`)
      .join(`${PROVIDERS_TABLE} as p`, 'p.id', 'd.provider_id')
      .where(function whereStale() {
        this.whereNull('d.last_seen_at').orWhere('d.last_seen_at', '<', cutoff);
      })
      .whereNotNull('d.vehicle_id')
      .select(
        'd.id',
        'd.vehicle_id',
        'd.provider_id',
        'd.external_device_id',
        'd.last_seen_at',
        'p.code as provider_code'
      )
      .limit(MAX_DEVICES_PER_RUN);
  } catch (err) {
    dtLogger.error('telematics_poll_find_stale_failed', err);
    return [];
  }
}

/**
 * Poll all stale devices once. Returns aggregate counters. Each device is
 * polled independently; a single provider/network failure does not abort the
 * run.
 */
async function runPollingFallback(opts = {}) {
  const devices = await findStaleDevices(opts);
  const summary = {
    staleDevices: devices.length,
    polled: 0,
    inserted: 0,
    errors: 0,
    skippedNoToken: 0
  };

  for (const device of devices) {
    const adapter = getAdapter(device.provider_code);
    if (!adapter) {
      summary.errors += 1;
      continue;
    }
    if (!adapter.apiToken) {
      summary.skippedNoToken += 1;
      continue;
    }
    try {
      const pings = await adapter.fetchLatestPosition(device);
      summary.polled += 1;
      if (pings && pings.length) {
        const result = await persistPings(device.provider_code, pings);
        summary.inserted += result.inserted;
      }
    } catch (err) {
      summary.errors += 1;
      dtLogger.error('telematics_poll_device_failed', err, {
        deviceId: device.id,
        provider: device.provider_code
      });
    }
  }

  dtLogger.info('telematics_poll_run', summary);
  return summary;
}

let _intervalHandle = null;

/**
 * Start an in-process interval scheduler. Safe to call once at boot; a no-op
 * when already running. Returns the interval handle (or null when disabled).
 */
function startPollingScheduler() {
  const minutes = parseInt(
    process.env.TELEMATICS_POLL_INTERVAL_MINUTES || '0',
    10
  );
  if (!minutes || minutes <= 0) {
    dtLogger.info('telematics_poll_scheduler_disabled', {
      reason: 'TELEMATICS_POLL_INTERVAL_MINUTES unset/<=0'
    });
    return null;
  }
  if (_intervalHandle) return _intervalHandle;
  _intervalHandle = setInterval(() => {
    runPollingFallback().catch((err) =>
      dtLogger.error('telematics_poll_scheduler_tick_failed', err)
    );
  }, minutes * 60 * 1000);
  if (_intervalHandle.unref) _intervalHandle.unref();
  dtLogger.info('telematics_poll_scheduler_started', { intervalMinutes: minutes });
  return _intervalHandle;
}

function stopPollingScheduler() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

module.exports = {
  runPollingFallback,
  findStaleDevices,
  startPollingScheduler,
  stopPollingScheduler,
  STALE_MINUTES
};
