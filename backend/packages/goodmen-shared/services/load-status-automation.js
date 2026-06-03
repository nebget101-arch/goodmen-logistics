'use strict';

/**
 * FN-1669 — Load-status automation (Story C — FN-1655).
 *
 * Turns geofence crossings (rows the FN-1669 worker writes to geofence_events)
 * into load-status transitions. The state machine was confirmed with PM:
 *
 *   ENTER a geofence:
 *     status DISPATCHED / EN_ROUTE   → ARRIVED_AT_PICKUP    ("arrived at pickup")
 *     status IN_TRANSIT              → ARRIVED_AT_DELIVERY  ("arrived at delivery")
 *   EXIT a geofence:
 *     status ARRIVED_AT_PICKUP                    → IN_TRANSIT  ("in transit")
 *     status ARRIVED_AT_DELIVERY, inside > 5 min  → DELIVERED   ("delivered")
 *   DWELL: no status change in Phase 1 (event only; no detention billing).
 *
 * Pickup vs. delivery is inferred from the load's CURRENT status (there is no
 * schema link between a geofence and a load's pickup/delivery stop), and per
 * PM any active geofence the vehicle crosses can drive the status — the worker
 * does not gate on geofence_triggers. ARRIVED_AT_PICKUP / ARRIVED_AT_DELIVERY
 * were added to loads_status_check in migration
 * 20260603140000_add_arrived_statuses_to_loads.js.
 *
 * The state-machine core (`nextLoadStatus`) is a pure function so it is fully
 * unit-testable without a database; the DB glue lives in `applyForEvent`.
 */

const dbModule = require('../internal/db');

function getDb() {
  return dbModule.knex;
}

// Canonical load statuses this automation reads/writes (subset of loads_status_check).
const STATUS = Object.freeze({
  DISPATCHED: 'DISPATCHED',
  EN_ROUTE: 'EN_ROUTE',
  PICKED_UP: 'PICKED_UP',
  ARRIVED_AT_PICKUP: 'ARRIVED_AT_PICKUP',
  IN_TRANSIT: 'IN_TRANSIT',
  ARRIVED_AT_DELIVERY: 'ARRIVED_AT_DELIVERY',
  DELIVERED: 'DELIVERED',
});

// Loads in one of these statuses are "in flight" and eligible for automation.
// Terminal/other states (NEW, DRAFT, DELIVERED, COMPLETED, CANCELLED, …) are
// never moved by a geofence crossing.
const ACTIVE_LOAD_STATUSES = Object.freeze([
  STATUS.DISPATCHED,
  STATUS.EN_ROUTE,
  STATUS.PICKED_UP,
  STATUS.ARRIVED_AT_PICKUP,
  STATUS.IN_TRANSIT,
  STATUS.ARRIVED_AT_DELIVERY,
]);

// A vehicle's load is matched on truck_id (loads.truck_id → vehicles.id).
const VEHICLE_LOAD_COLUMN = 'truck_id';

// Delivery is only confirmed once the vehicle has dwelled inside the delivery
// geofence longer than this before exiting (filters drive-throughs / mis-fixes).
const DEFAULT_DELIVERY_DWELL_MINUTES = 5;

function normalizeStatus(value) {
  return (value || '').toString().trim().toUpperCase();
}

/**
 * Pure state machine. Given the load's current status, the crossing kind, and
 * how long the vehicle was inside the geofence, return the next status — or
 * `null` when the crossing should not change the status.
 *
 * @param {object}  args
 * @param {string}  args.currentStatus        current loads.status
 * @param {('enter'|'exit'|'dwell')} args.eventKind
 * @param {number} [args.insideMinutes=0]     minutes spent inside (for exit)
 * @param {number} [args.deliveryDwellMinutes=5] threshold for delivery confirm
 * @returns {string|null} next status, or null for "no change"
 */
function nextLoadStatus({
  currentStatus,
  eventKind,
  insideMinutes = 0,
  deliveryDwellMinutes = DEFAULT_DELIVERY_DWELL_MINUTES,
}) {
  const status = normalizeStatus(currentStatus);

  if (eventKind === 'enter') {
    if (status === STATUS.DISPATCHED || status === STATUS.EN_ROUTE) {
      return STATUS.ARRIVED_AT_PICKUP;
    }
    if (status === STATUS.IN_TRANSIT) {
      return STATUS.ARRIVED_AT_DELIVERY;
    }
    return null;
  }

  if (eventKind === 'exit') {
    if (status === STATUS.ARRIVED_AT_PICKUP) {
      return STATUS.IN_TRANSIT;
    }
    if (status === STATUS.ARRIVED_AT_DELIVERY) {
      // Only "delivered" once the vehicle actually sat at the delivery long
      // enough — a quick pass-through is not a delivery.
      return insideMinutes > deliveryDwellMinutes ? STATUS.DELIVERED : null;
    }
    return null;
  }

  // dwell → Phase 1 records the event but never changes status.
  return null;
}

/**
 * Find the active load currently assigned to a vehicle, or null. "Active" means
 * its status is one the automation can advance (see ACTIVE_LOAD_STATUSES).
 * When more than one matches, the most recently updated wins.
 */
async function findActiveLoadForVehicle(vehicleId, conn = getDb()) {
  if (!vehicleId) return null;
  const row = await conn('loads')
    .where({ [VEHICLE_LOAD_COLUMN]: vehicleId })
    .whereIn('status', ACTIVE_LOAD_STATUSES)
    .orderBy('updated_at', 'desc')
    .first();
  return row || null;
}

/**
 * Minutes the vehicle has been continuously inside a geofence as of `exitTs` —
 * i.e. the gap since the matching 'enter' event for this (vehicle, geofence).
 * Returns 0 when there is no prior enter (can't prove a dwell).
 */
async function minutesInsideSinceEnter(
  { vehicleId, geofenceId, exitTs },
  conn = getDb()
) {
  const enter = await conn('geofence_events')
    .where({ vehicle_id: vehicleId, geofence_id: geofenceId, event_kind: 'enter' })
    .orderBy('ts', 'desc')
    .first();
  if (!enter || !enter.ts) return 0;
  const enteredMs = new Date(enter.ts).getTime();
  const exitedMs = new Date(exitTs).getTime();
  if (!Number.isFinite(enteredMs) || !Number.isFinite(exitedMs)) return 0;
  return Math.max(0, (exitedMs - enteredMs) / 60000);
}

/**
 * Apply load-status automation for a single geofence event row.
 *
 * Looks up the vehicle's active load, runs the state machine, and — when the
 * status changes — updates loads.status and stamps geofence_events.load_id so
 * the event is attributable to the load it drove. Idempotent at the status
 * level: the UPDATE is guarded on the from-status, so reprocessing the same
 * crossing (the worker may retry) is a no-op once the transition has happened.
 *
 * @param {object} event  a geofence_events row: { id, vehicle_id, geofence_id, event_kind, ts }
 * @param {object} [options]
 * @param {number} [options.deliveryDwellMinutes]
 * @param {import('knex').Knex} [conn]
 * @returns {Promise<null|{loadId,fromStatus,toStatus}>} the transition, or null
 */
async function applyForEvent(event, options = {}, conn = getDb()) {
  if (!event || !event.vehicle_id || !event.event_kind) return null;

  const load = await findActiveLoadForVehicle(event.vehicle_id, conn);
  if (!load) return null;

  let insideMinutes = 0;
  if (event.event_kind === 'exit') {
    insideMinutes = await minutesInsideSinceEnter(
      { vehicleId: event.vehicle_id, geofenceId: event.geofence_id, exitTs: event.ts },
      conn
    );
  }

  const fromStatus = normalizeStatus(load.status);
  const toStatus = nextLoadStatus({
    currentStatus: fromStatus,
    eventKind: event.event_kind,
    insideMinutes,
    deliveryDwellMinutes:
      options.deliveryDwellMinutes != null
        ? options.deliveryDwellMinutes
        : DEFAULT_DELIVERY_DWELL_MINUTES,
  });

  // Even when the crossing drives no status change, attribute the event to the
  // active load so the geofence_events log is queryable by load.
  if (event.id) {
    await conn('geofence_events').where({ id: event.id }).update({ load_id: load.id });
  }

  if (!toStatus || toStatus === fromStatus) return null;

  const updated = await conn('loads')
    .where({ id: load.id, status: fromStatus }) // from-status guard = idempotent
    .update({ status: toStatus, updated_at: conn.fn.now() });

  if (!updated) return null; // lost a race / already transitioned
  return { loadId: load.id, fromStatus, toStatus };
}

module.exports = {
  STATUS,
  ACTIVE_LOAD_STATUSES,
  DEFAULT_DELIVERY_DWELL_MINUTES,
  // pure state machine (unit-testable, no DB)
  nextLoadStatus,
  normalizeStatus,
  // DB glue
  findActiveLoadForVehicle,
  minutesInsideSinceEnter,
  applyForEvent,
};
