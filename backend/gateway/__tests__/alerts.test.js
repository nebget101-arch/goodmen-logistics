'use strict';

/**
 * FN-1161: Tests for the gateway-local Smart Alerts route + aggregator +
 * dismissals store + WS broadcaster. Runs standalone with `node` — no jest.
 *
 *   node backend/gateway/__tests__/alerts.test.js
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const { buildSmartAlertsAggregator } = require('../services/smart-alerts-aggregator');
const { MemoryDismissalsStore } = require('../services/dismissals-store');
const { buildAlertsBroadcaster, EVENT_UPDATE, EVENT_DISMISSED } = require('../services/alerts-ws');
const { buildAlertsRouter } = require('../routes/alerts');

const JWT_SECRET = 'test_secret';
const TENANT_ID = 'tenant-abc';
const USER_ID = 'user-1';

function makeUpstreamResponse(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

function makeFakeFetcher(routeMap) {
  let callCount = 0;
  const calls = [];
  async function fetcher(url, opts) {
    callCount += 1;
    calls.push({ url, opts });
    for (const [pattern, handler] of routeMap) {
      if (url.startsWith(pattern)) {
        return handler(url, opts);
      }
    }
    throw new Error(`fake fetcher: no route for ${url}`);
  }
  fetcher.calls = calls;
  Object.defineProperty(fetcher, 'callCount', { get: () => callCount });
  return fetcher;
}

function buildAggregatorForTest(fetcher) {
  return buildSmartAlertsAggregator({
    fetcher,
    driversUrl: 'http://drivers.test',
    vehiclesUrl: 'http://vehicles.test',
    logisticsUrl: 'http://logistics.test',
    aiUrl: 'http://ai.test',
    upstreamTimeoutMs: 1000,
    aiTimeoutMs: 1500
  });
}

function makeFakeBroadcaster() {
  const events = [];
  const broadcaster = buildAlertsBroadcaster({
    emit: ({ tenantId, event, payload }) => {
      events.push({ tenantId, event, payload });
      return { delivered: true };
    }
  });
  broadcaster._events = events;
  return broadcaster;
}

function startGatewayUnderTest({ aggregator, dismissalsStore, broadcaster }) {
  const app = express();
  app.use(
    '/api/alerts',
    buildAlertsRouter({
      aggregator,
      dismissalsStore,
      broadcaster,
      jwtSecret: JWT_SECRET
    })
  );
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
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body == null ? undefined : JSON.stringify(body)
  });
  let respBody = null;
  try { respBody = await res.json(); } catch { respBody = null; }
  return { status: res.status, body: respBody };
}

function tokenFor(claims) {
  return jwt.sign(claims, JWT_SECRET);
}

const HOS_FIXTURE = [
  { driverId: 'drv-1', driverName: 'Alice', minutesRemaining: 5, windowEndsAt: '2026-05-04T20:00:00Z' }
];
const FATIGUE_FIXTURE = [
  { driverId: 'drv-2', driverName: 'Bob', fatigueScore: 82 }
];
const INSPECTION_FIXTURE = [
  { vehicleId: 'veh-1', unit: '101', daysOverdue: 7, inspectionType: 'annual' }
];
const LATE_LOAD_FIXTURE = [
  { loadId: 'load-1', loadNumber: 'L-9001', etaDelta: 90, destination: 'Dallas, TX' }
];

const HAPPY_PATH_ROUTES = () => [
  ['http://drivers.test/api/hos/violations/imminent', () => makeUpstreamResponse(HOS_FIXTURE)],
  ['http://drivers.test/api/drivers/fatigue/top', () => makeUpstreamResponse(FATIGUE_FIXTURE)],
  ['http://vehicles.test/api/vehicles/inspections/overdue', () => makeUpstreamResponse(INSPECTION_FIXTURE)],
  ['http://logistics.test/api/loads/late-risk', () => makeUpstreamResponse(LATE_LOAD_FIXTURE)],
  // ai-service /score-alert returns deterministic severity per type to test ranking
  ['http://ai.test/api/ai/score-alert', (_url, opts) => {
    const body = JSON.parse(opts.body);
    const sev = {
      hos_imminent: 95,
      fatigue: 70,
      inspection_overdue: 80,
      late_load_risk: 50
    }[body.alert.type] ?? 50;
    return makeUpstreamResponse({ severity: sev, reasoning: `t=${body.alert.type}`, action: { kind: 'view', subjectId: body.alert.subjectId } });
  }]
];

async function testUnauthorized() {
  const fetcher = makeFakeFetcher([]);
  const aggregator = buildAggregatorForTest(fetcher);
  const dismissalsStore = new MemoryDismissalsStore();
  const broadcaster = makeFakeBroadcaster();
  const server = await startGatewayUnderTest({ aggregator, dismissalsStore, broadcaster });
  try {
    const noToken = await getJson(`${server.baseUrl}/api/alerts/smart`);
    assert.equal(noToken.status, 401, 'no token => 401');

    const badToken = await getJson(`${server.baseUrl}/api/alerts/smart`, {
      Authorization: 'Bearer not-a-real-token'
    });
    assert.equal(badToken.status, 401, 'invalid token => 401');

    const tokenWithoutTenant = jwt.sign({ sub: 'user-1' }, JWT_SECRET);
    const noTenant = await getJson(`${server.baseUrl}/api/alerts/smart`, {
      Authorization: `Bearer ${tokenWithoutTenant}`
    });
    assert.equal(noTenant.status, 401, 'token without tenant_id => 401');

    const tokenWithoutUser = jwt.sign({ tenant_id: TENANT_ID }, JWT_SECRET);
    const noUser = await getJson(`${server.baseUrl}/api/alerts/smart`, {
      Authorization: `Bearer ${tokenWithoutUser}`
    });
    assert.equal(noUser.status, 401, 'token without sub => 401');

    assert.equal(fetcher.callCount, 0, 'unauthorized requests never fan out');
  } finally {
    await server.close();
  }
}

async function testHappyPathRanking() {
  const fetcher = makeFakeFetcher(HAPPY_PATH_ROUTES());
  const aggregator = buildAggregatorForTest(fetcher);
  const dismissalsStore = new MemoryDismissalsStore();
  const broadcaster = makeFakeBroadcaster();
  const server = await startGatewayUnderTest({ aggregator, dismissalsStore, broadcaster });
  try {
    const token = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const { status, body } = await getJson(`${server.baseUrl}/api/alerts/smart`, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(status, 200);
    assert.equal(body.tenantId, TENANT_ID);
    assert.deepEqual(body.upstreamErrors, []);
    assert.equal(body.alerts.length, 4, 'all four signals returned');
    // Highest-severity first: hos(95) > inspection(80) > fatigue(70) > late_load(50)
    assert.deepEqual(
      body.alerts.map((a) => a.type),
      ['hos_imminent', 'inspection_overdue', 'fatigue', 'late_load_risk'],
      'ranked by severity desc'
    );
    body.alerts.forEach((a) => {
      assert.equal(a.scoredBy, 'ai', 'alerts scored by ai when /score-alert succeeds');
      assert.ok(a.action, 'action surfaced from ai-service');
    });

    // Broadcaster fired with the ranked list
    const update = broadcaster._events.find((e) => e.event === EVENT_UPDATE);
    assert.ok(update, 'alerts.smart.update broadcast happened');
    assert.equal(update.tenantId, TENANT_ID);
    assert.equal(update.payload.alerts.length, 4);
  } finally {
    await server.close();
  }
}

async function testPartialUpstreamFailure() {
  const fetcher = makeFakeFetcher([
    ['http://drivers.test/api/hos/violations/imminent', () => makeUpstreamResponse(HOS_FIXTURE)],
    ['http://drivers.test/api/drivers/fatigue/top', () => { throw new Error('fatigue down'); }],
    ['http://vehicles.test/api/vehicles/inspections/overdue', () => makeUpstreamResponse(null, false, 503)],
    ['http://logistics.test/api/loads/late-risk', () => makeUpstreamResponse(LATE_LOAD_FIXTURE)],
    ['http://ai.test/api/ai/score-alert', (_u, opts) => {
      const body = JSON.parse(opts.body);
      return makeUpstreamResponse({ severity: body.alert.type === 'hos_imminent' ? 90 : 40 });
    }]
  ]);
  const aggregator = buildAggregatorForTest(fetcher);
  const dismissalsStore = new MemoryDismissalsStore();
  const broadcaster = makeFakeBroadcaster();
  const server = await startGatewayUnderTest({ aggregator, dismissalsStore, broadcaster });
  try {
    const token = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const { status, body } = await getJson(`${server.baseUrl}/api/alerts/smart`, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(status, 200, 'partial failure: still 200');
    assert.equal(body.alerts.length, 2, 'only successful sources contribute alerts');
    const sources = body.upstreamErrors.map((e) => e.source).sort();
    assert.deepEqual(sources, ['fatigue', 'inspectionsOverdue'], 'failed sources tracked');
    assert.deepEqual(
      body.alerts.map((a) => a.type),
      ['hos_imminent', 'late_load_risk'],
      'remaining alerts ranked by severity'
    );
  } finally {
    await server.close();
  }
}

async function testAiScoringFallback() {
  const fetcher = makeFakeFetcher([
    ['http://drivers.test/api/hos/violations/imminent', () => makeUpstreamResponse(HOS_FIXTURE)],
    ['http://drivers.test/api/drivers/fatigue/top', () => makeUpstreamResponse([])],
    ['http://vehicles.test/api/vehicles/inspections/overdue', () => makeUpstreamResponse([])],
    ['http://logistics.test/api/loads/late-risk', () => makeUpstreamResponse(LATE_LOAD_FIXTURE)],
    ['http://ai.test/api/ai/score-alert', () => { throw new Error('ai service down'); }]
  ]);
  const aggregator = buildAggregatorForTest(fetcher);
  const dismissalsStore = new MemoryDismissalsStore();
  const broadcaster = makeFakeBroadcaster();
  const server = await startGatewayUnderTest({ aggregator, dismissalsStore, broadcaster });
  try {
    const token = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const { status, body } = await getJson(`${server.baseUrl}/api/alerts/smart`, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(status, 200);
    assert.equal(body.alerts.length, 2);
    body.alerts.forEach((a) => {
      assert.equal(a.scoredBy, 'fallback:ai-error', 'falls back when ai-service errors');
      assert.ok(a.severity > 0, 'fallback severity > 0');
    });
    // hos_imminent fallback is 75, late_load_risk fallback is 55 → hos first
    assert.deepEqual(body.alerts.map((a) => a.type), ['hos_imminent', 'late_load_risk']);
  } finally {
    await server.close();
  }
}

async function testDismissalFlow() {
  const fetcher = makeFakeFetcher(HAPPY_PATH_ROUTES());
  const aggregator = buildAggregatorForTest(fetcher);
  const dismissalsStore = new MemoryDismissalsStore({ ttlMs: 60_000 });
  const broadcaster = makeFakeBroadcaster();
  const server = await startGatewayUnderTest({ aggregator, dismissalsStore, broadcaster });
  try {
    const token = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const headers = { Authorization: `Bearer ${token}` };

    const before = await getJson(`${server.baseUrl}/api/alerts/smart`, headers);
    assert.equal(before.body.alerts.length, 4, 'all 4 alerts visible initially');
    const top = before.body.alerts[0];
    assert.equal(top.type, 'hos_imminent');

    const dismiss = await postJson(
      `${server.baseUrl}/api/alerts/smart/${encodeURIComponent(top.id)}/dismiss`,
      {},
      headers
    );
    assert.equal(dismiss.status, 200);
    assert.equal(dismiss.body.dismissed, true);
    assert.equal(dismiss.body.alertId, top.id);

    // Dismissal broadcast emitted with correct payload shape
    const dEvent = broadcaster._events.find((e) => e.event === EVENT_DISMISSED);
    assert.ok(dEvent, 'alerts.smart.dismissed broadcast');
    assert.equal(dEvent.payload.alertId, top.id);
    assert.equal(dEvent.payload.userId, USER_ID);

    const after = await getJson(`${server.baseUrl}/api/alerts/smart`, headers);
    assert.equal(after.body.alerts.length, 3, 'dismissed alert is filtered out');
    assert.ok(!after.body.alerts.some((a) => a.id === top.id), 'dismissed alert no longer surfaced');

    // Re-aggregate from a different tenant — dismissal must NOT cross tenants
    const otherToken = tokenFor({ sub: USER_ID, tenant_id: 'tenant-other' });
    const otherFetcher = makeFakeFetcher(HAPPY_PATH_ROUTES());
    const otherAggregator = buildAggregatorForTest(otherFetcher);
    const otherServer = await startGatewayUnderTest({
      aggregator: otherAggregator,
      dismissalsStore,
      broadcaster
    });
    try {
      const otherResult = await getJson(`${otherServer.baseUrl}/api/alerts/smart`, {
        Authorization: `Bearer ${otherToken}`
      });
      assert.equal(otherResult.body.alerts.length, 4, 'other tenant sees all 4 alerts');
    } finally {
      await otherServer.close();
    }
  } finally {
    await server.close();
  }
}

async function testDismissalTtlExpiry() {
  let now = 1_000_000;
  const store = new MemoryDismissalsStore({ ttlMs: 60_000, now: () => now });
  await store.dismiss({ tenantId: TENANT_ID, userId: USER_ID, alertId: 'a' });
  assert.equal(await store.isDismissed({ tenantId: TENANT_ID, userId: USER_ID, alertId: 'a' }), true);
  now += 30_000;
  assert.equal(await store.isDismissed({ tenantId: TENANT_ID, userId: USER_ID, alertId: 'a' }), true);
  now += 31_000;
  assert.equal(
    await store.isDismissed({ tenantId: TENANT_ID, userId: USER_ID, alertId: 'a' }),
    false,
    'dismissal expires after ttl'
  );
}

async function testDismissalRequiresAlertId() {
  const fetcher = makeFakeFetcher(HAPPY_PATH_ROUTES());
  const aggregator = buildAggregatorForTest(fetcher);
  const dismissalsStore = new MemoryDismissalsStore();
  const broadcaster = makeFakeBroadcaster();
  const server = await startGatewayUnderTest({ aggregator, dismissalsStore, broadcaster });
  try {
    const token = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const headers = { Authorization: `Bearer ${token}` };

    // Whitespace-only alert id is rejected; empty path id matches the GET
    // route so we can't easily test that here, but the trim guard is covered
    // by hitting the route with a single space.
    const r = await postJson(
      `${server.baseUrl}/api/alerts/smart/%20/dismiss`,
      {},
      headers
    );
    assert.equal(r.status, 400, 'whitespace id rejected');
  } finally {
    await server.close();
  }
}

(async () => {
  const cases = [
    ['unauthorized', testUnauthorized],
    ['happy path ranking', testHappyPathRanking],
    ['partial upstream failure', testPartialUpstreamFailure],
    ['ai scoring fallback', testAiScoringFallback],
    ['dismissal flow + tenant isolation', testDismissalFlow],
    ['dismissal ttl expiry', testDismissalTtlExpiry],
    ['dismissal requires alert id', testDismissalRequiresAlertId]
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
