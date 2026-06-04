'use strict';

/**
 * FN-1669 — Tests for the geofence-event worker + load-status automation
 * (Story C — FN-1655).
 *
 * Uses an in-memory knex-shaped stub (same spirit as routes/geofences.test.js,
 * extended with onConflict().ignore().returning() so the idempotency net can be
 * exercised) — no Postgres or Redis needed. Covers:
 *   • the pure load-status state machine (nextLoadStatus)
 *   • the pure crossing classifier (decideEventKind) incl. dwell
 *   • end-to-end processPing: enter/exit pickup & delivery transitions, the
 *     >5-min delivery dwell rule, idempotent reprocessing, dwell events, and
 *     the no-tenant / no-geofence short-circuits.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const shared = require('../index');
const worker = require('./geofence-event-worker');
const automation = require('./load-status-automation');

// ─── In-memory knex stub ─────────────────────────────────────────────────────

function matchesEq(row, conds) {
  return Object.entries(conds).every(([k, v]) => row[k] === v);
}

class FakeBuilder {
  constructor(state, table) {
    this.state = state;
    this.table = table;
    this.preds = [];
    this.op = 'select';
    this.payload = null;
    this.doReturn = false;
    this.order = null;
    this.conflictCols = null;
    this.ignoreConflict = false;
  }
  where(conds) {
    this.preds.push((row) => matchesEq(row, conds));
    return this;
  }
  andWhere(col, val) {
    this.preds.push((row) => row[col] === val);
    return this;
  }
  whereIn(col, arr) {
    const set = new Set(arr);
    this.preds.push((row) => set.has(row[col]));
    return this;
  }
  orderBy(col, dir = 'asc') {
    this.order = { col, dir };
    return this;
  }
  insert(payload) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  onConflict(cols) {
    this.conflictCols = cols;
    return this;
  }
  ignore() {
    this.ignoreConflict = true;
    return this;
  }
  update(patch) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  del() {
    this.op = 'delete';
    return this;
  }
  returning() {
    this.doReturn = true;
    return this;
  }
  first() {
    return Promise.resolve(this._rows()[0]);
  }
  _rows() {
    const rows = this.state[this.table].filter((r) => this.preds.every((p) => p(r)));
    if (this.order) {
      const { col, dir } = this.order;
      rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0));
      if (dir === 'desc') rows.reverse();
    }
    return rows;
  }
  _exec() {
    const table = this.state[this.table];
    if (this.op === 'select') return this._rows();
    if (this.op === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = [];
      for (const r of rows) {
        if (this.conflictCols && this.ignoreConflict) {
          const dup = table.find((existing) =>
            this.conflictCols.every((c) => existing[c] === r[c])
          );
          if (dup) continue; // conflict ignored — no row returned
        }
        const id = r.id || `${this.table}-${++this.state.seq}`;
        const row = { id, created_at: `t${this.state.seq}`, ...r };
        table.push(row);
        inserted.push(row);
      }
      return this.doReturn ? inserted : inserted.length;
    }
    if (this.op === 'update') {
      const matched = this._rows();
      matched.forEach((r) => Object.assign(r, this.payload));
      return this.doReturn ? matched : matched.length;
    }
    if (this.op === 'delete') {
      const matched = this._rows();
      const ids = new Set(matched.map((r) => r.id));
      this.state[this.table] = table.filter((r) => !ids.has(r.id));
      return matched.length;
    }
    return undefined;
  }
  then(resolve, reject) {
    try {
      resolve(this._exec());
    } catch (err) {
      if (reject) reject(err);
      else throw err;
    }
  }
}

function makeKnex(state) {
  const knex = (table) => new FakeBuilder(state, table);
  knex.fn = { now: () => 'now()' };
  knex.transaction = async (cb) => cb(knex);
  return knex;
}

const TENANT = 'tenant-1';
const VEHICLE = 'veh-1';

// A circle geofence centred on a point, big enough that exact coords inside it.
function circleGeofence(id, lng, lat, radiusM = 500) {
  return {
    id,
    tenant_id: TENANT,
    name: id,
    kind: 'circle',
    geometry: { type: 'Circle', center: [lng, lat], radius_m: radiusM },
    is_active: true,
  };
}

function seedState({ loadStatus = 'DISPATCHED', geofences = [] } = {}) {
  return {
    seq: 0,
    vehicles: [{ id: VEHICLE, tenant_id: TENANT }],
    geofences,
    geofence_events: [],
    loads: [
      {
        id: 'load-1',
        truck_id: VEHICLE,
        status: loadStatus,
        updated_at: 't0',
      },
    ],
  };
}

// Distinct timestamps; minutesApart helper builds an ISO ts N minutes after base.
const BASE = '2026-06-03T12:00:00.000Z';
function tsPlus(minutes) {
  return new Date(new Date(BASE).getTime() + minutes * 60000).toISOString();
}

function installKnex(state) {
  shared.setDatabase({ pool: null, query: async () => ({ rows: [] }), getClient: async () => null, knex: makeKnex(state) });
}

// ─── Pure: nextLoadStatus ─────────────────────────────────────────────────────

describe('nextLoadStatus (pure state machine)', () => {
  const { nextLoadStatus, STATUS } = automation;

  it('ENTER while DISPATCHED → ARRIVED_AT_PICKUP', () => {
    assert.equal(
      nextLoadStatus({ currentStatus: 'DISPATCHED', eventKind: 'enter' }),
      STATUS.ARRIVED_AT_PICKUP
    );
  });

  it('ENTER while EN_ROUTE → ARRIVED_AT_PICKUP', () => {
    assert.equal(
      nextLoadStatus({ currentStatus: 'EN_ROUTE', eventKind: 'enter' }),
      STATUS.ARRIVED_AT_PICKUP
    );
  });

  it('ENTER while IN_TRANSIT → ARRIVED_AT_DELIVERY', () => {
    assert.equal(
      nextLoadStatus({ currentStatus: 'IN_TRANSIT', eventKind: 'enter' }),
      STATUS.ARRIVED_AT_DELIVERY
    );
  });

  it('EXIT while ARRIVED_AT_PICKUP → IN_TRANSIT', () => {
    assert.equal(
      nextLoadStatus({ currentStatus: 'ARRIVED_AT_PICKUP', eventKind: 'exit' }),
      STATUS.IN_TRANSIT
    );
  });

  it('EXIT while ARRIVED_AT_DELIVERY after >5 min → DELIVERED', () => {
    assert.equal(
      nextLoadStatus({ currentStatus: 'ARRIVED_AT_DELIVERY', eventKind: 'exit', insideMinutes: 6 }),
      STATUS.DELIVERED
    );
  });

  it('EXIT while ARRIVED_AT_DELIVERY after ≤5 min → no change (null)', () => {
    assert.equal(
      nextLoadStatus({ currentStatus: 'ARRIVED_AT_DELIVERY', eventKind: 'exit', insideMinutes: 5 }),
      null
    );
  });

  it('dwell never changes status', () => {
    assert.equal(nextLoadStatus({ currentStatus: 'ARRIVED_AT_PICKUP', eventKind: 'dwell' }), null);
  });

  it('terminal/other statuses are inert', () => {
    assert.equal(nextLoadStatus({ currentStatus: 'DELIVERED', eventKind: 'enter' }), null);
    assert.equal(nextLoadStatus({ currentStatus: 'NEW', eventKind: 'enter' }), null);
    assert.equal(nextLoadStatus({ currentStatus: 'CANCELLED', eventKind: 'exit' }), null);
  });
});

// ─── Pure: decideEventKind ────────────────────────────────────────────────────

describe('decideEventKind (pure crossing classifier)', () => {
  const { decideEventKind } = worker;

  it('inside with no prior event → enter', () => {
    assert.equal(decideEventKind({ inside: true, latestEvent: null, pingTs: BASE }), 'enter');
  });

  it('inside with prior exit → enter', () => {
    assert.equal(
      decideEventKind({ inside: true, latestEvent: { event_kind: 'exit', ts: BASE }, pingTs: tsPlus(1) }),
      'enter'
    );
  });

  it('outside with prior enter → exit', () => {
    assert.equal(
      decideEventKind({ inside: false, latestEvent: { event_kind: 'enter', ts: BASE }, pingTs: tsPlus(1) }),
      'exit'
    );
  });

  it('still inside before dwell threshold → null', () => {
    assert.equal(
      decideEventKind({ inside: true, latestEvent: { event_kind: 'enter', ts: BASE }, pingTs: tsPlus(10), dwellMinutes: 30 }),
      null
    );
  });

  it('still inside past dwell threshold → dwell (once)', () => {
    assert.equal(
      decideEventKind({ inside: true, latestEvent: { event_kind: 'enter', ts: BASE }, pingTs: tsPlus(31), dwellMinutes: 30 }),
      'dwell'
    );
  });

  it('already dwelled (latest=dwell) → null (no repeat)', () => {
    assert.equal(
      decideEventKind({ inside: true, latestEvent: { event_kind: 'dwell', ts: BASE }, pingTs: tsPlus(120), dwellMinutes: 30 }),
      null
    );
  });

  it('outside with no prior event → null', () => {
    assert.equal(decideEventKind({ inside: false, latestEvent: null, pingTs: BASE }), null);
  });
});

// ─── Pure: pingPoint ──────────────────────────────────────────────────────────

describe('pingPoint', () => {
  it('returns [lng, lat] for a valid fix', () => {
    assert.deepEqual(worker.pingPoint({ lng: -87.6, lat: 41.8 }), [-87.6, 41.8]);
  });
  it('returns null when coords are missing/NaN', () => {
    assert.equal(worker.pingPoint({ lng: -87.6 }), null);
    assert.equal(worker.pingPoint({ lng: 'x', lat: 41.8 }), null);
    assert.equal(worker.pingPoint(null), null);
  });
});

// ─── Integration: processPing end-to-end transitions ─────────────────────────

describe('processPing — load-status automation end-to-end', () => {
  const PICKUP = circleGeofence('gf-pickup', -87.6298, 41.8781); // Chicago
  const inside = { lng: -87.6298, lat: 41.8781 };
  const outside = { lng: -80.0, lat: 25.0 }; // Miami — far away

  let state;
  beforeEach(() => {
    state = seedState({ loadStatus: 'DISPATCHED', geofences: [PICKUP] });
    installKnex(state);
  });

  function load() {
    return state.loads.find((l) => l.id === 'load-1');
  }

  it('ENTER pickup geofence moves DISPATCHED → ARRIVED_AT_PICKUP and writes an enter event', async () => {
    const res = await worker.processPing(
      { id: 'ping-1', vehicle_id: VEHICLE, ts: BASE, ...inside },
      { dwellMinutes: 0 }
    );
    assert.equal(res.events.length, 1);
    assert.equal(res.events[0].event_kind, 'enter');
    assert.equal(res.transitions.length, 1);
    assert.deepEqual(res.transitions[0], {
      loadId: 'load-1',
      fromStatus: 'DISPATCHED',
      toStatus: 'ARRIVED_AT_PICKUP',
    });
    assert.equal(load().status, 'ARRIVED_AT_PICKUP');
    // event is attributed to the load it drove
    assert.equal(state.geofence_events[0].load_id, 'load-1');
  });

  it('EXIT pickup geofence moves ARRIVED_AT_PICKUP → IN_TRANSIT', async () => {
    state.loads[0].status = 'ARRIVED_AT_PICKUP';
    // Seed a prior enter so the exit is edge-detected.
    state.geofence_events.push({
      id: 'ev-0', geofence_id: PICKUP.id, vehicle_id: VEHICLE, event_kind: 'enter', ts: BASE, ping_id: 'ping-0',
    });
    const res = await worker.processPing(
      { id: 'ping-2', vehicle_id: VEHICLE, ts: tsPlus(20), ...outside },
      { dwellMinutes: 0 }
    );
    assert.equal(res.events[0].event_kind, 'exit');
    assert.equal(load().status, 'IN_TRANSIT');
  });

  it('ENTER while IN_TRANSIT moves → ARRIVED_AT_DELIVERY', async () => {
    state.loads[0].status = 'IN_TRANSIT';
    const res = await worker.processPing(
      { id: 'ping-3', vehicle_id: VEHICLE, ts: BASE, ...inside },
      { dwellMinutes: 0 }
    );
    assert.equal(res.events[0].event_kind, 'enter');
    assert.equal(load().status, 'ARRIVED_AT_DELIVERY');
  });

  it('EXIT delivery after >5 min → DELIVERED', async () => {
    state.loads[0].status = 'ARRIVED_AT_DELIVERY';
    state.geofence_events.push({
      id: 'ev-0', geofence_id: PICKUP.id, vehicle_id: VEHICLE, event_kind: 'enter', ts: BASE, ping_id: 'ping-0',
    });
    const res = await worker.processPing(
      { id: 'ping-4', vehicle_id: VEHICLE, ts: tsPlus(6), ...outside },
      { dwellMinutes: 0, deliveryDwellMinutes: 5 }
    );
    assert.equal(res.events[0].event_kind, 'exit');
    assert.equal(load().status, 'DELIVERED');
  });

  it('EXIT delivery after ≤5 min stays ARRIVED_AT_DELIVERY (drive-through)', async () => {
    state.loads[0].status = 'ARRIVED_AT_DELIVERY';
    state.geofence_events.push({
      id: 'ev-0', geofence_id: PICKUP.id, vehicle_id: VEHICLE, event_kind: 'enter', ts: BASE, ping_id: 'ping-0',
    });
    const res = await worker.processPing(
      { id: 'ping-5', vehicle_id: VEHICLE, ts: tsPlus(3), ...outside },
      { dwellMinutes: 0, deliveryDwellMinutes: 5 }
    );
    assert.equal(res.events[0].event_kind, 'exit');
    assert.equal(res.transitions.length, 0);
    assert.equal(load().status, 'ARRIVED_AT_DELIVERY');
  });

  it('reprocessing the same ping is idempotent (no duplicate event, no double transition)', async () => {
    const ping = { id: 'ping-1', vehicle_id: VEHICLE, ts: BASE, ...inside };
    await worker.processPing(ping, { dwellMinutes: 0 });
    const second = await worker.processPing(ping, { dwellMinutes: 0 });
    assert.equal(second.events.length, 0, 'no new event on reprocess');
    assert.equal(second.transitions.length, 0);
    assert.equal(state.geofence_events.length, 1, 'still one event row');
    assert.equal(load().status, 'ARRIVED_AT_PICKUP');
  });

  it('emits a dwell event (no status change) once past the dwell threshold', async () => {
    state.loads[0].status = 'ARRIVED_AT_PICKUP';
    state.geofence_events.push({
      id: 'ev-0', geofence_id: PICKUP.id, vehicle_id: VEHICLE, event_kind: 'enter', ts: BASE, ping_id: 'ping-0',
    });
    const res = await worker.processPing(
      { id: 'ping-6', vehicle_id: VEHICLE, ts: tsPlus(31), ...inside },
      { dwellMinutes: 30 }
    );
    assert.equal(res.events.length, 1);
    assert.equal(res.events[0].event_kind, 'dwell');
    assert.equal(res.transitions.length, 0);
    assert.equal(load().status, 'ARRIVED_AT_PICKUP');
  });

  it('no tenant geofences → no events, no transition', async () => {
    state.geofences = [];
    const res = await worker.processPing(
      { id: 'ping-7', vehicle_id: VEHICLE, ts: BASE, ...inside },
      { dwellMinutes: 0 }
    );
    assert.equal(res.events.length, 0);
    assert.equal(res.transitions.length, 0);
    assert.equal(load().status, 'DISPATCHED');
  });

  it('a ping with no GPS fix is a no-op', async () => {
    const res = await worker.processPing(
      { id: 'ping-8', vehicle_id: VEHICLE, ts: BASE, lat: null, lng: null },
      { dwellMinutes: 0 }
    );
    assert.equal(res.events.length, 0);
    assert.equal(load().status, 'DISPATCHED');
  });

  it('a NEW (not in-flight) load is not advanced even on a crossing', async () => {
    state.loads[0].status = 'NEW';
    const res = await worker.processPing(
      { id: 'ping-9', vehicle_id: VEHICLE, ts: BASE, ...inside },
      { dwellMinutes: 0 }
    );
    assert.equal(res.events.length, 1, 'crossing still logged');
    assert.equal(res.transitions.length, 0, 'but no status change');
    assert.equal(load().status, 'NEW');
  });
});
