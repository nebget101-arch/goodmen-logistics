'use strict';

/**
 * FN-1669 — Geofence event worker (Story C — FN-1655).
 *
 * A Bull-backed worker that consumes new vehicle_position_pings, computes which
 * geofences each ping crosses, writes one geofence_events row per crossing
 * (enter / exit / dwell), and drives load-status automation off those events.
 *
 * Geometry: prod has NO PostGIS (FN-1664), so containment is computed app-side
 * by reusing geofence-service.js's `geofenceContainsPoint` rather than
 * re-deriving point-in-polygon here.
 *
 * Crossing detection is edge-triggered against the event log: a geofence the
 * vehicle is now inside but whose latest event was an exit (or has none) is an
 * 'enter'; the reverse is an 'exit'; staying inside past the dwell threshold
 * (once) is a 'dwell'. Writes are idempotent via the
 * (ping_id, geofence_id, event_kind) unique constraint, so a retried/reprocessed
 * ping never double-emits.
 *
 * Per PM (FN-1669): any active geofence in the vehicle's tenant can drive load
 * status — the worker does not gate crossings on geofence_triggers. Dwell is
 * recorded as an event only (no detention billing in Phase 1).
 */

const dbModule = require('../internal/db');
const { geofenceContainsPoint } = require('./geofence-service');
const loadStatusAutomation = require('./load-status-automation');

const LOG_PREFIX = '[geofence-event-worker]';
const QUEUE_NAME = 'geofence-events';
const PROCESS_JOB = 'process-ping';

// Generic dwell threshold (minutes inside before a one-off 'dwell' event fires).
// 0 / unset disables dwell events. The delivery-confirmation dwell (>5 min) is
// separate and lives in load-status-automation.
const DEFAULT_DWELL_MINUTES = Number.parseInt(process.env.GEOFENCE_DWELL_MINUTES, 10) || 30;
const DEFAULT_DELIVERY_DWELL_MINUTES =
  Number.parseInt(process.env.GEOFENCE_DELIVERY_DWELL_MINUTES, 10) ||
  loadStatusAutomation.DEFAULT_DELIVERY_DWELL_MINUTES;

function getDb() {
  return dbModule.knex;
}

// ─── Pure crossing logic ─────────────────────────────────────────────────────

/** A finite [lng, lat] point from a ping, or null if the ping has no fix. */
function pingPoint(ping) {
  if (!ping) return null;
  const lng = Number(ping.lng);
  const lat = Number(ping.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

/**
 * Decide the crossing kind for one geofence given the vehicle's current
 * containment and its latest prior event for that geofence. Pure — no DB.
 *
 * @param {object}  args
 * @param {boolean} args.inside         is the ping inside the geofence now?
 * @param {object|null} args.latestEvent latest geofence_events row for (vehicle, geofence)
 * @param {string|Date} args.pingTs     timestamp of the current ping
 * @param {number} [args.dwellMinutes]  dwell threshold (0/null disables dwell)
 * @returns {('enter'|'exit'|'dwell'|null)}
 */
function decideEventKind({ inside, latestEvent, pingTs, dwellMinutes = DEFAULT_DWELL_MINUTES }) {
  const latestKind = latestEvent ? latestEvent.event_kind : null;
  const priorInside = latestKind === 'enter' || latestKind === 'dwell';

  if (inside && !priorInside) return 'enter';
  if (!inside && priorInside) return 'exit';

  if (inside && priorInside) {
    // One dwell per stay: only when the latest event is the 'enter' (a dwell
    // already fired makes latestKind 'dwell' and we stop), and only once the
    // vehicle has been inside at least `dwellMinutes`.
    if (latestKind === 'enter' && dwellMinutes && latestEvent && latestEvent.ts) {
      const mins = (new Date(pingTs).getTime() - new Date(latestEvent.ts).getTime()) / 60000;
      if (Number.isFinite(mins) && mins >= dwellMinutes) return 'dwell';
    }
    return null;
  }

  return null; // outside and was outside — nothing to record
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

/** tenant_id for a vehicle, or null (pings carry no tenant; geofences are tenant-scoped). */
async function resolveTenantId(vehicleId, conn = getDb()) {
  if (!vehicleId) return null;
  const row = await conn('vehicles').where({ id: vehicleId }).first();
  return (row && row.tenant_id) || null;
}

/** Active geofences for a tenant (the crossing candidates for a ping). */
async function loadActiveGeofences(tenantId, conn = getDb()) {
  if (!tenantId) return [];
  return conn('geofences').where({ tenant_id: tenantId, is_active: true });
}

/**
 * Latest geofence_events row per geofence for a vehicle, keyed by geofence_id.
 * One query, reduced in JS (candidate sets are small — dispatcher-defined).
 */
async function latestEventsByGeofence(vehicleId, geofenceIds, conn = getDb()) {
  if (!geofenceIds.length) return {};
  const rows = await conn('geofence_events')
    .where({ vehicle_id: vehicleId })
    .whereIn('geofence_id', geofenceIds)
    .orderBy('ts', 'desc');
  const byGeofence = {};
  for (const row of rows) {
    if (!byGeofence[row.geofence_id]) byGeofence[row.geofence_id] = row; // first = latest
  }
  return byGeofence;
}

// ─── Ping processing ─────────────────────────────────────────────────────────

/**
 * Process a single ping: compute crossings against the vehicle's tenant
 * geofences, persist new geofence_events (idempotently), and run load-status
 * automation for each newly written event.
 *
 * @param {object} ping  { id, vehicle_id, ts, lat, lng }
 * @param {object} [options]
 * @param {number} [options.dwellMinutes]
 * @param {number} [options.deliveryDwellMinutes]
 * @param {import('knex').Knex} [conn]
 * @returns {Promise<{pingId, events: Array, transitions: Array}>}
 */
async function processPing(ping, options = {}, conn = getDb()) {
  const result = { pingId: ping && ping.id, events: [], transitions: [] };
  const point = pingPoint(ping);
  if (!ping || !ping.id || !ping.vehicle_id || !point) return result;

  const dwellMinutes =
    options.dwellMinutes != null ? options.dwellMinutes : DEFAULT_DWELL_MINUTES;
  const deliveryDwellMinutes =
    options.deliveryDwellMinutes != null
      ? options.deliveryDwellMinutes
      : DEFAULT_DELIVERY_DWELL_MINUTES;

  const tenantId = await resolveTenantId(ping.vehicle_id, conn);
  const geofences = await loadActiveGeofences(tenantId, conn);
  if (!geofences.length) return result;

  const latest = await latestEventsByGeofence(
    ping.vehicle_id,
    geofences.map((g) => g.id),
    conn
  );

  for (const geofence of geofences) {
    const inside = geofenceContainsPoint(geofence, point);
    const kind = decideEventKind({
      inside,
      latestEvent: latest[geofence.id] || null,
      pingTs: ping.ts,
      dwellMinutes,
    });
    if (!kind) continue;

    const inserted = await insertEvent(
      {
        geofence_id: geofence.id,
        vehicle_id: ping.vehicle_id,
        event_kind: kind,
        ts: ping.ts,
        ping_id: ping.id,
      },
      conn
    );
    if (!inserted) continue; // idempotency: this crossing was already recorded

    result.events.push(inserted);
    const transition = await loadStatusAutomation.applyForEvent(
      inserted,
      { deliveryDwellMinutes },
      conn
    );
    if (transition) result.transitions.push(transition);
  }

  return result;
}

/**
 * Insert one geofence_events row, honouring the (ping_id, geofence_id,
 * event_kind) idempotency constraint. Returns the inserted row, or null when
 * the row already existed (conflict ignored).
 */
async function insertEvent(row, conn = getDb()) {
  const [created] = await conn('geofence_events')
    .insert(row)
    .onConflict(['ping_id', 'geofence_id', 'event_kind'])
    .ignore()
    .returning('*');
  return created || null;
}

// ─── Bull worker ─────────────────────────────────────────────────────────────

/**
 * Create the geofence-event worker. Mirrors the FN-1424 fmcsa-import-queue
 * shape (lazy ioredis client, TLS for rediss://, ready/error wiring).
 *
 * @param {object} options
 * @param {string} options.redisUrl
 * @param {import('knex').Knex} [options.knex]  defaults to the shared app knex
 * @param {number} [options.dwellMinutes]
 * @param {number} [options.deliveryDwellMinutes]
 */
function createGeofenceEventWorker({
  redisUrl,
  knex,
  dwellMinutes = DEFAULT_DWELL_MINUTES,
  deliveryDwellMinutes = DEFAULT_DELIVERY_DWELL_MINUTES,
} = {}) {
  if (!redisUrl) throw new Error(`${LOG_PREFIX} redisUrl is required`);

  const conn = knex || getDb();
  const Queue = require('bull');
  const Redis = require('ioredis');
  const useTls = redisUrl.startsWith('rediss://');

  const queue = new Queue(QUEUE_NAME, {
    prefix: QUEUE_NAME,
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
      attempts: 3, // crossings are cheap to recompute; idempotent writes make retry safe
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 3600, count: 5000 },
      removeOnFail: { age: 7 * 24 * 3600 },
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
  queue.client.on('end', () => { redisConnected = false; });
  queue.client.on('close', () => { redisConnected = false; });
  queue.on('failed', (job, err) => {
    console.error(`${LOG_PREFIX} job ${job.id} failed:`, err.message);
  });

  function isReady() {
    return redisConnected;
  }

  // Processor: a job carries one ping or a per-minute batch of pings.
  queue.process(PROCESS_JOB, async (job) => {
    const pings = Array.isArray(job.data.pings)
      ? job.data.pings
      : job.data.ping
        ? [job.data.ping]
        : [];
    const results = [];
    for (const ping of pings) {
      results.push(
        await processPing(ping, { dwellMinutes, deliveryDwellMinutes }, conn)
      );
    }
    const events = results.reduce((n, r) => n + r.events.length, 0);
    const transitions = results.reduce((n, r) => n + r.transitions.length, 0);
    return { pings: pings.length, events, transitions };
  });

  /** Enqueue a single ping for crossing computation. */
  async function enqueuePing(ping) {
    return queue.add(PROCESS_JOB, { ping });
  }

  /** Enqueue a batch of pings (the "batched per minute" path) as one job. */
  async function enqueuePings(pings) {
    return queue.add(PROCESS_JOB, { pings });
  }

  async function shutdown() {
    try {
      await queue.close();
    } catch (err) {
      console.error(`${LOG_PREFIX} error closing queue:`, err.message);
    }
  }

  return {
    queue,
    enqueuePing,
    enqueuePings,
    processPing: (ping, opts) =>
      processPing(ping, { dwellMinutes, deliveryDwellMinutes, ...(opts || {}) }, conn),
    isReady,
    shutdown,
  };
}

module.exports = {
  createGeofenceEventWorker,
  QUEUE_NAME,
  DEFAULT_DWELL_MINUTES,
  DEFAULT_DELIVERY_DWELL_MINUTES,
  // pure / unit-testable
  pingPoint,
  decideEventKind,
  // DB-backed (exported for the worker + tests)
  resolveTenantId,
  loadActiveGeofences,
  latestEventsByGeofence,
  insertEvent,
  processPing,
};
