'use strict';

/**
 * FN-1177: Tests for the gateway-local GET /api/ai/explain/:token route and
 * the explain-forwarder service. Runs standalone with `node` — no jest.
 *
 *   node backend/gateway/__tests__/explain.test.js
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const { buildExplainForwarder } = require('../services/explain-forwarder');
const { buildAiRouter } = require('../routes/ai');

const JWT_SECRET = 'test_secret';
const TENANT_ID = 'tenant-abc';
const OTHER_TENANT_ID = 'tenant-xyz';
const VALID_TOKEN = 'AbCdEf0123456789-_AbCdEf0123';

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

function buildExplainForwarderForTest(fetcher) {
  return buildExplainForwarder({
    fetcher,
    aiUrl: 'http://ai.test',
    upstreamTimeoutMs: 1000
  });
}

const AGGREGATOR_STUB = {
  generate: async () => ({ briefing: null })
};
const ASK_FORWARDER_STUB = {
  forward: async () => ({ status: 200, ok: true, body: {} })
};

function startGatewayUnderTest({ explainForwarder }) {
  const app = express();
  app.use(
    '/api/ai',
    buildAiRouter({
      aggregator: AGGREGATOR_STUB,
      askForwarder: ASK_FORWARDER_STUB,
      explainForwarder,
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
  const res = await fetch(url, { headers });
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
    ['http://ai.test/api/ai/explain/', () =>
      makeUpstreamResponse({
        token: VALID_TOKEN,
        sources: [{ system: 'logistics', recordId: 'load-42' }],
        rules: ['delivered_today'],
        scores: { confidence: 0.91 }
      })]
  ]);
  const explainForwarder = buildExplainForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ explainForwarder });
  try {
    const jwtToken = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const { status, body } = await getJson(
      `${server.baseUrl}/api/ai/explain/${VALID_TOKEN}`,
      { Authorization: `Bearer ${jwtToken}` }
    );

    assert.equal(status, 200, 'happy path: 200');
    assert.equal(body.token, VALID_TOKEN);
    assert.equal(body.rules[0], 'delivered_today');

    const aiCall = fetcher.calls[0];
    assert.equal(aiCall.opts.method, 'GET');
    assert.match(aiCall.url, new RegExp(`/api/ai/explain/${VALID_TOKEN}\\?tenantId=${TENANT_ID}$`),
      'tenantId from JWT is appended as query param');
    assert.equal(aiCall.opts.headers.Authorization, `Bearer ${jwtToken}`);
  } finally {
    await server.close();
  }
}

async function testWrongTenantReturns404() {
  // Upstream ai-service returns 404 when the token belongs to a different
  // tenant; gateway must pass it through verbatim (no leakage).
  const fetcher = makeFakeFetcher([
    ['http://ai.test/api/ai/explain/', () =>
      makeUpstreamResponse({ error: 'Explanation not found' }, false, 404)]
  ]);
  const explainForwarder = buildExplainForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ explainForwarder });
  try {
    const jwtToken = tokenFor({ sub: 'user-1', tenant_id: OTHER_TENANT_ID });
    const { status, body } = await getJson(
      `${server.baseUrl}/api/ai/explain/${VALID_TOKEN}`,
      { Authorization: `Bearer ${jwtToken}` }
    );
    assert.equal(status, 404, 'wrong tenant => 404 passthrough');
    assert.equal(body.error, 'Explanation not found');

    const aiCall = fetcher.calls[0];
    assert.match(aiCall.url, /tenantId=tenant-xyz/,
      'requesting tenant is forwarded so ai-service can scope-check');
  } finally {
    await server.close();
  }
}

async function testExpiredTokenReturns404() {
  const fetcher = makeFakeFetcher([
    ['http://ai.test/api/ai/explain/', () =>
      makeUpstreamResponse({ error: 'Explanation not found' }, false, 404)]
  ]);
  const explainForwarder = buildExplainForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ explainForwarder });
  try {
    const jwtToken = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const { status, body } = await getJson(
      `${server.baseUrl}/api/ai/explain/${VALID_TOKEN}`,
      { Authorization: `Bearer ${jwtToken}` }
    );
    assert.equal(status, 404);
    assert.equal(body.error, 'Explanation not found');
  } finally {
    await server.close();
  }
}

async function testUnauthorized() {
  const fetcher = makeFakeFetcher([]);
  const explainForwarder = buildExplainForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ explainForwarder });
  try {
    const noToken = await getJson(`${server.baseUrl}/api/ai/explain/${VALID_TOKEN}`);
    assert.equal(noToken.status, 401, 'no token => 401');

    const badToken = await getJson(
      `${server.baseUrl}/api/ai/explain/${VALID_TOKEN}`,
      { Authorization: 'Bearer not-a-real-token' }
    );
    assert.equal(badToken.status, 401, 'invalid token => 401');

    const tokenWithoutTenant = jwt.sign({ sub: 'user-1' }, JWT_SECRET);
    const noTenant = await getJson(
      `${server.baseUrl}/api/ai/explain/${VALID_TOKEN}`,
      { Authorization: `Bearer ${tokenWithoutTenant}` }
    );
    assert.equal(noTenant.status, 401, 'token without tenant_id => 401');

    assert.equal(fetcher.callCount, 0, 'unauthorized requests never hit ai-service');
  } finally {
    await server.close();
  }
}

async function testMalformedTokenReturns404() {
  // The token must be base64url-ish (16-128 chars). Anything else is rejected
  // at the gateway without round-tripping to ai-service so probing is cheap
  // to detect and the upstream isn't asked to validate garbage.
  const fetcher = makeFakeFetcher([]);
  const explainForwarder = buildExplainForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ explainForwarder });
  try {
    const jwtToken = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const headers = { Authorization: `Bearer ${jwtToken}` };

    const tooShort = await getJson(`${server.baseUrl}/api/ai/explain/abc`, headers);
    assert.equal(tooShort.status, 404, 'short token => 404');

    const badChars = await getJson(
      `${server.baseUrl}/api/ai/explain/${'!@#$%^&*()'.repeat(2)}`,
      headers
    );
    assert.equal(badChars.status, 404, 'invalid chars => 404');

    assert.equal(fetcher.callCount, 0, 'malformed tokens never hit ai-service');
  } finally {
    await server.close();
  }
}

async function testUpstreamForwardsErrorStatus() {
  const fetcher = makeFakeFetcher([
    ['http://ai.test/api/ai/explain/', () =>
      makeUpstreamResponse({ error: 'upstream down' }, false, 503)]
  ]);
  const explainForwarder = buildExplainForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ explainForwarder });
  try {
    const jwtToken = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const { status, body } = await getJson(
      `${server.baseUrl}/api/ai/explain/${VALID_TOKEN}`,
      { Authorization: `Bearer ${jwtToken}` }
    );
    assert.equal(status, 503, 'gateway forwards ai-service status code');
    assert.equal(body.error, 'upstream down');
  } finally {
    await server.close();
  }
}

async function testForwarderUnreachable() {
  const fetcher = async () => { throw new Error('connection refused'); };
  fetcher.calls = [];
  Object.defineProperty(fetcher, 'callCount', { get: () => 0 });
  const explainForwarder = buildExplainForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ explainForwarder });
  try {
    const jwtToken = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const { status, body } = await getJson(
      `${server.baseUrl}/api/ai/explain/${VALID_TOKEN}`,
      { Authorization: `Bearer ${jwtToken}` }
    );
    assert.equal(status, 502, 'transport failure => 502');
    assert.match(body.error, /Explain forwarding failed/);
  } finally {
    await server.close();
  }
}

async function testForwarderRejectsBadDeps() {
  assert.throws(
    () => buildExplainForwarder({ aiUrl: 'http://ai.test' }),
    /fetcher is required/
  );
  assert.throws(
    () => buildExplainForwarder({ fetcher: () => {} }),
    /aiUrl is required/
  );

  const forwarder = buildExplainForwarder({ fetcher: () => {}, aiUrl: 'http://x' });
  await assert.rejects(forwarder.forward({}), /tenantId is required/);
  await assert.rejects(
    forwarder.forward({ tenantId: 't' }),
    /token is required/
  );
}

async function testRouterRequiresExplainForwarder() {
  assert.throws(
    () =>
      buildAiRouter({
        aggregator: AGGREGATOR_STUB,
        askForwarder: ASK_FORWARDER_STUB,
        jwtSecret: JWT_SECRET
      }),
    /explainForwarder is required/
  );
}

async function testTokenIsUrlEncodedOnUpstream() {
  // Belt-and-suspenders: even though the gateway pre-validates with
  // EXPLAIN_TOKEN_PATTERN, the forwarder still encodes the token so a future
  // pattern relaxation can't accidentally produce malformed URLs.
  const fetcher = makeFakeFetcher([
    ['http://ai.test/api/ai/explain/', () =>
      makeUpstreamResponse({ ok: true })]
  ]);
  const explainForwarder = buildExplainForwarderForTest(fetcher);
  await explainForwarder.forward({
    tenantId: 'tenant with spaces',
    authHeader: 'Bearer x',
    token: 'abc/def?q=1'
  });
  assert.match(fetcher.calls[0].url, /\/api\/ai\/explain\/abc%2Fdef%3Fq%3D1\?tenantId=tenant%20with%20spaces/);
}

(async () => {
  const cases = [
    ['unauthorized', testUnauthorized],
    ['malformed token => 404', testMalformedTokenReturns404],
    ['happy path', testHappyPath],
    ['wrong tenant => 404 passthrough', testWrongTenantReturns404],
    ['expired token => 404 passthrough', testExpiredTokenReturns404],
    ['upstream forwards error status', testUpstreamForwardsErrorStatus],
    ['forwarder unreachable', testForwarderUnreachable],
    ['forwarder rejects bad deps', testForwarderRejectsBadDeps],
    ['router requires explainForwarder', testRouterRequiresExplainForwarder],
    ['token is url-encoded on upstream', testTokenIsUrlEncodedOnUpstream]
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
