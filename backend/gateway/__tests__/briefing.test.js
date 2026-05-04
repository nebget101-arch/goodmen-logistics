'use strict';

/**
 * FN-1141: Tests for the gateway-local /api/ai/briefing route and the
 * briefing-aggregator service. Runs standalone with `node` — no jest.
 *
 *   node backend/gateway/__tests__/briefing.test.js
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const { buildBriefingAggregator } = require('../services/briefing-aggregator');
const { buildAiRouter } = require('../routes/ai');

const JWT_SECRET = 'test_secret';
const TENANT_ID = 'tenant-abc';

function makeUpstreamResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload
  };
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
  return buildBriefingAggregator({
    fetcher,
    logisticsUrl: 'http://logistics.test',
    driversUrl: 'http://drivers.test',
    vehiclesUrl: 'http://vehicles.test',
    aiUrl: 'http://ai.test',
    cacheTtlMs: 60_000,
    upstreamTimeoutMs: 1000
  });
}

function startGatewayUnderTest(aggregator) {
  const app = express();
  app.use(
    '/api/ai',
    buildAiRouter({ aggregator, jwtSecret: JWT_SECRET })
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

async function testHappyPath() {
  const fetcher = makeFakeFetcher([
    ['http://logistics.test/api/loads/throughput', () =>
      makeUpstreamResponse({ totalLoads: 12, deliveredLoads: 9 })],
    ['http://logistics.test/api/loads/exceptions', () =>
      makeUpstreamResponse({ count: 2 })],
    ['http://drivers.test/api/drivers/risk/top', () =>
      makeUpstreamResponse([{ driverId: 'd1', score: 88 }])],
    ['http://vehicles.test/api/vehicles/risk/top', () =>
      makeUpstreamResponse([{ vehicleId: 'v1', score: 91 }])],
    ['http://ai.test/api/ai/briefing/generate', () =>
      makeUpstreamResponse({
        narrative: 'Today: 12 loads, 2 exceptions...',
        sections: ['throughput', 'exceptions', 'driver', 'vehicle', 'recommendation']
      })]
  ]);
  const aggregator = buildAggregatorForTest(fetcher);
  const server = await startGatewayUnderTest(aggregator);
  try {
    const token = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const { status, body } = await getJson(`${server.baseUrl}/api/ai/briefing`, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(status, 200, 'happy path: status 200');
    assert.equal(body.tenantId, TENANT_ID, 'happy path: tenantId echoed');
    assert.equal(body.cached, false, 'happy path: not cached on first call');
    assert.deepEqual(body.upstreamErrors, [], 'happy path: no upstream errors');
    assert.ok(body.briefing && Array.isArray(body.briefing.sections),
      'happy path: ai-service response forwarded');

    const aiCall = fetcher.calls.find((c) => c.url.includes('/briefing/generate'));
    assert.ok(aiCall, 'happy path: ai-service was called');
    const aiBody = JSON.parse(aiCall.opts.body);
    assert.equal(aiBody.tenantId, TENANT_ID, 'happy path: tenantId forwarded to ai-service');
    assert.equal(aiBody.forceRefresh, false, 'happy path: forceRefresh=false on cold call');
    assert.ok(aiBody.fleetState.throughput, 'happy path: throughput aggregated');
    assert.ok(aiBody.fleetState.exceptions, 'happy path: exceptions aggregated');
    assert.ok(aiBody.fleetState.driverRisk, 'happy path: driver risk aggregated');
    assert.ok(aiBody.fleetState.vehicleRisk, 'happy path: vehicle risk aggregated');
  } finally {
    await server.close();
  }
}

async function testUnauthorized() {
  const fetcher = makeFakeFetcher([]);
  const aggregator = buildAggregatorForTest(fetcher);
  const server = await startGatewayUnderTest(aggregator);
  try {
    const noToken = await getJson(`${server.baseUrl}/api/ai/briefing`);
    assert.equal(noToken.status, 401, 'no token => 401');

    const badToken = await getJson(`${server.baseUrl}/api/ai/briefing`, {
      Authorization: 'Bearer not-a-real-token'
    });
    assert.equal(badToken.status, 401, 'invalid token => 401');

    const tokenWithoutTenant = jwt.sign({ sub: 'user-1' }, JWT_SECRET);
    const noTenant = await getJson(`${server.baseUrl}/api/ai/briefing`, {
      Authorization: `Bearer ${tokenWithoutTenant}`
    });
    assert.equal(noTenant.status, 401, 'token without tenant_id => 401');

    assert.equal(fetcher.callCount, 0, 'unauthorized requests never fan out');
  } finally {
    await server.close();
  }
}

async function testRefreshInvalidatesCache() {
  let aiCalls = 0;
  const fetcher = makeFakeFetcher([
    ['http://logistics.test/api/loads/throughput', () =>
      makeUpstreamResponse({ totalLoads: 1 })],
    ['http://logistics.test/api/loads/exceptions', () =>
      makeUpstreamResponse({ count: 0 })],
    ['http://drivers.test/api/drivers/risk/top', () => makeUpstreamResponse([])],
    ['http://vehicles.test/api/vehicles/risk/top', () => makeUpstreamResponse([])],
    ['http://ai.test/api/ai/briefing/generate', () => {
      aiCalls += 1;
      return makeUpstreamResponse({ narrative: `call-${aiCalls}` });
    }]
  ]);
  const aggregator = buildAggregatorForTest(fetcher);
  const server = await startGatewayUnderTest(aggregator);
  try {
    const token = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const headers = { Authorization: `Bearer ${token}` };

    const first = await getJson(`${server.baseUrl}/api/ai/briefing`, headers);
    assert.equal(first.status, 200);
    assert.equal(first.body.cached, false, 'first call: cold');

    const second = await getJson(`${server.baseUrl}/api/ai/briefing`, headers);
    assert.equal(second.body.cached, true, 'second call: served from cache');
    assert.equal(aiCalls, 1, 'cache hit: ai-service not re-invoked');

    const refreshed = await getJson(
      `${server.baseUrl}/api/ai/briefing?refresh=true`,
      headers
    );
    assert.equal(refreshed.body.cached, false, 'refresh=true bypasses cache');
    assert.equal(aiCalls, 2, 'refresh=true: ai-service re-invoked');

    const aiCall = fetcher.calls.filter((c) =>
      c.url.includes('/briefing/generate')
    ).at(-1);
    const aiBody = JSON.parse(aiCall.opts.body);
    assert.equal(
      aiBody.forceRefresh,
      true,
      'refresh=true: forceRefresh forwarded to ai-service'
    );
  } finally {
    await server.close();
  }
}

async function testPartialUpstreamFailure() {
  const fetcher = makeFakeFetcher([
    ['http://logistics.test/api/loads/throughput', () =>
      makeUpstreamResponse({ totalLoads: 5 })],
    ['http://logistics.test/api/loads/exceptions', () => {
      throw new Error('logistics exceptions endpoint unavailable');
    }],
    ['http://drivers.test/api/drivers/risk/top', () =>
      makeUpstreamResponse({ unexpected: true }, false, 503)],
    ['http://vehicles.test/api/vehicles/risk/top', () =>
      makeUpstreamResponse([{ vehicleId: 'v9', score: 70 }])],
    ['http://ai.test/api/ai/briefing/generate', () =>
      makeUpstreamResponse({ narrative: 'partial briefing' })]
  ]);
  const aggregator = buildAggregatorForTest(fetcher);
  const server = await startGatewayUnderTest(aggregator);
  try {
    const token = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const { status, body } = await getJson(`${server.baseUrl}/api/ai/briefing`, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(status, 200, 'partial failure: still returns 200');
    assert.equal(body.upstreamErrors.length, 2, 'partial failure: two errors logged');
    const sources = body.upstreamErrors.map((e) => e.source).sort();
    assert.deepEqual(sources, ['driverRisk', 'exceptions'],
      'partial failure: failed sources tracked');

    const aiCall = fetcher.calls.find((c) => c.url.includes('/briefing/generate'));
    const aiBody = JSON.parse(aiCall.opts.body);
    assert.equal(aiBody.fleetState.exceptions, null, 'failed source => null in fleetState');
    assert.equal(aiBody.fleetState.driverRisk, null, 'non-2xx => null in fleetState');
    assert.ok(aiBody.fleetState.throughput, 'successful sources still present');
    assert.ok(aiBody.fleetState.vehicleRisk, 'successful sources still present');
  } finally {
    await server.close();
  }
}

(async () => {
  const cases = [
    ['unauthorized', testUnauthorized],
    ['happy path', testHappyPath],
    ['refresh invalidates cache', testRefreshInvalidatesCache],
    ['partial upstream failure', testPartialUpstreamFailure]
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
