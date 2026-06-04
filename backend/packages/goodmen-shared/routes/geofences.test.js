'use strict';

/**
 * FN-1665 — Tests for the geofence CRUD API + service.
 *
 * Uses an in-memory knex-shaped stub injected via setDatabase() (same pattern
 * as user-preferences.test.js) so no real Postgres is needed. Exercises the
 * wire contract the FN-1666 frontend consumes ({ lat, lng } + radiusMeters /
 * vertices, camelCase triggers, { data, meta } list envelope) and confirms it
 * round-trips through the GeoJSON jsonb storage. Covers geometry validation
 * (incl. ≤40 vertices), the app-side point-in-circle / point-in-polygon math,
 * tenant scoping, active/ownedBy/near filters, full CRUD, trigger management,
 * and error paths (400/403/404/409).
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

// ─── In-memory knex stub ────────────────────────────────────────────────────

function makeState() {
  return { geofences: [], geofence_triggers: [], seq: 0 };
}

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
      const inserted = rows.map((r) => {
        if (this.table === 'geofences') {
          const dup = table.find((g) => g.tenant_id === r.tenant_id && g.name === r.name);
          if (dup) {
            const err = new Error('duplicate key value violates unique constraint');
            err.code = '23505';
            throw err;
          }
        }
        const id = r.id || `${this.table}-${++this.state.seq}`;
        const row = { created_at: `t${this.state.seq}`, updated_at: `t${this.state.seq}`, ...r, id };
        table.push(row);
        return row;
      });
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
      if (this.table === 'geofences' && ids.size) {
        this.state.geofence_triggers = this.state.geofence_triggers.filter(
          (t) => !ids.has(t.geofence_id)
        );
      }
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

// ─── HTTP harness ────────────────────────────────────────────────────────────

function buildApp(state) {
  const shared = require('../index');
  shared.setDatabase({
    pool: null,
    query: async () => ({ rows: [] }),
    getClient: async () => null,
    knex: makeKnex(state),
  });
  const router = require('./geofences');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-mock-user']) req.user = { id: req.headers['x-mock-user'] };
    if (req.headers['x-mock-tenant']) req.context = { tenantId: req.headers['x-mock-tenant'] };
    next();
  });
  app.use('/api/geofences', router);
  return app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, { method, path, body, headers }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (_) {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const TENANT = 'tenant-1';
const USER = 'user-1';
const auth = { 'x-mock-user': USER, 'x-mock-tenant': TENANT };

// Wire payloads (frontend contract).
const CIRCLE = {
  name: 'HQ yard',
  kind: 'circle',
  center: { lat: 32.78, lng: -96.8 },
  radiusMeters: 500,
};
// ~2km square around (32.78, -96.8); open ring (no duplicate closing vertex).
const POLYGON = {
  name: 'Dock zone',
  kind: 'polygon',
  vertices: [
    { lat: 32.77, lng: -96.81 },
    { lat: 32.77, lng: -96.79 },
    { lat: 32.79, lng: -96.79 },
    { lat: 32.79, lng: -96.81 },
  ],
};

// ─── Service-level geometry + mapping unit tests ──────────────────────────────

const svc = require('../services/geofence-service');

describe('geofence-service geometry math (FN-1665)', () => {
  it('haversineMeters ~111km per degree of latitude', () => {
    const d = svc.haversineMeters([0, 0], [0, 1]);
    assert.ok(Math.abs(d - 111195) < 500, `expected ~111km, got ${d}`);
  });

  it('pointInCircle / pointInPolygon true inside, false outside', () => {
    const circleGeom = svc.geometryFromPayload(CIRCLE);
    assert.strictEqual(svc.pointInCircle([-96.8, 32.78], circleGeom), true);
    assert.strictEqual(svc.pointInCircle([-96.9, 32.78], circleGeom), false);

    const polyGeom = svc.geometryFromPayload(POLYGON);
    assert.strictEqual(svc.pointInPolygon([-96.8, 32.78], polyGeom), true);
    assert.strictEqual(svc.pointInPolygon([-96.7, 32.78], polyGeom), false);
  });

  it('geometryFromPayload closes the polygon ring for valid GeoJSON', () => {
    const geom = svc.geometryFromPayload(POLYGON);
    const ring = geom.coordinates[0];
    assert.deepStrictEqual(ring[0], ring[ring.length - 1]);
    assert.strictEqual(ring.length, POLYGON.vertices.length + 1);
  });

  it('toWireGeofence returns an OPEN ring and { lat, lng } points', () => {
    const row = {
      id: 'g1',
      name: 'p',
      kind: 'polygon',
      is_active: true,
      geometry: svc.geometryFromPayload(POLYGON),
    };
    const wire = svc.toWireGeofence(row, []);
    assert.strictEqual(wire.vertices.length, POLYGON.vertices.length);
    assert.deepStrictEqual(wire.vertices[0], { lat: 32.77, lng: -96.81 });
  });
});

describe('geofence-service validation (FN-1665)', () => {
  it('accepts a valid circle and polygon (wire shape)', () => {
    assert.deepStrictEqual(svc.validateGeofenceInput(CIRCLE), []);
    assert.deepStrictEqual(svc.validateGeofenceInput(POLYGON), []);
  });

  it('rejects bad kind and missing name', () => {
    const errs = svc.validateGeofenceInput({ kind: 'blob' });
    assert.ok(errs.some((e) => /kind must be one of/.test(e)));
    assert.ok(errs.some((e) => /name is required/.test(e)));
  });

  it('rejects circle without positive radiusMeters', () => {
    const errs = svc.validateGeofenceInput({
      name: 'x',
      kind: 'circle',
      center: { lat: 32.78, lng: -96.8 },
      radiusMeters: 0,
    });
    assert.ok(errs.some((e) => /radiusMeters must be a positive number/.test(e)));
  });

  it('rejects polygon with more than 40 vertices', () => {
    const vertices = [];
    for (let i = 0; i < 41; i++) vertices.push({ lat: 32.78, lng: -96.8 + i * 0.001 });
    const errs = svc.validateGeofenceInput({ name: 'big', kind: 'polygon', vertices });
    assert.ok(errs.some((e) => /at most 40 vertices/.test(e)));
  });

  it('rejects dwell trigger without dwellMinutes and webhook without targetUrl', () => {
    assert.ok(
      svc.validateTrigger({ eventKind: 'dwell', action: 'notify' }).some((e) => /dwellMinutes/.test(e))
    );
    assert.ok(
      svc.validateTrigger({ eventKind: 'enter', action: 'webhook' }).some((e) => /targetUrl/.test(e))
    );
  });
});

// ─── HTTP CRUD + filters ──────────────────────────────────────────────────────

describe('geofences route (FN-1665)', () => {
  let state;
  let server;

  before(async () => {
    state = makeState();
    server = await startServer(buildApp(state));
  });
  after(() => server && server.close());
  beforeEach(() => {
    state.geofences = [];
    state.geofence_triggers = [];
    state.seq = 0;
  });

  it('rejects requests without tenant context (403)', async () => {
    const res = await request(server, { method: 'GET', path: '/api/geofences' });
    assert.strictEqual(res.status, 403);
  });

  it('creates a circle geofence with triggers (201) in wire shape', async () => {
    const res = await request(server, {
      method: 'POST',
      path: '/api/geofences',
      headers: auth,
      body: { ...CIRCLE, triggers: [{ eventKind: 'enter', action: 'notify' }] },
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.kind, 'circle');
    assert.deepStrictEqual(res.body.center, { lat: 32.78, lng: -96.8 });
    assert.strictEqual(res.body.radiusMeters, 500);
    assert.strictEqual(res.body.createdBy, USER);
    assert.strictEqual(res.body.active, true);
    assert.strictEqual(res.body.triggers.length, 1);
    assert.strictEqual(res.body.triggers[0].eventKind, 'enter');
  });

  it('rejects an invalid payload (400)', async () => {
    const res = await request(server, {
      method: 'POST',
      path: '/api/geofences',
      headers: auth,
      body: { name: '', kind: 'circle', center: { lat: 1, lng: 2 }, radiusMeters: -1 },
    });
    assert.strictEqual(res.status, 400);
    assert.ok(Array.isArray(res.body.details));
  });

  it('rejects a duplicate name within the tenant (409)', async () => {
    await request(server, { method: 'POST', path: '/api/geofences', headers: auth, body: CIRCLE });
    const res = await request(server, { method: 'POST', path: '/api/geofences', headers: auth, body: CIRCLE });
    assert.strictEqual(res.status, 409);
  });

  it('lists ({ data, meta }), gets, updates, and deletes a polygon geofence', async () => {
    const created = (
      await request(server, { method: 'POST', path: '/api/geofences', headers: auth, body: POLYGON })
    ).body;

    const list = await request(server, { method: 'GET', path: '/api/geofences', headers: auth });
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.data.length, 1);
    assert.strictEqual(list.body.meta.total, 1);

    const got = await request(server, {
      method: 'GET',
      path: `/api/geofences/${created.id}`,
      headers: auth,
    });
    assert.strictEqual(got.status, 200);
    assert.strictEqual(got.body.kind, 'polygon');
    assert.strictEqual(got.body.vertices.length, 4); // open ring round-trips

    const upd = await request(server, {
      method: 'PUT',
      path: `/api/geofences/${created.id}`,
      headers: auth,
      body: { name: 'Renamed dock', active: false },
    });
    assert.strictEqual(upd.status, 200);
    assert.strictEqual(upd.body.name, 'Renamed dock');
    assert.strictEqual(upd.body.active, false);

    const del = await request(server, {
      method: 'DELETE',
      path: `/api/geofences/${created.id}`,
      headers: auth,
    });
    assert.strictEqual(del.status, 204);

    const after = await request(server, {
      method: 'GET',
      path: `/api/geofences/${created.id}`,
      headers: auth,
    });
    assert.strictEqual(after.status, 404);
  });

  it('rejects PUT geometry without kind (400)', async () => {
    const created = (
      await request(server, { method: 'POST', path: '/api/geofences', headers: auth, body: CIRCLE })
    ).body;
    const res = await request(server, {
      method: 'PUT',
      path: `/api/geofences/${created.id}`,
      headers: auth,
      body: { radiusMeters: 100 }, // geometry field without kind
    });
    assert.strictEqual(res.status, 400);
  });

  it('scopes reads to the tenant (other tenant gets 404)', async () => {
    const created = (
      await request(server, { method: 'POST', path: '/api/geofences', headers: auth, body: CIRCLE })
    ).body;
    const res = await request(server, {
      method: 'GET',
      path: `/api/geofences/${created.id}`,
      headers: { 'x-mock-user': 'user-2', 'x-mock-tenant': 'tenant-2' },
    });
    assert.strictEqual(res.status, 404);
  });

  it('filters by active and ownedBy=me', async () => {
    await request(server, {
      method: 'POST',
      path: '/api/geofences',
      headers: auth,
      body: { ...CIRCLE, name: 'active one' },
    });
    await request(server, {
      method: 'POST',
      path: '/api/geofences',
      headers: auth,
      body: { ...POLYGON, name: 'inactive one', active: false },
    });

    const activeOnly = await request(server, {
      method: 'GET',
      path: '/api/geofences?active=true',
      headers: auth,
    });
    assert.strictEqual(activeOnly.body.data.length, 1);
    assert.strictEqual(activeOnly.body.data[0].name, 'active one');

    const mine = await request(server, { method: 'GET', path: '/api/geofences?ownedBy=me', headers: auth });
    assert.strictEqual(mine.body.data.length, 2);

    const other = await request(server, {
      method: 'GET',
      path: '/api/geofences?ownedBy=user-999',
      headers: auth,
    });
    assert.strictEqual(other.body.data.length, 0);
  });

  it('filters by near-point (containment and radius)', async () => {
    await request(server, { method: 'POST', path: '/api/geofences', headers: auth, body: CIRCLE });

    const inside = await request(server, {
      method: 'GET',
      path: '/api/geofences?near=-96.8,32.78',
      headers: auth,
    });
    assert.strictEqual(inside.body.data.length, 1);

    const farNoRadius = await request(server, {
      method: 'GET',
      path: '/api/geofences?near=-100,40',
      headers: auth,
    });
    assert.strictEqual(farNoRadius.body.data.length, 0);

    const withRadius = await request(server, {
      method: 'GET',
      path: '/api/geofences?near=-96.79,32.78&nearRadiusMeters=5000',
      headers: auth,
    });
    assert.strictEqual(withRadius.body.data.length, 1);
  });
});

// ─── Trigger management ─────────────────────────────────────────────────────

describe('geofence trigger management (FN-1665)', () => {
  let state;
  let server;

  before(async () => {
    state = makeState();
    server = await startServer(buildApp(state));
  });
  after(() => server && server.close());
  beforeEach(() => {
    state.geofences = [];
    state.geofence_triggers = [];
    state.seq = 0;
  });

  async function createCircle() {
    return (
      await request(server, { method: 'POST', path: '/api/geofences', headers: auth, body: CIRCLE })
    ).body;
  }

  it('adds, updates, and removes a trigger (wire shape)', async () => {
    const gf = await createCircle();

    const add = await request(server, {
      method: 'POST',
      path: `/api/geofences/${gf.id}/triggers`,
      headers: auth,
      body: { eventKind: 'dwell', dwellMinutes: 15, action: 'notify' },
    });
    assert.strictEqual(add.status, 201);
    assert.strictEqual(add.body.dwellMinutes, 15);
    assert.strictEqual(add.body.eventKind, 'dwell');
    const triggerId = add.body.id;

    const upd = await request(server, {
      method: 'PUT',
      path: `/api/geofences/${gf.id}/triggers/${triggerId}`,
      headers: auth,
      body: { eventKind: 'exit', action: 'webhook', targetUrl: 'https://example.com/hook' },
    });
    assert.strictEqual(upd.status, 200);
    assert.strictEqual(upd.body.action, 'webhook');
    assert.strictEqual(upd.body.targetUrl, 'https://example.com/hook');

    const del = await request(server, {
      method: 'DELETE',
      path: `/api/geofences/${gf.id}/triggers/${triggerId}`,
      headers: auth,
    });
    assert.strictEqual(del.status, 204);
  });

  it('rejects an invalid trigger (400) and unknown geofence (404)', async () => {
    const gf = await createCircle();
    const bad = await request(server, {
      method: 'POST',
      path: `/api/geofences/${gf.id}/triggers`,
      headers: auth,
      body: { eventKind: 'enter', action: 'webhook' }, // missing targetUrl
    });
    assert.strictEqual(bad.status, 400);

    const missing = await request(server, {
      method: 'POST',
      path: '/api/geofences/does-not-exist/triggers',
      headers: auth,
      body: { eventKind: 'enter', action: 'notify' },
    });
    assert.strictEqual(missing.status, 404);
  });
});
