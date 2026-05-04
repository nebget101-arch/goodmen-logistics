'use strict';

/**
 * FN-1123 + FN-1315: Tests for reports-narrative-handler.
 * Runs standalone with `node`. No jest/mocha required.
 * The Anthropic client is mocked via deps.anthropic so no real API calls are made.
 */

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const {
  handleReportsNarrative,
  buildReportSchemaBlock,
  SYSTEM_PROMPT,
  REPORT_KEY_RE,
  ALLOWED_ROLES
} = require('../reports-narrative-handler');

const TEST_JWT_SECRET = 'dev_secret'; // matches the handler's fallback

function signJwt(payload, options = {}) {
  return jwt.sign(payload, TEST_JWT_SECRET, options);
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function makeMockAnthropic({ text = 'Revenue rose 12% driven by a single high-margin contract.', captured } = {}) {
  return {
    messages: {
      create: async (args) => {
        if (captured) captured.calls.push(args);
        return {
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text }],
          usage: {
            input_tokens: 100,
            output_tokens: 30,
            cache_read_input_tokens: 90,
            cache_creation_input_tokens: 0
          }
        };
      }
    }
  };
}

function makeThrowingAnthropic(err) {
  return {
    messages: {
      create: async () => {
        throw err;
      }
    }
  };
}

function makeReq({ reportKey = 'revenue-by-driver', body = {}, user = { role: 'manager', id: 'u-1' }, headers = {} } = {}) {
  return {
    params: { reportKey },
    body,
    user,
    headers
  };
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('reports-narrative-handler tests');

  // -------- Sanity exports
  assert.ok(typeof SYSTEM_PROMPT === 'string' && SYSTEM_PROMPT.length > 50);
  assert.ok(REPORT_KEY_RE instanceof RegExp);
  assert.deepEqual(ALLOWED_ROLES.slice().sort(), ['admin', 'dispatcher', 'manager', 'owner']);

  // -------- buildReportSchemaBlock
  {
    const block = buildReportSchemaBlock('revenue-by-driver');
    assert.match(block, /revenue-by-driver/);
    const generic = buildReportSchemaBlock('some-unknown-key');
    assert.match(generic, /generic/i);
    // eslint-disable-next-line no-console
    console.log('  ok  buildReportSchemaBlock returns specific + generic blocks');
  }

  // -------- AC1 + AC2 + AC4 (happy path) — also asserts cache_control placement
  {
    const captured = { calls: [] };
    const res = makeRes();
    await handleReportsNarrative(
      makeReq({
        reportKey: 'revenue-by-driver',
        body: {
          cards: [{ id: 'rev', label: 'Revenue', value: 12000, delta: 0.12, unit: '$' }],
          data: [{ driverId: 'd1', driverName: 'Smith', grossRevenue: 12000 }],
          filters: { dateFrom: '2026-04-01', dateTo: '2026-04-30' },
          priorPeriod: [{ id: 'rev', label: 'Revenue', value: 10714 }]
        }
      }),
      res,
      { anthropic: makeMockAnthropic({ captured }) }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(typeof res.body.narrative, 'string');
    assert.ok(res.body.narrative.length > 0, 'narrative should be a non-empty string');
    assert.equal(typeof res.body.generatedAt, 'string');
    // ISO 8601 sanity
    assert.ok(!Number.isNaN(Date.parse(res.body.generatedAt)));
    assert.equal(res.body.meta.model, 'claude-sonnet-4-6');
    assert.equal(res.body.meta.cacheReadTokens, 90);
    assert.equal(res.body.meta.cacheCreationTokens, 0);
    assert.equal(typeof res.body.meta.processingTimeMs, 'number');

    // Critical: assert system is an array of two blocks, both with ephemeral cache_control.
    assert.equal(captured.calls.length, 1);
    const sentArgs = captured.calls[0];
    assert.ok(Array.isArray(sentArgs.system), 'system must be an array of blocks');
    assert.equal(sentArgs.system.length, 2);
    for (const block of sentArgs.system) {
      assert.equal(block.type, 'text');
      assert.equal(typeof block.text, 'string');
      assert.ok(block.text.length > 0);
      assert.ok(block.cache_control, 'each system block must have cache_control');
      assert.equal(block.cache_control.type, 'ephemeral');
    }
    // First block is the role/style prompt; second is the per-report schema.
    assert.equal(sentArgs.system[0].text, SYSTEM_PROMPT);
    assert.match(sentArgs.system[1].text, /revenue-by-driver/);
    // User message must NOT carry cache_control.
    assert.equal(sentArgs.messages.length, 1);
    const userMsg = sentArgs.messages[0];
    assert.equal(userMsg.role, 'user');
    assert.equal(typeof userMsg.content, 'string');
    assert.equal(userMsg.cache_control, undefined);
    // Sanity on model + temperature
    assert.equal(sentArgs.model, 'claude-sonnet-4-6');
    assert.equal(sentArgs.temperature, 0.2);
    assert.equal(sentArgs.max_tokens, 400);

    // eslint-disable-next-line no-console
    console.log('  ok  200 happy path with system[0]+system[1] cache_control: ephemeral');
  }

  // -------- AC7: 400 when reportKey is invalid
  {
    const res = makeRes();
    await handleReportsNarrative(
      makeReq({ reportKey: 'bad key with spaces!', body: {} }),
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    // eslint-disable-next-line no-console
    console.log('  ok  invalid reportKey -> 400');
  }

  // -------- AC7: 400 when reportKey too long
  {
    const res = makeRes();
    const tooLong = 'a'.repeat(65);
    await handleReportsNarrative(
      makeReq({ reportKey: tooLong, body: {} }),
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    // eslint-disable-next-line no-console
    console.log('  ok  reportKey too long -> 400');
  }

  // -------- AC4: 403 when user role is unauthorized
  {
    const res = makeRes();
    await handleReportsNarrative(
      makeReq({ user: { role: 'driver', id: 'u-2' } }),
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'AI_FORBIDDEN');
    // eslint-disable-next-line no-console
    console.log('  ok  unauthorized role -> 403');
  }

  // -------- AC4: 403 when no user and no bearer token
  {
    const res = makeRes();
    await handleReportsNarrative(
      { params: { reportKey: 'revenue-by-driver' }, body: {}, headers: {} },
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'AI_FORBIDDEN');
    // eslint-disable-next-line no-console
    console.log('  ok  no user / no JWT -> 403');
  }

  // -------- AC4: 403 when bearer token is invalid
  {
    const res = makeRes();
    await handleReportsNarrative(
      {
        params: { reportKey: 'revenue-by-driver' },
        body: {},
        headers: { authorization: 'Bearer not-a-real-jwt' }
      },
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'AI_FORBIDDEN');
    // eslint-disable-next-line no-console
    console.log('  ok  invalid bearer token -> 403');
  }

  // -------- AC8: 413 when body exceeds 256KB
  {
    const huge = 'x'.repeat(260 * 1024);
    const res = makeRes();
    await handleReportsNarrative(
      makeReq({ body: { data: [{ blob: huge }] } }),
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 413);
    assert.equal(res.body.code, 'AI_PAYLOAD_TOO_LARGE');
    // eslint-disable-next-line no-console
    console.log('  ok  oversize body -> 413');
  }

  // -------- AC8: 400 when cards/data/filters wrong type
  {
    const res = makeRes();
    await handleReportsNarrative(
      makeReq({ body: { cards: 'not-an-array' } }),
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    // eslint-disable-next-line no-console
    console.log('  ok  wrong cards type -> 400');
  }
  {
    const res = makeRes();
    await handleReportsNarrative(
      makeReq({ body: { filters: ['arr', 'not', 'object'] } }),
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    // eslint-disable-next-line no-console
    console.log('  ok  wrong filters type -> 400');
  }

  // -------- AC5: 502 when Anthropic throws
  {
    const res = makeRes();
    const err = new Error('boom');
    err.status = 503;
    await handleReportsNarrative(
      makeReq({ body: { cards: [], data: [] } }),
      res,
      { anthropic: makeThrowingAnthropic(err) }
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_UNAVAILABLE');
    assert.equal(typeof res.body.meta.processingTimeMs, 'number');
    // eslint-disable-next-line no-console
    console.log('  ok  Anthropic upstream error -> 502 AI_UNAVAILABLE');
  }

  // -------- Generic-schema fallback path
  {
    const captured = { calls: [] };
    const res = makeRes();
    await handleReportsNarrative(
      makeReq({ reportKey: 'totally-new-report', body: { cards: [], data: [] } }),
      res,
      { anthropic: makeMockAnthropic({ captured }) }
    );
    assert.equal(res.statusCode, 200);
    assert.match(captured.calls[0].system[1].text, /generic/i);
    // eslint-disable-next-line no-console
    console.log('  ok  unknown reportKey falls back to generic schema block');
  }

  // -------- Each allowed role passes RBAC
  for (const role of ALLOWED_ROLES) {
    const res = makeRes();
    await handleReportsNarrative(
      makeReq({ user: { role, id: 'u-x' }, body: {} }),
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 200, `role ${role} should be allowed`);
  }
  // eslint-disable-next-line no-console
  console.log('  ok  all allowed roles pass RBAC');

  // -------- FN-1315: local-verify path resolves a valid Bearer JWT (no req.user)
  {
    const captured = { calls: [] };
    const token = signJwt({ id: 'u-admin', role: 'admin' });
    const res = makeRes();
    await handleReportsNarrative(
      {
        params: { reportKey: 'revenue-by-driver' },
        body: { cards: [{ id: 'rev', label: 'Revenue', value: 100, delta: 0.1, unit: '$' }] },
        headers: { authorization: `Bearer ${token}` }
        // NOTE: no req.user — the gateway is plain http-proxy and does not attach it.
      },
      res,
      { anthropic: makeMockAnthropic({ captured }) }
    );
    assert.equal(res.statusCode, 200, 'local-verify must succeed for a valid admin JWT');
    assert.equal(res.body.success, true);
    assert.equal(typeof res.body.narrative, 'string');
    // Anthropic must have been called — proves the handler proceeded past RBAC.
    assert.equal(captured.calls.length, 1);
    // eslint-disable-next-line no-console
    console.log('  ok  FN-1315: valid Bearer JWT (role=admin) resolves locally -> 200');
  }

  // -------- FN-1315: every allowed role works through the local-verify path
  for (const role of ALLOWED_ROLES) {
    const token = signJwt({ id: `u-${role}`, role });
    const res = makeRes();
    await handleReportsNarrative(
      {
        params: { reportKey: 'revenue-by-driver' },
        body: {},
        headers: { authorization: `Bearer ${token}` }
      },
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 200, `local-verify role=${role} should pass`);
  }
  // eslint-disable-next-line no-console
  console.log('  ok  FN-1315: all allowed roles pass local-verify');

  // -------- FN-1315: disallowed role from local-verify still returns 403
  {
    const token = signJwt({ id: 'u-driver', role: 'driver' });
    const res = makeRes();
    await handleReportsNarrative(
      {
        params: { reportKey: 'revenue-by-driver' },
        body: {},
        headers: { authorization: `Bearer ${token}` }
      },
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'AI_FORBIDDEN');
    // eslint-disable-next-line no-console
    console.log('  ok  FN-1315: disallowed role via local-verify -> 403');
  }

  // -------- FN-1315: expired JWT returns 403
  {
    const token = signJwt({ id: 'u-admin', role: 'admin' }, { expiresIn: '-1h' });
    const res = makeRes();
    await handleReportsNarrative(
      {
        params: { reportKey: 'revenue-by-driver' },
        body: {},
        headers: { authorization: `Bearer ${token}` }
      },
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'AI_FORBIDDEN');
    // eslint-disable-next-line no-console
    console.log('  ok  FN-1315: expired JWT -> 403');
  }

  // -------- FN-1315: JWT signed with wrong secret returns 403
  {
    const token = jwt.sign({ id: 'u-admin', role: 'admin' }, 'wrong_secret');
    const res = makeRes();
    await handleReportsNarrative(
      {
        params: { reportKey: 'revenue-by-driver' },
        body: {},
        headers: { authorization: `Bearer ${token}` }
      },
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'AI_FORBIDDEN');
    // eslint-disable-next-line no-console
    console.log('  ok  FN-1315: bad signature -> 403');
  }

  // -------- FN-1315: JWT payload without role field returns 403 insufficient role
  {
    const token = signJwt({ id: 'u-no-role' }); // no role claim
    const res = makeRes();
    await handleReportsNarrative(
      {
        params: { reportKey: 'revenue-by-driver' },
        body: {},
        headers: { authorization: `Bearer ${token}` }
      },
      res,
      { anthropic: makeMockAnthropic() }
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'AI_FORBIDDEN');
    // eslint-disable-next-line no-console
    console.log('  ok  FN-1315: JWT without role -> 403');
  }

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
