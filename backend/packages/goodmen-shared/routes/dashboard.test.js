'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');
const http = require('http');

// Mock the JWT auth middleware so we can drive the route from headers.
function authModuleMock() {
  return (req, _res, next) => {
    req.user = { id: 'u-1', role: 'admin' };
    next();
  };
}
const authPath = path.resolve(__dirname, './auth-middleware.js');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: authModuleMock
};

/**
 * FN-1333: Tests for the windowed dashboard stats endpoint.
 *
 * The route is exercised by stubbing both `query` (used by raw SQL groups)
 * and `knex` (used for `to_regclass`/`hasTable` lookups via the same `query`
 * abstraction). We don't hit a real database — the stub records every call
 * and returns canned rows. This covers:
 *   - backwards-compat: no `?window=` returns the legacy flat shape
 *   - `?window=today|7d|30d` returns `{ window, current, previous, delta, ... }`
 *   - invalid `?window=` values return 400
 *   - tenant_id and operating_entity_id flow through to every group's params
 *   - p95 < 500ms on this stubbed (no I/O) path
 */

function makeStubQuery(state) {
  return async function query(sql, params) {
    state.calls.push({ sql, params: params ? [...params] : [] });
    const trimmed = sql.replace(/\s+/g, ' ').trim();

    if (trimmed.startsWith("SELECT to_regclass('public.all_vehicles')")) {
      return { rows: [{ rel: 'all_vehicles' }] };
    }
    if (trimmed.startsWith("SELECT to_regclass('public.vehicles')")) {
      return { rows: [{ rel: 'vehicles' }] };
    }
    if (trimmed.startsWith("SELECT to_regclass(")) {
      return { rows: [{ rel: 'drivers' }] };  // hasDrivers/hasLoads/hasHosRecords
    }
    if (trimmed.startsWith("SELECT settings_json->>'timezone'")) {
      return { rows: [{ tz: 'America/Chicago' }] };
    }

    // Stat group queries — return whatever the test has queued up next, or
    // a uniform default keyed off the first column header in the SQL.
    if (state.queueByGroup && state.queueByGroup.length > 0) {
      return state.queueByGroup.shift();
    }

    if (sql.includes('"activeDrivers"')) return { rows: [{ activeDrivers: 1, totalDrivers: 1 }] };
    if (sql.includes('"activeVehicles"')) return { rows: [{ activeVehicles: 1, totalVehicles: 1, oosVehicles: 0, vehiclesNeedingMaintenance: 0 }] };
    if (sql.includes('"activeLoads"')) return { rows: [{ activeLoads: 1, pendingLoads: 0, completedLoadsToday: 0, loadsDispatched: 0, loadsInTransit: 0, loadsDelivered: 0, loadsCanceled: 0 }] };
    if (sql.includes('"billingPending"')) return { rows: [{ billingPending: 1, billingCanceled: 0, billingInvoiced: 0, billingFunded: 0, billingPaid: 0 }] };
    if (sql.includes('"hosViolations"')) return { rows: [{ hosViolations: 1, hosWarnings: 0 }] };
    if (sql.includes('"dqfComplianceRate"')) return { rows: [{ dqfComplianceRate: 95, expiredMedCerts: 0, upcomingMedCerts: 0, expiredCDLs: 0, clearinghouseIssues: 0 }] };

    return { rows: [{}] };
  };
}

function buildApp(state) {
  const shared = require('../index');
  shared.setDatabase({
    pool: null,
    query: makeStubQuery(state),
    getClient: async () => null,
    knex: () => ({ raw: async () => ({ rows: [] }) })
  });

  // Force a fresh require so the route picks up our injected query.
  const dashboardPath = require.resolve('./dashboard');
  delete require.cache[dashboardPath];
  const router = require('./dashboard');

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: req.headers['x-tenant-id'] || null,
      operatingEntityId: req.headers['x-oe-id'] || null
    };
    next();
  });
  app.use('/api/dashboard', router);
  return app;
}

function startServer(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, { method, path, headers }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) }
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/dashboard/stats — window param (FN-1333)', () => {
  let state;
  let server;

  before(async () => {
    state = { calls: [] };
    const app = buildApp(state);
    server = await startServer(app);
  });

  after(() => { if (server) server.close(); });

  it('returns the legacy flat shape when ?window is omitted (backwards compat)', async () => {
    state.calls.length = 0;
    const res = await request(server, {
      method: 'GET',
      path: '/api/dashboard/stats',
      headers: { 'x-tenant-id': 'tenant-1', 'x-oe-id': 'oe-1' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(typeof res.body, 'object');
    assert.strictEqual(res.body.activeDrivers, 1);
    assert.strictEqual(res.body.activeVehicles, 1);
    // Legacy shape: no current/previous/delta keys.
    assert.strictEqual(res.body.current, undefined);
    assert.strictEqual(res.body.previous, undefined);
    assert.strictEqual(res.body.delta, undefined);
    // Tenant + operating entity must be in params for every stat-group query.
    const groupCalls = state.calls.filter(c => c.sql.includes('"activeDrivers"')
      || c.sql.includes('"activeVehicles"') || c.sql.includes('"activeLoads"'));
    for (const c of groupCalls) {
      assert.strictEqual(c.params[0], 'tenant-1');
      assert.strictEqual(c.params[1], 'oe-1');
    }
  });

  it('returns {window, current, previous, delta} when ?window=today', async () => {
    state.calls.length = 0;
    const res = await request(server, {
      method: 'GET',
      path: '/api/dashboard/stats?window=today',
      headers: { 'x-tenant-id': 'tenant-1', 'x-oe-id': 'oe-1' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.window, 'today');
    assert.ok(res.body.timezone, 'timezone present');
    assert.ok(res.body.currentRange?.start && res.body.currentRange?.end);
    assert.ok(res.body.previousRange?.start && res.body.previousRange?.end);
    assert.strictEqual(res.body.previousRange.end, res.body.currentRange.start);
    assert.ok(res.body.current && res.body.previous && res.body.delta);
    // All numeric current keys produce a corresponding delta.
    for (const k of Object.keys(res.body.current)) {
      if (typeof res.body.current[k] === 'number') {
        assert.ok(k in res.body.delta, `delta missing key ${k}`);
      }
    }
  });

  it('?window=7d issues windowed queries with start/end params', async () => {
    state.calls.length = 0;
    const res = await request(server, {
      method: 'GET',
      path: '/api/dashboard/stats?window=7d',
      headers: { 'x-tenant-id': 'tenant-1', 'x-oe-id': 'oe-1' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.window, '7d');
    // Each stat-group call should have 4 params: [tenantId, oeId, startISO, endISO].
    const groupCalls = state.calls.filter(c => c.sql.includes('"activeDrivers"'));
    assert.ok(groupCalls.length >= 2, 'drivers group ran for current and previous');
    for (const c of groupCalls) {
      assert.strictEqual(c.params.length, 4);
      assert.strictEqual(c.params[0], 'tenant-1');
      assert.strictEqual(c.params[1], 'oe-1');
      assert.match(c.params[2], /^\d{4}-\d{2}-\d{2}T/);
      assert.match(c.params[3], /^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('?window=30d returns 200 with delta math', async () => {
    state.queueByGroup = [
      { rows: [{ activeDrivers: 10, totalDrivers: 12 }] },                                 // drivers current
      { rows: [{ activeVehicles: 5, totalVehicles: 7, oosVehicles: 1, vehiclesNeedingMaintenance: 2 }] }, // vehicles current
      { rows: [{ activeLoads: 4, pendingLoads: 1, completedLoadsToday: 3, loadsDispatched: 2, loadsInTransit: 1, loadsDelivered: 5, loadsCanceled: 0 }] }, // loads current
      { rows: [{ billingPending: 2, billingCanceled: 0, billingInvoiced: 1, billingFunded: 0, billingPaid: 3 }] }, // billing current
      { rows: [{ hosViolations: 1, hosWarnings: 2 }] },                                    // hos current
      { rows: [{ dqfComplianceRate: 95, expiredMedCerts: 0, upcomingMedCerts: 1, expiredCDLs: 0, clearinghouseIssues: 0 }] }, // compliance current
      { rows: [{ activeDrivers: 7, totalDrivers: 10 }] },                                  // drivers previous
      { rows: [{ activeVehicles: 5, totalVehicles: 6, oosVehicles: 0, vehiclesNeedingMaintenance: 1 }] }, // vehicles previous
      { rows: [{ activeLoads: 2, pendingLoads: 1, completedLoadsToday: 1, loadsDispatched: 1, loadsInTransit: 0, loadsDelivered: 3, loadsCanceled: 0 }] }, // loads previous
      { rows: [{ billingPending: 1, billingCanceled: 1, billingInvoiced: 0, billingFunded: 0, billingPaid: 1 }] }, // billing previous
      { rows: [{ hosViolations: 3, hosWarnings: 4 }] },                                    // hos previous
      { rows: [{ dqfComplianceRate: 90, expiredMedCerts: 1, upcomingMedCerts: 0, expiredCDLs: 0, clearinghouseIssues: 1 }] } // compliance previous
    ];
    const res = await request(server, {
      method: 'GET',
      path: '/api/dashboard/stats?window=30d',
      headers: { 'x-tenant-id': 'tenant-1', 'x-oe-id': 'oe-1' }
    });
    state.queueByGroup = null;

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.window, '30d');
    assert.strictEqual(res.body.current.activeDrivers, 10);
    assert.strictEqual(res.body.previous.activeDrivers, 7);
    assert.strictEqual(res.body.delta.activeDrivers, 3);
    assert.strictEqual(res.body.delta.hosViolations, -2);
    assert.strictEqual(res.body.delta.dqfComplianceRate, 5);
  });

  it('returns 400 on invalid ?window= value', async () => {
    const res = await request(server, {
      method: 'GET',
      path: '/api/dashboard/stats?window=14d',
      headers: { 'x-tenant-id': 'tenant-1', 'x-oe-id': 'oe-1' }
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Invalid window/);
  });

  it('looks up the operating-entity timezone (not server time)', async () => {
    state.calls.length = 0;
    const res = await request(server, {
      method: 'GET',
      path: '/api/dashboard/stats?window=today',
      headers: { 'x-tenant-id': 'tenant-1', 'x-oe-id': 'oe-chi' }
    });
    assert.strictEqual(res.status, 200);
    // Stub returns America/Chicago for the OE timezone lookup.
    assert.strictEqual(res.body.timezone, 'America/Chicago');
    // The lookup query must have been issued with the OE id.
    const tzCall = state.calls.find(c => c.sql.includes("settings_json->>'timezone'"));
    assert.ok(tzCall, 'timezone lookup ran');
    assert.strictEqual(tzCall.params[0], 'oe-chi');
  });

  it('responds in well under the 500ms p95 budget on the stubbed path', async () => {
    const samples = [];
    for (let i = 0; i < 30; i += 1) {
      const start = Date.now();
      const res = await request(server, {
        method: 'GET',
        path: '/api/dashboard/stats?window=7d',
        headers: { 'x-tenant-id': 'tenant-1', 'x-oe-id': 'oe-1' }
      });
      samples.push(Date.now() - start);
      assert.strictEqual(res.status, 200);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    // Stubbed path has zero I/O — this is a sanity bound, not the production target.
    assert.ok(p95 < 500, `p95 was ${p95}ms (budget 500ms)`);
  });
});
