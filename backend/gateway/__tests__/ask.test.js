'use strict';

/**
 * FN-1148: Tests for the gateway-local POST /api/ai/ask route and the
 * ask-forwarder service. Runs standalone with `node` — no jest.
 *
 *   node backend/gateway/__tests__/ask.test.js
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const { buildAskForwarder } = require('../services/ask-forwarder');
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

function buildAskForwarderForTest(fetcher) {
  return buildAskForwarder({
    fetcher,
    aiUrl: 'http://ai.test',
    upstreamTimeoutMs: 1000
  });
}

// A no-op aggregator stub — buildAiRouter requires it but /ask doesn't use it.
function makeAggregatorStub() {
  return {
    generate: async () => ({ briefing: null })
  };
}

function startGatewayUnderTest({ askForwarder, aggregator = makeAggregatorStub() }) {
  const app = express();
  app.use(
    '/api/ai',
    buildAiRouter({ aggregator, askForwarder, jwtSecret: JWT_SECRET })
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

async function postJson(url, payload, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });
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

const SAMPLE_BRIEFING_CTX = {
  throughput: { headline: '11 of 14 loads', detail: 'd', metric: '11/14' }
};

async function testHappyPath() {
  const fetcher = makeFakeFetcher([
    ['http://ai.test/api/ai/ask', () =>
      makeUpstreamResponse({
        success: true,
        intent: 'loads',
        answer: { kind: 'text', headline: 'h', detail: 'd' }
      })]
  ]);
  const askForwarder = buildAskForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ askForwarder });
  try {
    const token = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const { status, body } = await postJson(
      `${server.baseUrl}/api/ai/ask`,
      { prompt: 'how many loads delivered today', briefingContext: SAMPLE_BRIEFING_CTX },
      { Authorization: `Bearer ${token}` }
    );

    assert.equal(status, 200, 'happy path: 200');
    assert.equal(body.success, true);
    assert.equal(body.intent, 'loads');
    assert.equal(body.answer.kind, 'text');

    const aiCall = fetcher.calls[0];
    assert.equal(aiCall.opts.method, 'POST');
    const fwd = JSON.parse(aiCall.opts.body);
    assert.equal(fwd.tenantId, TENANT_ID, 'tenantId from JWT is forwarded');
    assert.equal(fwd.prompt, 'how many loads delivered today');
    assert.deepEqual(fwd.briefingContext, SAMPLE_BRIEFING_CTX);
    assert.equal(aiCall.opts.headers.Authorization, `Bearer ${token}`);
  } finally {
    await server.close();
  }
}

async function testUnauthorized() {
  const fetcher = makeFakeFetcher([]);
  const askForwarder = buildAskForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ askForwarder });
  try {
    const noToken = await postJson(`${server.baseUrl}/api/ai/ask`, { prompt: 'hi' });
    assert.equal(noToken.status, 401, 'no token => 401');

    const badToken = await postJson(
      `${server.baseUrl}/api/ai/ask`,
      { prompt: 'hi' },
      { Authorization: 'Bearer not-a-real-token' }
    );
    assert.equal(badToken.status, 401, 'invalid token => 401');

    const tokenWithoutTenant = jwt.sign({ sub: 'user-1' }, JWT_SECRET);
    const noTenant = await postJson(
      `${server.baseUrl}/api/ai/ask`,
      { prompt: 'hi' },
      { Authorization: `Bearer ${tokenWithoutTenant}` }
    );
    assert.equal(noTenant.status, 401, 'token without tenant_id => 401');

    assert.equal(fetcher.callCount, 0, 'unauthorized requests never hit ai-service');
  } finally {
    await server.close();
  }
}

async function testValidation() {
  const fetcher = makeFakeFetcher([]);
  const askForwarder = buildAskForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ askForwarder });
  try {
    const token = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const headers = { Authorization: `Bearer ${token}` };

    const empty = await postJson(`${server.baseUrl}/api/ai/ask`, {}, headers);
    assert.equal(empty.status, 400, 'missing prompt => 400');
    assert.match(empty.body.error, /prompt/);

    const blank = await postJson(`${server.baseUrl}/api/ai/ask`, { prompt: '   ' }, headers);
    assert.equal(blank.status, 400, 'blank prompt => 400');

    const tooLong = await postJson(
      `${server.baseUrl}/api/ai/ask`,
      { prompt: 'x'.repeat(1001) },
      headers
    );
    assert.equal(tooLong.status, 400, 'too long => 400');

    const badContext = await postJson(
      `${server.baseUrl}/api/ai/ask`,
      { prompt: 'hi', briefingContext: 'not an object' },
      headers
    );
    assert.equal(badContext.status, 400, 'non-object briefingContext => 400');

    const arrContext = await postJson(
      `${server.baseUrl}/api/ai/ask`,
      { prompt: 'hi', briefingContext: [1, 2] },
      headers
    );
    assert.equal(arrContext.status, 400, 'array briefingContext => 400');

    assert.equal(fetcher.callCount, 0, 'validation failures never hit ai-service');
  } finally {
    await server.close();
  }
}

async function testUpstreamForwardsErrorStatus() {
  const fetcher = makeFakeFetcher([
    ['http://ai.test/api/ai/ask', () =>
      makeUpstreamResponse(
        { success: false, code: 'AI_UNAVAILABLE', error: 'upstream down' },
        false,
        502
      )]
  ]);
  const askForwarder = buildAskForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ askForwarder });
  try {
    const token = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const { status, body } = await postJson(
      `${server.baseUrl}/api/ai/ask`,
      { prompt: 'overall status?' },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(status, 502, 'gateway forwards ai-service status code');
    assert.equal(body.code, 'AI_UNAVAILABLE');
  } finally {
    await server.close();
  }
}

async function testForwarderUnreachable() {
  const fetcher = async () => { throw new Error('connection refused'); };
  fetcher.calls = [];
  Object.defineProperty(fetcher, 'callCount', { get: () => 0 });
  const askForwarder = buildAskForwarderForTest(fetcher);
  const server = await startGatewayUnderTest({ askForwarder });
  try {
    const token = tokenFor({ sub: 'user-1', tenant_id: TENANT_ID });
    const { status, body } = await postJson(
      `${server.baseUrl}/api/ai/ask`,
      { prompt: 'hi' },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(status, 502, 'transport failure => 502');
    assert.match(body.error, /forwarding failed/i);
  } finally {
    await server.close();
  }
}

async function testForwarderRejectsBadDeps() {
  assert.throws(
    () => buildAskForwarder({ aiUrl: 'http://ai.test' }),
    /fetcher is required/
  );
  assert.throws(
    () => buildAskForwarder({ fetcher: () => {} }),
    /aiUrl is required/
  );

  const forwarder = buildAskForwarder({ fetcher: () => {}, aiUrl: 'http://x' });
  await assert.rejects(forwarder.forward({}), /tenantId is required/);
  await assert.rejects(
    forwarder.forward({ tenantId: 't' }),
    /prompt is required/
  );
}

async function testRouterRequiresAskForwarder() {
  // briefing aggregator is required too — exercise the new guard.
  assert.throws(
    () =>
      buildAiRouter({
        aggregator: makeAggregatorStub(),
        jwtSecret: JWT_SECRET
      }),
    /askForwarder is required/
  );
}

(async () => {
  const cases = [
    ['unauthorized', testUnauthorized],
    ['validation', testValidation],
    ['happy path', testHappyPath],
    ['upstream forwards error status', testUpstreamForwardsErrorStatus],
    ['forwarder unreachable', testForwarderUnreachable],
    ['forwarder rejects bad deps', testForwarderRejectsBadDeps],
    ['router requires askForwarder', testRouterRequiresAskForwarder]
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
