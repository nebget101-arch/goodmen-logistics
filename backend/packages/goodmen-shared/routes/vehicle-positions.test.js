'use strict';

/**
 * FN-1672 — Tests for the vehicle-positions read API + the live-map WS helper.
 *
 * Uses an in-memory knex-shaped stub injected via setDatabase() (same pattern
 * as geofences.test.js) so no real Postgres is needed. Covers:
 *   • latest-ping-per-vehicle selection (distinctOn) within the 24h lookback
 *   • tenant scoping (vehicles boundary) + stale-vehicle exclusion
 *   • status / driverId / vehicleIds / bbox / geofenceId filters
 *   • breadcrumb trail (default/cap hours, chronological, tenant 404)
 *   • the vehicle:position broadcast helper shape + guard rails
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

const wsService = require('../services/websocket.service');

// ─── In-memory knex stub ────────────────────────────────────────────────────

function cmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

class FakeBuilder {
  constructor(state, table) {
    this.state = state;
    this.table = table;
    this.preds = [];
    this.orders = [];
    this.distinctCol = null;
    this.limitN = null;
  }
  where(a, b, c) {
    if (typeof a === 'object') {
      this.preds.push((row) => Object.entries(a).every(([k, v]) => row[k] === v));
    } else if (c === undefined) {
      this.preds.push((row) => row[a] === b);
    } else {
      const op = b;
      this.preds.push((row) => {
        if (op === '>=') return row[a] >= c;
        if (op === '<=') return row[a] <= c;
        if (op === '>') return row[a] > c;
        if (op === '<') return row[a] < c;
        return row[a] === c;
      });
    }
    return this;
  }
  whereIn(col, arr) {
    const set = new Set(arr);
    this.preds.push((row) => set.has(row[col]));
    return this;
  }
  distinctOn(col) {
    this.distinctCol = col;
    return this;
  }
  orderBy(a, dir) {
    if (Array.isArray(a)) {
      for (const o of a) this.orders.push({ col: o.column, dir: o.order || 'asc' });
    } else {
      this.orders.push({ col: a, dir: dir || 'asc' });
    }
    return this;
  }
  limit(n) {
    this.limitN = n;
    return this;
  }
  _rows() {
    let rows = (this.state[this.table] || []).filter((r) => this.preds.every((p) => p(r)));
    if (this.orders.length) {
      rows = rows.slice().sort((a, b) => {
        for (const { col, dir } of this.orders) {
          const c = cmp(a[col], b[col]);
          if (c !== 0) return dir === 'desc' ? -c : c;
        }
        return 0;
      });
    }
    if (this.distinctCol) {
      const seen = new Set();
      rows = rows.filter((r) => {
        const k = r[this.distinctCol];
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows.map((r) => ({ ...r }));
  }
  select() {
    return Promise.resolve(this._rows());
  }
  first() {
    return Promise.resolve(this._rows()[0]);
  }
  then(resolve, reject) {
    return Promise.resolve(this._rows()).then(resolve, reject);
  }
}

function makeKnex(state) {
  return (table) => new FakeBuilder(state, table);
}

// ─── HTTP harness ────────────────────────────────────────────────────────────

function buildApp(state) {
  const shared = require('../index');
  shared.setDatabase({
    pool: null,
    query: async () => ({ rows: [] }),
    getClient: async () => null,
    knex: makeKnex(state)
  });
  delete require.cache[require.resolve('./vehicle-positions')];
  const router = require('./vehicle-positions');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-mock-tenant']) req.context = { tenantId: req.headers['x-mock-tenant'] };
    if (req.headers['x-mock-user']) req.user = { id: req.headers['x-mock-user'] };
    next();
  });
  app.use('/api/vehicle-positions', router);
  return app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, { method = 'GET', path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT = 'tenant-A';
const OTHER_TENANT = 'tenant-B';

function recentIso(secondsAgo) {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}
const OLD_ISO = '2020-01-01T00:00:00.000Z'; // outside the 24h lookback

function seedState() {
  return {
    vehicles: [
      { id: 'v1', tenant_id: TENANT, unit_number: '101', make: 'Volvo', model: 'VNL', year: 2022, vehicle_type: 'truck', status: 'in-service', leased_driver_id: 'd1' },
      { id: 'v2', tenant_id: TENANT, unit_number: '102', make: 'Freightliner', model: 'Cascadia', year: 2021, vehicle_type: 'truck', status: 'out-of-service', leased_driver_id: 'd2' },
      { id: 'v3', tenant_id: TENANT, unit_number: '103', make: 'Kenworth', model: 'T680', year: 2023, vehicle_type: 'truck', status: 'in-service', leased_driver_id: null },
      { id: 'vOther', tenant_id: OTHER_TENANT, unit_number: '900', make: 'Mack', model: 'Anthem', year: 2020, vehicle_type: 'truck', status: 'in-service', leased_driver_id: 'dX' }
    ],
    vehicle_position_pings: [
      // v1 — two recent pings; latest (60s ago) must win
      { vehicle_id: 'v1', lat: 40.0, lng: -74.0, speed_mph: 55, heading_deg: 90, ts: recentIso(600) },
      { vehicle_id: 'v1', lat: 40.5, lng: -74.5, speed_mph: 60, heading_deg: 95, ts: recentIso(60) },
      // v2 — one recent ping
      { vehicle_id: 'v2', lat: 41.0, lng: -75.0, speed_mph: 0, heading_deg: 0, ts: recentIso(120) },
      // v3 — only a stale ping (>24h) → excluded from the live map
      { vehicle_id: 'v3', lat: 42.0, lng: -76.0, speed_mph: 10, heading_deg: 180, ts: OLD_ISO },
      // other tenant — recent, but must never appear
      { vehicle_id: 'vOther', lat: 40.1, lng: -74.1, speed_mph: 50, heading_deg: 80, ts: recentIso(30) }
    ],
    geofences: [
      // Circle centered on v1's latest position (~3km radius) — contains v1, not v2
      { id: 'g1', tenant_id: TENANT, kind: 'circle', geometry: { type: 'Circle', center: [-74.5, 40.5], radius_m: 3000 } }
    ]
  };
}

async function withServer(state, fn) {
  const server = await startServer(buildApp(state));
  try {
    return await fn(server);
  } finally {
    server.close();
  }
}

// ─── Tests: latest positions ─────────────────────────────────────────────────

describe('GET /api/vehicle-positions', () => {
  it('403 when tenant context is missing', async () => {
    await withServer(seedState(), async (server) => {
      const res = await request(server, { path: '/api/vehicle-positions' });
      assert.equal(res.status, 403);
    });
  });

  it('returns the latest ping per vehicle, tenant-scoped, excluding stale vehicles', async () => {
    await withServer(seedState(), async (server) => {
      const res = await request(server, {
        path: '/api/vehicle-positions',
        headers: { 'x-mock-tenant': TENANT }
      });
      assert.equal(res.status, 200);
      const byId = Object.fromEntries(res.body.data.map((p) => [p.vehicleId, p]));
      // v1 + v2 present; v3 stale, vOther other-tenant → absent
      assert.deepEqual(Object.keys(byId).sort(), ['v1', 'v2']);
      // latest ping wins for v1
      assert.equal(byId.v1.lat, 40.5);
      assert.equal(byId.v1.speedMph, 60);
      // metadata joined
      assert.equal(byId.v1.unitNumber, '101');
      assert.equal(byId.v1.driverId, 'd1');
      assert.ok(byId.v1.lastPingAgeSeconds >= 0);
      assert.equal(res.body.meta.total, 2);
      assert.equal(res.body.meta.lookbackHours, 24);
    });
  });

  it('filters by status', async () => {
    await withServer(seedState(), async (server) => {
      const res = await request(server, {
        path: '/api/vehicle-positions?status=in-service',
        headers: { 'x-mock-tenant': TENANT }
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.map((p) => p.vehicleId), ['v1']);
    });
  });

  it('filters by driverId', async () => {
    await withServer(seedState(), async (server) => {
      const res = await request(server, {
        path: '/api/vehicle-positions?driverId=d2',
        headers: { 'x-mock-tenant': TENANT }
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.map((p) => p.vehicleId), ['v2']);
    });
  });

  it('filters by vehicleIds', async () => {
    await withServer(seedState(), async (server) => {
      const res = await request(server, {
        path: '/api/vehicle-positions?vehicleIds=v2,v3',
        headers: { 'x-mock-tenant': TENANT }
      });
      assert.equal(res.status, 200);
      // v3 has no recent ping → only v2
      assert.deepEqual(res.body.data.map((p) => p.vehicleId), ['v2']);
    });
  });

  it('filters by bbox', async () => {
    await withServer(seedState(), async (server) => {
      // bbox around v2 (41.0, -75.0) only
      const res = await request(server, {
        path: '/api/vehicle-positions?bbox=-75.5,40.8,-74.8,41.2',
        headers: { 'x-mock-tenant': TENANT }
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.map((p) => p.vehicleId), ['v2']);
    });
  });

  it('filters by geofenceId (containment)', async () => {
    await withServer(seedState(), async (server) => {
      const res = await request(server, {
        path: '/api/vehicle-positions?geofenceId=g1',
        headers: { 'x-mock-tenant': TENANT }
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.map((p) => p.vehicleId), ['v1']);
      assert.equal(res.body.meta.geofenceId, 'g1');
    });
  });

  it('geofenceId from another tenant matches nothing', async () => {
    const state = seedState();
    state.geofences[0].tenant_id = OTHER_TENANT;
    await withServer(state, async (server) => {
      const res = await request(server, {
        path: '/api/vehicle-positions?geofenceId=g1',
        headers: { 'x-mock-tenant': TENANT }
      });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data, []);
    });
  });
});

// ─── Tests: breadcrumbs ──────────────────────────────────────────────────────

describe('GET /api/vehicle-positions/:vehicleId/breadcrumbs', () => {
  it('403 without tenant context', async () => {
    await withServer(seedState(), async (server) => {
      const res = await request(server, { path: '/api/vehicle-positions/v1/breadcrumbs' });
      assert.equal(res.status, 403);
    });
  });

  it('404 for a vehicle outside the tenant', async () => {
    await withServer(seedState(), async (server) => {
      const res = await request(server, {
        path: '/api/vehicle-positions/vOther/breadcrumbs',
        headers: { 'x-mock-tenant': TENANT }
      });
      assert.equal(res.status, 404);
    });
  });

  it('returns the recent trail chronologically within the window', async () => {
    await withServer(seedState(), async (server) => {
      const res = await request(server, {
        path: '/api/vehicle-positions/v1/breadcrumbs?hours=4',
        headers: { 'x-mock-tenant': TENANT }
      });
      assert.equal(res.status, 200);
      // both v1 pings are within 4h, ascending by ts (oldest first)
      assert.equal(res.body.data.length, 2);
      assert.equal(res.body.data[0].lat, 40.0);
      assert.equal(res.body.data[1].lat, 40.5);
      assert.equal(res.body.meta.hours, 4);
      assert.equal(res.body.meta.total, 2);
    });
  });

  it('defaults and caps the hours window', async () => {
    await withServer(seedState(), async (server) => {
      const def = await request(server, {
        path: '/api/vehicle-positions/v1/breadcrumbs',
        headers: { 'x-mock-tenant': TENANT }
      });
      assert.equal(def.body.meta.hours, 4);
      const capped = await request(server, {
        path: '/api/vehicle-positions/v1/breadcrumbs?hours=999',
        headers: { 'x-mock-tenant': TENANT }
      });
      assert.equal(capped.body.meta.hours, 24);
    });
  });
});

// ─── Tests: live-map WS broadcast helper ─────────────────────────────────────

describe('websocket.service.emitVehiclePosition', () => {
  it('normalizes a ping into the vehicle:position payload shape', () => {
    const payload = wsService._buildVehiclePositionPayload({
      vehicleId: 'v1',
      lat: '40.5',
      lng: '-74.5',
      speedMph: '60',
      headingDeg: 95,
      ts: new Date('2026-06-03T12:00:00.000Z')
    });
    assert.deepEqual(payload, {
      vehicleId: 'v1',
      lat: 40.5,
      lng: -74.5,
      speedMph: 60,
      headingDeg: 95,
      ts: '2026-06-03T12:00:00.000Z'
    });
  });

  it('returns missing_args without a tenant or vehicle', async () => {
    assert.equal((await wsService.emitVehiclePosition({})).reason, 'missing_args');
    assert.equal(
      (await wsService.emitVehiclePosition({ tenantId: 't1', position: {} })).reason,
      'missing_args'
    );
  });

  it('returns no_bridge when the WS bridge env is not configured', async () => {
    const prevUrl = process.env.INTERNAL_WS_EMIT_URL;
    const prevSecret = process.env.INTERNAL_WS_SECRET;
    delete process.env.INTERNAL_WS_EMIT_URL;
    delete process.env.INTERNAL_WS_SECRET;
    try {
      const r = await wsService.emitVehiclePosition({
        tenantId: 't1',
        position: { vehicleId: 'v1', lat: 1, lng: 2, ts: recentIso(1) }
      });
      assert.equal(r.delivered, false);
      assert.equal(r.reason, 'no_bridge');
    } finally {
      if (prevUrl !== undefined) process.env.INTERNAL_WS_EMIT_URL = prevUrl;
      if (prevSecret !== undefined) process.env.INTERNAL_WS_SECRET = prevSecret;
    }
  });
});
