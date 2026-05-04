'use strict';

/**
 * FN-1152: Tests for the gateway-local /api/insights/trends route, the
 * trend-aggregator service, and trend-cache. Runs standalone with `node`:
 *
 *   node backend/gateway/__tests__/insights.test.js
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const { buildTrendCache } = require('../services/trend-cache');
const {
  buildTrendAggregator,
  _internals
} = require('../services/trend-aggregator');
const { buildInsightsRouter } = require('../routes/insights');

const JWT_SECRET = 'test_secret';
const TENANT_ID = 'tenant-abc';

// Fixed reference date so tests are deterministic across runs.
// Choose a date with a clean 7-day window that spans easily.
const FIXED_NOW = new Date(Date.UTC(2026, 4, 7, 12, 0, 0)); // 2026-05-07T12:00:00Z

function fixedNow() {
  return new Date(FIXED_NOW.getTime());
}

function makeFakeKnex(handlers) {
  const calls = [];
  async function raw(sql, bindings) {
    calls.push({ sql, bindings });
    for (const h of handlers) {
      if (h.match.test(sql)) {
        return { rows: await h.respond(bindings, sql) };
      }
    }
    throw new Error(`fake knex.raw: no handler matched sql:\n${sql}`);
  }
  return { raw, calls };
}

function startGatewayUnderTest(aggregator) {
  const app = express();
  app.use('/api/insights', buildInsightsRouter({ aggregator, jwtSecret: JWT_SECRET }));
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { method: 'GET', headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function tokenFor(claims) {
  return jwt.sign(claims, JWT_SECRET);
}

// ── unit tests for internal helpers ──────────────────────────────────────────

async function testWindowBuilders() {
  const past = _internals.buildPastWindow(FIXED_NOW, 7);
  assert.equal(past.length, 7, 'past window: 7 days');
  assert.equal(past[6], '2026-05-07', 'past window: ends today UTC');
  assert.equal(past[0], '2026-05-01', 'past window: starts 6 days before today');

  const future = _internals.buildFutureWindow(FIXED_NOW, 7);
  assert.equal(future.length, 7, 'future window: 7 days');
  assert.equal(future[0], '2026-05-08', 'future window: starts tomorrow');
  assert.equal(future[6], '2026-05-14', 'future window: ends 7 days after today');
}

async function testFillSeriesByDay() {
  const days = ['2026-05-01', '2026-05-02', '2026-05-03'];
  const rows = [
    { day: '2026-05-01', count: 5 },
    { day: '2026-05-03', count: 9 }
  ];
  const filled = _internals.fillSeriesByDay(rows, days, 'count');
  assert.deepEqual(
    filled,
    [
      { date: '2026-05-01', value: 5 },
      { date: '2026-05-02', value: null },
      { date: '2026-05-03', value: 9 }
    ],
    'fillSeriesByDay: missing days become null'
  );
}

async function testLinearForecast() {
  const days = ['2026-05-01', '2026-05-02', '2026-05-03'];
  const future = ['2026-05-04', '2026-05-05'];

  // Insufficient data → all null predicted
  const sparse = _internals.linearForecast(
    days.map((d) => ({ date: d, value: null })),
    future
  );
  assert.deepEqual(
    sparse.map((p) => p.value),
    [null, null],
    'linearForecast: <2 points → null forecast'
  );

  // Linear trend → forecast continues the trend
  const linear = _internals.linearForecast(
    [
      { date: '2026-05-01', value: 1 },
      { date: '2026-05-02', value: 2 },
      { date: '2026-05-03', value: 3 }
    ],
    future
  );
  assert.equal(Math.round(linear[0].value), 4, 'linearForecast: next point ≈ 4');
  assert.equal(Math.round(linear[1].value), 5, 'linearForecast: following ≈ 5');

  // Flat trend with denom=0 collapses to average
  const flat = _internals.linearForecast(
    [{ date: '2026-05-01', value: 7 }, { date: '2026-05-02', value: 7 }],
    future
  );
  assert.ok(
    flat.every((p) => Math.round(p.value) === 7),
    'linearForecast: flat trend → flat forecast'
  );
}

// ── cache tests ──────────────────────────────────────────────────────────────

async function testCacheTtl() {
  let t = 1000;
  const cache = buildTrendCache({ ttlMs: 100, now: () => t });
  cache.set('tenant-a', '7d', { hello: 'world' });
  assert.deepEqual(cache.get('tenant-a', '7d'), { hello: 'world' }, 'cache: hit');

  t = 1099;
  assert.deepEqual(cache.get('tenant-a', '7d'), { hello: 'world' }, 'cache: still fresh');

  t = 1101;
  assert.equal(cache.get('tenant-a', '7d'), null, 'cache: expired beyond ttl');

  cache.set('tenant-a', '7d', { x: 1 });
  cache.invalidate('tenant-a', '7d');
  assert.equal(cache.get('tenant-a', '7d'), null, 'cache: invalidate clears entry');

  // Tenant isolation
  cache.set('tenant-a', '7d', { which: 'a' });
  cache.set('tenant-b', '7d', { which: 'b' });
  assert.equal(cache.get('tenant-a', '7d').which, 'a', 'cache: tenant-a isolated');
  assert.equal(cache.get('tenant-b', '7d').which, 'b', 'cache: tenant-b isolated');
}

// ── HTTP integration tests ───────────────────────────────────────────────────

function fullFixtureKnex() {
  return makeFakeKnex([
    {
      match: /FROM loads\b[^\)]*completed_date IS NOT NULL/i,
      respond: () => [
        { day: '2026-05-01', count: 1 },
        { day: '2026-05-02', count: 2 },
        { day: '2026-05-03', count: 3 },
        { day: '2026-05-04', count: 4 },
        { day: '2026-05-05', count: 5 },
        { day: '2026-05-06', count: 6 },
        { day: '2026-05-07', count: 7 }
      ]
    },
    {
      match: /FROM work_orders/i,
      respond: () => [
        { day: '2026-05-03', count: 1 },
        { day: '2026-05-05', count: 2 }
      ]
    },
    {
      match: /FROM loads l\s+LEFT JOIN/i,
      respond: () => [
        { day: '2026-05-01', total: 4, on_time: 4 },
        { day: '2026-05-04', total: 5, on_time: 4 },
        { day: '2026-05-07', total: 2, on_time: 1 }
      ]
    },
    {
      match: /FROM fuel_transactions/i,
      respond: () => [
        { day: '2026-05-02', total: 200.5 },
        { day: '2026-05-05', total: 415.0 }
      ]
    }
  ]);
}

async function testUnauthorized() {
  const cache = buildTrendCache({ now: () => Date.now() });
  const knex = fullFixtureKnex();
  const aggregator = buildTrendAggregator({ knex, cache, now: fixedNow });
  const server = await startGatewayUnderTest(aggregator);
  try {
    const noToken = await getJson(`${server.baseUrl}/api/insights/trends`);
    assert.equal(noToken.status, 401, 'no token → 401');

    const badToken = await getJson(`${server.baseUrl}/api/insights/trends`, {
      Authorization: 'Bearer not-a-real-token'
    });
    assert.equal(badToken.status, 401, 'invalid token → 401');

    const noTenant = jwt.sign({ sub: 'u1' }, JWT_SECRET);
    const r = await getJson(`${server.baseUrl}/api/insights/trends`, {
      Authorization: `Bearer ${noTenant}`
    });
    assert.equal(r.status, 401, 'token without tenant_id → 401');

    assert.equal(knex.calls.length, 0, 'unauthorized requests never query DB');
  } finally {
    await server.close();
  }
}

async function testHappyPath() {
  const cache = buildTrendCache({ now: () => Date.now() });
  const knex = fullFixtureKnex();
  const aggregator = buildTrendAggregator({ knex, cache, now: fixedNow });
  const server = await startGatewayUnderTest(aggregator);
  try {
    const token = tokenFor({ sub: 'u1', tenant_id: TENANT_ID });
    const { status, body } = await getJson(`${server.baseUrl}/api/insights/trends?range=7d`, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(status, 200, 'happy path: 200');
    assert.equal(body.tenantId, TENANT_ID, 'tenantId echoed');
    assert.equal(body.range, '7d', 'range echoed');
    assert.equal(body.cached, false, 'cold call → not cached');
    assert.equal(body.upstreamErrors.length, 0, 'no upstream errors');

    const { series, window } = body;
    assert.equal(window.actualDays.length, 7, 'actualDays length');
    assert.equal(window.actualDays[6], '2026-05-07', 'actualDays ends today');
    assert.equal(window.futureDays.length, 7, 'futureDays length');

    // loadVolume actuals match fixture (1..7), predicted continues the trend
    assert.deepEqual(
      series.loadVolume.actual.map((p) => p.value),
      [1, 2, 3, 4, 5, 6, 7],
      'loadVolume actuals'
    );
    assert.equal(series.loadVolume.predicted.length, 7, 'loadVolume predicted len');
    assert.ok(
      series.loadVolume.predicted[0].value > 7,
      'loadVolume predicted: trend continues upward'
    );

    // maintenance: only 2 days have data → others null
    assert.equal(
      series.maintenance.actual.filter((p) => p.value === null).length,
      5,
      'maintenance: 5 missing days are null'
    );

    // onTimePct: derived as on_time/total*100, sparse days null
    const otValues = series.onTimePct.actual.map((p) => p.value);
    assert.equal(otValues[0], 100, 'on-time day 1: 4/4 = 100%');
    assert.equal(otValues[3], 80, 'on-time day 4: 4/5 = 80%');
    assert.equal(otValues[6], 50, 'on-time day 7: 1/2 = 50%');
    assert.equal(otValues[1], null, 'on-time day 2: no data → null');

    // fuelCost: only days 2 and 5 have data
    const fcValues = series.fuelCost.actual.map((p) => p.value);
    assert.equal(fcValues[1], 200.5, 'fuel day 2');
    assert.equal(fcValues[4], 415.0, 'fuel day 5');
    assert.equal(fcValues[0], null, 'fuel day 1: no data');
  } finally {
    await server.close();
  }
}

async function testCacheServesSecondCall() {
  const cache = buildTrendCache({ now: () => Date.now() });
  const knex = fullFixtureKnex();
  const aggregator = buildTrendAggregator({ knex, cache, now: fixedNow });
  const server = await startGatewayUnderTest(aggregator);
  try {
    const token = tokenFor({ sub: 'u1', tenant_id: TENANT_ID });
    const headers = { Authorization: `Bearer ${token}` };

    const first = await getJson(`${server.baseUrl}/api/insights/trends`, headers);
    assert.equal(first.body.cached, false, 'first call: cold');
    const callsAfterFirst = knex.calls.length;
    assert.equal(callsAfterFirst, 4, 'first call: 4 db queries (one per series)');

    const second = await getJson(`${server.baseUrl}/api/insights/trends`, headers);
    assert.equal(second.body.cached, true, 'second call: cache hit');
    assert.equal(knex.calls.length, callsAfterFirst, 'second call: no new queries');

    const refreshed = await getJson(
      `${server.baseUrl}/api/insights/trends?refresh=true`,
      headers
    );
    assert.equal(refreshed.body.cached, false, 'refresh=true bypasses cache');
    assert.equal(
      knex.calls.length,
      callsAfterFirst * 2,
      'refresh=true: re-runs 4 queries'
    );
  } finally {
    await server.close();
  }
}

async function testTenantIsolation() {
  const cache = buildTrendCache({ now: () => Date.now() });
  const knex = fullFixtureKnex();
  const aggregator = buildTrendAggregator({ knex, cache, now: fixedNow });
  const server = await startGatewayUnderTest(aggregator);
  try {
    const tokenA = tokenFor({ sub: 'u1', tenant_id: 'tenant-a' });
    const tokenB = tokenFor({ sub: 'u2', tenant_id: 'tenant-b' });

    const a = await getJson(`${server.baseUrl}/api/insights/trends`, {
      Authorization: `Bearer ${tokenA}`
    });
    const b = await getJson(`${server.baseUrl}/api/insights/trends`, {
      Authorization: `Bearer ${tokenB}`
    });

    assert.equal(a.body.tenantId, 'tenant-a', 'A tenant');
    assert.equal(b.body.tenantId, 'tenant-b', 'B tenant');
    assert.equal(a.body.cached, false, 'A: cold');
    assert.equal(b.body.cached, false, 'B: cold (separate cache key)');

    // Verify tenant_id was the first binding on every query
    const tenantBindings = knex.calls.map((c) => c.bindings[0]);
    const aBindings = tenantBindings.slice(0, 4);
    const bBindings = tenantBindings.slice(4, 8);
    assert.ok(
      aBindings.every((t) => t === 'tenant-a'),
      'first 4 queries scoped to tenant-a'
    );
    assert.ok(
      bBindings.every((t) => t === 'tenant-b'),
      'next 4 queries scoped to tenant-b'
    );
  } finally {
    await server.close();
  }
}

async function testSparseTenantNoErrors() {
  const cache = buildTrendCache({ now: () => Date.now() });
  // every query returns no rows — the "new tenant" case
  const knex = makeFakeKnex([
    { match: /.*/i, respond: () => [] }
  ]);
  const aggregator = buildTrendAggregator({ knex, cache, now: fixedNow });
  const server = await startGatewayUnderTest(aggregator);
  try {
    const token = tokenFor({ sub: 'u1', tenant_id: TENANT_ID });
    const { status, body } = await getJson(`${server.baseUrl}/api/insights/trends`, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(status, 200, 'sparse: still 200');
    assert.equal(body.upstreamErrors.length, 0, 'sparse: no errors');
    for (const seriesName of ['loadVolume', 'maintenance', 'onTimePct', 'fuelCost']) {
      const s = body.series[seriesName];
      assert.equal(s.actual.length, 7, `${seriesName}: actual length 7`);
      assert.equal(s.predicted.length, 7, `${seriesName}: predicted length 7`);
      assert.ok(
        s.actual.every((p) => p.value === null),
        `${seriesName}: all actual values null`
      );
      assert.ok(
        s.predicted.every((p) => p.value === null),
        `${seriesName}: all predicted values null (insufficient data)`
      );
    }
  } finally {
    await server.close();
  }
}

async function testSeriesQueryFailureIsolated() {
  const cache = buildTrendCache({ now: () => Date.now() });
  const knex = makeFakeKnex([
    {
      match: /FROM loads\b[^\)]*completed_date IS NOT NULL/i,
      respond: () => [{ day: '2026-05-07', count: 3 }]
    },
    {
      match: /FROM work_orders/i,
      respond: () => {
        throw new Error('work_orders table missing');
      }
    },
    {
      match: /FROM loads l\s+LEFT JOIN/i,
      respond: () => []
    },
    {
      match: /FROM fuel_transactions/i,
      respond: () => [{ day: '2026-05-07', total: 12.5 }]
    }
  ]);
  const aggregator = buildTrendAggregator({ knex, cache, now: fixedNow });
  const server = await startGatewayUnderTest(aggregator);
  try {
    const token = tokenFor({ sub: 'u1', tenant_id: TENANT_ID });
    const { status, body } = await getJson(`${server.baseUrl}/api/insights/trends`, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(status, 200, 'series failure: still 200 overall');
    assert.equal(body.upstreamErrors.length, 1, 'one failed series tracked');
    assert.equal(body.upstreamErrors[0].source, 'maintenance', 'failed source: maintenance');
    assert.ok(
      body.series.maintenance.actual.every((p) => p.value === null),
      'maintenance series: all null on query failure'
    );
    assert.ok(
      body.series.loadVolume.actual.some((p) => p.value === 3),
      'loadVolume series still populated'
    );
    assert.ok(
      body.series.fuelCost.actual.some((p) => p.value === 12.5),
      'fuelCost series still populated'
    );
  } finally {
    await server.close();
  }
}

async function testUnsupportedRange() {
  const cache = buildTrendCache({ now: () => Date.now() });
  const knex = fullFixtureKnex();
  const aggregator = buildTrendAggregator({ knex, cache, now: fixedNow });
  const server = await startGatewayUnderTest(aggregator);
  try {
    const token = tokenFor({ sub: 'u1', tenant_id: TENANT_ID });
    const { status, body } = await getJson(
      `${server.baseUrl}/api/insights/trends?range=30d`,
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(status, 400, 'unsupported range → 400');
    assert.match(body.error, /Unsupported range/i, 'unsupported range error message');
    assert.equal(knex.calls.length, 0, 'unsupported range never reaches DB');
  } finally {
    await server.close();
  }
}

(async () => {
  const cases = [
    ['window builders', testWindowBuilders],
    ['fillSeriesByDay', testFillSeriesByDay],
    ['linearForecast', testLinearForecast],
    ['cache TTL + invalidate + isolation', testCacheTtl],
    ['unauthorized', testUnauthorized],
    ['happy path', testHappyPath],
    ['cache serves second call, refresh bypasses', testCacheServesSecondCall],
    ['tenant isolation', testTenantIsolation],
    ['sparse tenant returns nulls, not errors', testSparseTenantNoErrors],
    ['per-series failure isolated to one series', testSeriesQueryFailureIsolated],
    ['unsupported range rejected', testUnsupportedRange]
  ];
  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      await fn();
      // eslint-disable-next-line no-console
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(`FAIL  ${name}\n${err && err.stack ? err.stack : err}`);
    }
  }
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll ${cases.length} test(s) passed.`);
})();
