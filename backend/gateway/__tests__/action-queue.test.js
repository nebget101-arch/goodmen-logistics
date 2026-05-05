'use strict';

/**
 * FN-1330: Tests for the gateway-local Action Queue route + grouper +
 * compliance-alerts client. Runs standalone with `node` — no jest.
 *
 *   node backend/gateway/__tests__/action-queue.test.js
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const { buildSmartAlertsAggregator } = require('../services/smart-alerts-aggregator');
const { MemoryDismissalsStore } = require('../services/dismissals-store');
const { buildAlertGrouper } = require('../services/alert-grouper');
const { buildComplianceAlertsClient } = require('../services/compliance-alerts-client');
const { buildActionQueueRouter } = require('../routes/action-queue');

const JWT_SECRET = 'test_secret';
const TENANT_ID = 'tenant-abc';
const USER_ID = 'user-1';

function ok(payload, status = 200) {
  return { ok: true, status, json: async () => payload };
}
function notOk(status = 500) {
  return { ok: false, status, json: async () => ({ error: 'upstream broken' }) };
}

function makeFakeFetcher(routeMap) {
  const calls = [];
  async function fetcher(url, opts) {
    calls.push({ url, opts });
    for (const [pattern, handler] of routeMap) {
      if (url.startsWith(pattern)) return handler(url, opts);
    }
    throw new Error(`fake fetcher: no route for ${url}`);
  }
  fetcher.calls = calls;
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

function startServer({ aggregator, complianceAlertsClient, dismissalsStore, grouper }) {
  const app = express();
  app.use(
    '/api/dashboard/action-queue',
    buildActionQueueRouter({
      smartAlertsAggregator: aggregator,
      complianceAlertsClient,
      alertGrouper: grouper || buildAlertGrouper(),
      dismissalsStore,
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

function tokenFor(claims) { return jwt.sign(claims, JWT_SECRET); }

const HOS_FIXTURE = [
  { driverId: 'drv-1', driverName: 'Alice', minutesRemaining: 5, windowEndsAt: '2026-05-04T20:00:00Z' }
];
const COMPLIANCE_FIXTURE = [
  { type: 'critical', category: 'maintenance', message: 'Unit-101 preventive maintenance is overdue', vehicleId: 'veh-1' },
  { type: 'critical', category: 'maintenance', message: 'Unit-102 preventive maintenance is overdue', vehicleId: 'veh-2' },
  { type: 'critical', category: 'maintenance', message: 'Unit-103 preventive maintenance is overdue', vehicleId: 'veh-3' },
  { type: 'warning', category: 'driver', message: "Bob Smith's medical certificate expires soon", driverId: 'drv-99' }
];

const DEFAULT_ROUTES = () => [
  ['http://drivers.test/api/hos/violations/imminent', () => ok(HOS_FIXTURE)],
  ['http://drivers.test/api/drivers/fatigue/top', () => ok([])],
  ['http://vehicles.test/api/vehicles/inspections/overdue', () => ok([])],
  ['http://logistics.test/api/loads/late-risk', () => ok([])],
  ['http://ai.test/api/ai/score-alert', (_u, opts) => {
    const body = JSON.parse(opts.body);
    return ok({ severity: body.alert.type === 'hos_imminent' ? 95 : 50 });
  }],
  ['http://reporting.test/api/dashboard/alerts', () => ok(COMPLIANCE_FIXTURE)]
];

function buildClientForTest(fetcher) {
  return buildComplianceAlertsClient({ fetcher, reportingUrl: 'http://reporting.test', timeoutMs: 1000 });
}

async function testUnauthorized() {
  const fetcher = makeFakeFetcher([]);
  const aggregator = buildAggregatorForTest(fetcher);
  const client = buildClientForTest(fetcher);
  const store = new MemoryDismissalsStore();
  const server = await startServer({ aggregator, complianceAlertsClient: client, dismissalsStore: store });
  try {
    const noToken = await getJson(`${server.baseUrl}/api/dashboard/action-queue`);
    assert.equal(noToken.status, 401);
    const badToken = await getJson(`${server.baseUrl}/api/dashboard/action-queue`, { Authorization: 'Bearer bogus' });
    assert.equal(badToken.status, 401);
    assert.equal(fetcher.calls.length, 0, 'no upstream calls when unauthorized');
  } finally { await server.close(); }
}

async function testHappyPathGrouping() {
  const fetcher = makeFakeFetcher(DEFAULT_ROUTES());
  const aggregator = buildAggregatorForTest(fetcher);
  const client = buildClientForTest(fetcher);
  const store = new MemoryDismissalsStore();
  const server = await startServer({ aggregator, complianceAlertsClient: client, dismissalsStore: store });
  try {
    const token = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const { status, body } = await getJson(`${server.baseUrl}/api/dashboard/action-queue?window=30d&severity=all`, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(status, 200);
    assert.equal(body.window, '30d');
    assert.equal(body.severity, 'all');
    // Expect 3 distinct groups: smart hos_imminent (1 alert), compliance pm_overdue (3 vehicles), compliance medical_cert_expiring (1 driver)
    assert.equal(body.total, 3);
    const ids = body.groups.map((g) => g.id).sort();
    assert.deepEqual(ids, [
      'compliance:driver:medical_cert_expiring',
      'compliance:maintenance:pm_overdue',
      'smart:hos_imminent'
    ]);
    // Severity ranking: critical first
    assert.equal(body.groups[0].severity, 'critical');
    // PM overdue group rolled up to count=3
    const pm = body.groups.find((g) => g.id === 'compliance:maintenance:pm_overdue');
    assert.equal(pm.count, 3);
    assert.match(pm.message, /3 vehicles/);
    pm.targets.forEach((t) => assert.ok(t.route && t.route.startsWith('/vehicles/')));
  } finally { await server.close(); }
}

async function testSeverityAndWindowParams() {
  const fetcher = makeFakeFetcher(DEFAULT_ROUTES());
  const aggregator = buildAggregatorForTest(fetcher);
  const client = buildClientForTest(fetcher);
  const store = new MemoryDismissalsStore();
  const server = await startServer({ aggregator, complianceAlertsClient: client, dismissalsStore: store });
  try {
    const token = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const { body } = await getJson(`${server.baseUrl}/api/dashboard/action-queue?severity=critical`, {
      Authorization: `Bearer ${token}`
    });
    body.groups.forEach((g) => assert.equal(g.severity, 'critical'));

    const { body: invalid } = await getJson(`${server.baseUrl}/api/dashboard/action-queue?window=garbage&severity=junk`, {
      Authorization: `Bearer ${token}`
    });
    assert.equal(invalid.window, '7d', 'invalid window falls back to 7d default');
    assert.equal(invalid.severity, 'all', 'invalid severity falls back to all');
  } finally { await server.close(); }
}

async function testTenantIsolation() {
  const fetcherA = makeFakeFetcher(DEFAULT_ROUTES());
  const aggregatorA = buildAggregatorForTest(fetcherA);
  const clientA = buildClientForTest(fetcherA);
  const store = new MemoryDismissalsStore();
  const serverA = await startServer({ aggregator: aggregatorA, complianceAlertsClient: clientA, dismissalsStore: store });
  try {
    const tokenA = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const headersA = { Authorization: `Bearer ${tokenA}` };

    const before = await getJson(`${serverA.baseUrl}/api/dashboard/action-queue`, headersA);
    assert.equal(before.body.total, 3);

    // Tenant A dismisses the PM-overdue group
    const dismiss = await postJson(`${serverA.baseUrl}/api/dashboard/action-queue/dismiss`, {
      group_id: 'compliance:maintenance:pm_overdue'
    }, headersA);
    assert.equal(dismiss.status, 200);
    assert.equal(dismiss.body.dismissed_count, 1);

    const after = await getJson(`${serverA.baseUrl}/api/dashboard/action-queue`, headersA);
    assert.equal(after.body.total, 2, 'group hidden after dismiss');
    assert.ok(!after.body.groups.some((g) => g.id === 'compliance:maintenance:pm_overdue'));

    // Tenant B sees the group again — dismissals are per-(tenant, user)
    const fetcherB = makeFakeFetcher(DEFAULT_ROUTES());
    const aggregatorB = buildAggregatorForTest(fetcherB);
    const clientB = buildClientForTest(fetcherB);
    const serverB = await startServer({ aggregator: aggregatorB, complianceAlertsClient: clientB, dismissalsStore: store });
    try {
      const tokenB = tokenFor({ sub: USER_ID, tenant_id: 'tenant-other' });
      const respB = await getJson(`${serverB.baseUrl}/api/dashboard/action-queue`, { Authorization: `Bearer ${tokenB}` });
      assert.equal(respB.body.total, 3, 'other tenant sees all 3 groups');
    } finally { await serverB.close(); }
  } finally { await serverA.close(); }
}

async function testDismissTargetIds() {
  const fetcher = makeFakeFetcher(DEFAULT_ROUTES());
  const aggregator = buildAggregatorForTest(fetcher);
  const client = buildClientForTest(fetcher);
  const store = new MemoryDismissalsStore();
  const server = await startServer({ aggregator, complianceAlertsClient: client, dismissalsStore: store });
  try {
    const token = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const headers = { Authorization: `Bearer ${token}` };

    const before = await getJson(`${server.baseUrl}/api/dashboard/action-queue`, headers);
    const pm = before.body.groups.find((g) => g.id === 'compliance:maintenance:pm_overdue');
    assert.equal(pm.count, 3);
    const dismissTarget = pm.targets[0].raw_alert_id;

    const r = await postJson(`${server.baseUrl}/api/dashboard/action-queue/dismiss`, {
      target_ids: [dismissTarget]
    }, headers);
    assert.equal(r.status, 200);
    assert.equal(r.body.dismissed_count, 1);

    const after = await getJson(`${server.baseUrl}/api/dashboard/action-queue`, headers);
    const pm2 = after.body.groups.find((g) => g.id === 'compliance:maintenance:pm_overdue');
    assert.equal(pm2.count, 2, 'one target dismissed; group still present with reduced count');
  } finally { await server.close(); }
}

async function testDismissValidation() {
  const fetcher = makeFakeFetcher(DEFAULT_ROUTES());
  const aggregator = buildAggregatorForTest(fetcher);
  const client = buildClientForTest(fetcher);
  const store = new MemoryDismissalsStore();
  const server = await startServer({ aggregator, complianceAlertsClient: client, dismissalsStore: store });
  try {
    const token = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const headers = { Authorization: `Bearer ${token}` };
    const r = await postJson(`${server.baseUrl}/api/dashboard/action-queue/dismiss`, {}, headers);
    assert.equal(r.status, 400);
    assert.match(r.body.error || '', /group_id or target_ids/);
  } finally { await server.close(); }
}

async function testComplianceUpstreamFailureLenient() {
  const fetcher = makeFakeFetcher([
    ['http://drivers.test/api/hos/violations/imminent', () => ok(HOS_FIXTURE)],
    ['http://drivers.test/api/drivers/fatigue/top', () => ok([])],
    ['http://vehicles.test/api/vehicles/inspections/overdue', () => ok([])],
    ['http://logistics.test/api/loads/late-risk', () => ok([])],
    ['http://ai.test/api/ai/score-alert', (_u, opts) => {
      const body = JSON.parse(opts.body);
      return ok({ severity: body.alert.type === 'hos_imminent' ? 95 : 50 });
    }],
    ['http://reporting.test/api/dashboard/alerts', () => notOk(503)]
  ]);
  const aggregator = buildAggregatorForTest(fetcher);
  const client = buildClientForTest(fetcher);
  const store = new MemoryDismissalsStore();
  const server = await startServer({ aggregator, complianceAlertsClient: client, dismissalsStore: store });
  try {
    const token = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const r = await getJson(`${server.baseUrl}/api/dashboard/action-queue`, { Authorization: `Bearer ${token}` });
    assert.equal(r.status, 200, 'still 200 when compliance upstream fails');
    assert.equal(r.body.groups.length, 1, 'only smart alerts survive');
    assert.equal(r.body.groups[0].id, 'smart:hos_imminent');
    assert.ok(r.body.upstreamErrors.some((e) => e.source === 'compliance_alerts'));
  } finally { await server.close(); }
}

async function testNoCountRegression() {
  // The grouped count must equal the underlying alert count (AC: "No regression in alert counts").
  const fetcher = makeFakeFetcher(DEFAULT_ROUTES());
  const aggregator = buildAggregatorForTest(fetcher);
  const client = buildClientForTest(fetcher);
  const store = new MemoryDismissalsStore();
  const server = await startServer({ aggregator, complianceAlertsClient: client, dismissalsStore: store });
  try {
    const token = tokenFor({ sub: USER_ID, tenant_id: TENANT_ID });
    const r = await getJson(`${server.baseUrl}/api/dashboard/action-queue`, { Authorization: `Bearer ${token}` });
    const sumCounts = r.body.groups.reduce((acc, g) => acc + g.count, 0);
    // Underlying: 1 hos + 3 pm + 1 medical = 5
    assert.equal(sumCounts, 5);
  } finally { await server.close(); }
}

(async () => {
  const cases = [
    ['unauthorized', testUnauthorized],
    ['happy path grouping', testHappyPathGrouping],
    ['severity + window query params', testSeverityAndWindowParams],
    ['dismiss group + tenant isolation', testTenantIsolation],
    ['dismiss target_ids', testDismissTargetIds],
    ['dismiss validation', testDismissValidation],
    ['compliance upstream failure is lenient', testComplianceUpstreamFailureLenient],
    ['no count regression', testNoCountRegression]
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
