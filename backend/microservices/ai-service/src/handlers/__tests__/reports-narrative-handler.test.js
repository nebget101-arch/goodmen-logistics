'use strict';

/**
 * FN-1123: Tests for reports-narrative-handler.
 * Runs standalone with `node`. No jest/mocha required.
 * The Anthropic client is mocked via deps.anthropic so no real API calls are made.
 */

const assert = require('node:assert/strict');
const {
  handleReportsNarrative,
  buildReportSchemaBlock,
  buildUserMessage,
  resolveVariant,
  SYSTEM_PROMPT,
  REPORT_KEY_RE,
  ALLOWED_ROLES,
  VARIANTS,
  DEFAULT_VARIANT
} = require('../reports-narrative-handler');

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

function makeReq({ reportKey = 'revenue-by-driver', body = {}, user = { role: 'manager', id: 'u-1' }, headers = {}, query = {} } = {}) {
  return {
    params: { reportKey },
    body,
    user,
    headers,
    query
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

  // ──────────────────────────────────────────────────────────────────────
  // FN-1173: variant=long for PDF embedding (server-to-server)
  // ──────────────────────────────────────────────────────────────────────

  // resolveVariant: query parsing + defaulting
  {
    assert.equal(resolveVariant({ query: { variant: 'long' } }).form, 'long');
    assert.equal(resolveVariant({ query: { variant: 'LONG' } }).form, 'long', 'case insensitive');
    assert.equal(resolveVariant({ query: { variant: '  long  ' } }).form, 'long', 'trims whitespace');
    assert.equal(resolveVariant({ query: { variant: 'short' } }).form, 'short');
    assert.equal(resolveVariant({ query: { variant: 'medium' } }).form, DEFAULT_VARIANT, 'unknown defaults');
    assert.equal(resolveVariant({ query: { variant: ['long', 'short'] } }).form, 'long', 'first element of array');
    assert.equal(resolveVariant({ query: {} }).form, DEFAULT_VARIANT);
    assert.equal(resolveVariant({}).form, DEFAULT_VARIANT, 'no query at all');
    assert.equal(resolveVariant(null).form, DEFAULT_VARIANT, 'null req');
    assert.equal(VARIANTS.short.maxTokens, 400);
    assert.equal(VARIANTS.long.maxTokens, 900);
    assert.ok(VARIANTS.long.maxTokens >= 2 * VARIANTS.short.maxTokens, 'long ≥ 2× short token budget');
    // eslint-disable-next-line no-console
    console.log('  ok  resolveVariant parses query + defaults safely');
  }

  // buildUserMessage carries the form key so the model knows which length to emit
  {
    const msg = buildUserMessage({ cards: [], data: [], filters: {}, priorPeriod: {}, form: 'long' });
    const parsed = JSON.parse(msg);
    assert.equal(parsed.form, 'long');
    const msgDefault = buildUserMessage({ cards: [], data: [], filters: {}, priorPeriod: {} });
    assert.equal(JSON.parse(msgDefault).form, DEFAULT_VARIANT);
    // eslint-disable-next-line no-console
    console.log('  ok  buildUserMessage embeds form key');
  }

  // SYSTEM_PROMPT references both variants so the cached system block carries
  // the variant guidance — guarantees the same cached block serves both call
  // sites without per-variant cache invalidation.
  assert.match(SYSTEM_PROMPT, /form="short"/);
  assert.match(SYSTEM_PROMPT, /form="long"/);
  // eslint-disable-next-line no-console
  console.log('  ok  SYSTEM_PROMPT documents both variants in the cached block');

  // Handler with ?variant=long → long max_tokens, form key in user message,
  // unchanged cached system blocks (cache hit-rate preserved).
  {
    const captured = { calls: [] };
    const res = makeRes();
    await handleReportsNarrative(
      makeReq({
        body: { cards: [{ id: 'rev', label: 'Revenue', value: 12000, delta: 0.12 }] },
        query: { variant: 'long' }
      }),
      res,
      { anthropic: makeMockAnthropic({ captured }) }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.meta.variant, 'long');
    assert.equal(captured.calls.length, 1);
    const call = captured.calls[0];
    assert.equal(call.max_tokens, 900, 'long variant doubles the token budget');
    // The cached system blocks are byte-identical to the short variant,
    // so the prompt cache keyed on those blocks still hits.
    assert.equal(call.system.length, 2);
    assert.equal(call.system[0].text, SYSTEM_PROMPT);
    assert.equal(call.system[0].cache_control.type, 'ephemeral');
    assert.equal(call.system[1].cache_control.type, 'ephemeral');
    // The variant directive lives in the per-call user message instead.
    const userPayload = JSON.parse(call.messages[0].content);
    assert.equal(userPayload.form, 'long');
    // eslint-disable-next-line no-console
    console.log('  ok  ?variant=long uses 900 max_tokens + form="long" in user msg, cached system unchanged');
  }

  // Default (no query param) keeps the FN-1114 panel behaviour unchanged.
  {
    const captured = { calls: [] };
    const res = makeRes();
    await handleReportsNarrative(
      makeReq({ body: { cards: [] } }),
      res,
      { anthropic: makeMockAnthropic({ captured }) }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.meta.variant, 'short');
    assert.equal(captured.calls[0].max_tokens, 400);
    const userPayload = JSON.parse(captured.calls[0].messages[0].content);
    assert.equal(userPayload.form, 'short');
    // eslint-disable-next-line no-console
    console.log('  ok  default variant unchanged (short, max 400)');
  }

  // Unknown variant value silently degrades to short rather than 400-ing.
  {
    const captured = { calls: [] };
    const res = makeRes();
    await handleReportsNarrative(
      makeReq({ body: {}, query: { variant: 'gigantic' } }),
      res,
      { anthropic: makeMockAnthropic({ captured }) }
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.meta.variant, 'short');
    assert.equal(captured.calls[0].max_tokens, 400);
    // eslint-disable-next-line no-console
    console.log('  ok  unknown variant falls back to short');
  }

  // Server-to-server call path: reporting-service forwards the user's Bearer
  // JWT (no req.user attached). Handler verifies the token via JWT_SECRET and
  // applies the role gate. Because this exercises the JWT verification path
  // end-to-end, the call would 200 only when JWT_SECRET matches. We sign a
  // token with the dev secret to assert the path works.
  {
    let jwt;
    try { jwt = require('jsonwebtoken'); } catch (_e) { jwt = null; }
    if (jwt) {
      const secret = process.env.JWT_SECRET || 'dev_secret';
      const token = jwt.sign({ id: 'u-server-to-server', role: 'manager' }, secret, { expiresIn: '5m' });
      const captured = { calls: [] };
      const res = makeRes();
      await handleReportsNarrative(
        {
          params: { reportKey: 'revenue-by-driver' },
          body: { cards: [], data: [] },
          headers: { authorization: `Bearer ${token}` },
          query: { variant: 'long' }
          // NOTE: no req.user — exactly what reporting-service forwards
        },
        res,
        { anthropic: makeMockAnthropic({ captured }) }
      );
      assert.equal(res.statusCode, 200, 'server-to-server JWT path should succeed');
      assert.equal(res.body.meta.variant, 'long');
      assert.equal(captured.calls.length, 1, 'Anthropic should be called once');
      // eslint-disable-next-line no-console
      console.log('  ok  server-to-server (Bearer JWT, no req.user) reaches handler with variant=long');
    } else {
      // eslint-disable-next-line no-console
      console.log('  skip server-to-server JWT path (jsonwebtoken not installed)');
    }
  }

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
