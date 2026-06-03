'use strict';

/**
 * FN-1149: Tests for reports-parse-query-handler.
 * Runs standalone with `node`. Anthropic client is mocked via deps.anthropic.
 */

const assert = require('node:assert/strict');
const {
  handleReportsParseQuery,
  validateRequest,
  validateFilters,
  validateField,
  validateIsoDate,
  validateDateRange,
  validatePositiveNumber,
  validateStringArray,
  buildSystemBlocks,
  buildSchemaBlock,
  buildUserMessage,
  hasReportsView,
  REPORT_FILTER_SCHEMAS,
  REQUIRED_PERMISSION,
  MAX_QUERY_CHARS,
  MAX_UNMATCHED
} = require('../reports-parse-query-handler');

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

function makeMockAnthropic(modelOutputObj, options = {}) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (args) => {
        calls.push(args);
        return {
          model: options.model || 'claude-haiku-4-5-20251001',
          content: [{ type: 'text', text: JSON.stringify(modelOutputObj) }],
          usage: options.usage || {
            input_tokens: 50,
            output_tokens: 80,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
          }
        };
      }
    }
  };
}

function makeRawAnthropic(rawText, options = {}) {
  return {
    messages: {
      create: async () => ({
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: rawText }],
        usage: options.usage || {
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        }
      })
    }
  };
}

function makeFailingAnthropic(err) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async () => {
        calls.push(true);
        throw err;
      }
    }
  };
}

const PERMISSIVE_USER = { id: 'u1', role: 'dispatch_manager', permissions: ['reports.view'] };
const SUPER_ADMIN_USER = { id: 'u-root', role: 'super_admin', permissions: [] };
const READ_ONLY_USER = { id: 'u2', role: 'driver', permissions: ['loads.view'] };

const SAMPLE_BODY = {
  reportKey: 'revenue-by-driver',
  naturalQuery: 'last month, exclude team leads, over $1000',
  currentFilters: {}
};

function makeReq(overrides = {}) {
  return Object.assign(
    {
      body: SAMPLE_BODY,
      user: PERMISSIVE_USER,
      headers: {}
    },
    overrides
  );
}

async function runCase(name, fn) {
  try {
    await fn();
    // eslint-disable-next-line no-console
    console.log(`  ok  ${name}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

(async () => {
  // eslint-disable-next-line no-console
  console.log('reports-parse-query-handler');

  // ── per-field validators ───────────────────────────────────────────────
  await runCase('validateIsoDate: accepts ISO and rejects bad', () => {
    assert.equal(validateIsoDate('2026-04-15'), '2026-04-15');
    assert.equal(validateIsoDate('2025-13-40'), undefined);
    assert.equal(validateIsoDate('apr 15'), undefined);
    assert.equal(validateIsoDate(20260415), undefined);
  });

  await runCase('validateDateRange: parses YYYY-MM-DD..YYYY-MM-DD', () => {
    assert.equal(validateDateRange('2026-04-01..2026-04-30'), '2026-04-01..2026-04-30');
    assert.equal(validateDateRange('2026-04-30..2026-04-01'), undefined, 'rejects reversed range');
    assert.equal(validateDateRange('2026-04-01_2026-04-30'), undefined);
  });

  await runCase('validatePositiveNumber: accepts strings + numbers, rejects <= 0', () => {
    assert.equal(validatePositiveNumber(1500), 1500);
    assert.equal(validatePositiveNumber('2500'), 2500);
    assert.equal(validatePositiveNumber(0), undefined);
    assert.equal(validatePositiveNumber(-5), undefined);
    assert.equal(validatePositiveNumber('nope'), undefined);
  });

  await runCase('validateStringArray: trims, drops empties, caps length', () => {
    assert.deepEqual(validateStringArray(['  Alice ', 'Bob', ''], { max: 5 }), ['Alice', 'Bob']);
    assert.equal(validateStringArray('not-array', { max: 5 }), undefined);
    assert.equal(validateStringArray([], { max: 5 }), undefined);
    const big = Array.from({ length: 50 }, (_, i) => `n${i}`);
    assert.equal(validateStringArray(big, { max: 5 }).length, 5);
  });

  await runCase('validateField: routes by kind', () => {
    assert.equal(validateField('2026-01-01', { kind: 'isoDate' }), '2026-01-01');
    assert.equal(validateField(true, { kind: 'bool' }), true);
    assert.equal(validateField('truthy', { kind: 'bool' }), undefined);
    assert.equal(validateField('unknown_kind_value', { kind: 'mystery' }), undefined);
  });

  // ── permission helper ──────────────────────────────────────────────────
  await runCase('hasReportsView: super_admin always allowed', () => {
    assert.equal(hasReportsView(SUPER_ADMIN_USER), true);
  });

  await runCase('hasReportsView: explicit reports.view allowed', () => {
    assert.equal(hasReportsView({ permissions: ['reports.view'] }), true);
  });

  await runCase('hasReportsView: missing permission denied', () => {
    assert.equal(hasReportsView(READ_ONLY_USER), false);
  });

  await runCase('hasReportsView: undefined user denied', () => {
    assert.equal(hasReportsView(undefined), false);
  });

  // ── request validation ────────────────────────────────────────────────
  await runCase('validateRequest: rejects non-object body', () => {
    assert.ok(validateRequest(null).error);
    assert.ok(validateRequest('not an object').error);
  });

  await runCase('validateRequest: rejects missing reportKey/naturalQuery', () => {
    assert.match(validateRequest({}).error, /reportKey/);
    assert.match(validateRequest({ reportKey: 'revenue-by-driver' }).error, /naturalQuery/);
  });

  await runCase('validateRequest: rejects malformed reportKey (path traversal)', () => {
    assert.match(
      validateRequest({ reportKey: '../../etc/passwd', naturalQuery: 'x' }).error,
      /alphanumeric/
    );
  });

  await runCase('validateRequest: caps query length', () => {
    const long = 'a'.repeat(MAX_QUERY_CHARS + 5);
    assert.match(validateRequest({ reportKey: 'x', naturalQuery: long }).error, /characters or less/);
  });

  await runCase('validateRequest: rejects malformed currentFilters', () => {
    const r = validateRequest({ reportKey: 'x', naturalQuery: 'q', currentFilters: 'oops' });
    assert.match(r.error, /currentFilters/);
  });

  await runCase('validateRequest: accepts minimal valid body', () => {
    const r = validateRequest({ reportKey: 'revenue-by-driver', naturalQuery: 'q' });
    assert.equal(r.error, undefined);
    assert.equal(r.reportKey, 'revenue-by-driver');
    assert.equal(r.currentFilters, null);
  });

  // ── output validation: filter schema enforcement (the AC core) ─────────
  await runCase('validateFilters: drops disallowed keys; tokens → unmatchedTokens', () => {
    const schema = REPORT_FILTER_SCHEMAS['revenue-by-driver'];
    const result = validateFilters({
      raw: {
        driver_name: 'Smith',
        unknown_key: 'x',
        another_bogus: 42
      },
      schema,
      tokenMap: {
        driver_name: ['Smith'],
        unknown_key: ['unknown phrase'],
        another_bogus: ['weird token']
      }
    });
    assert.deepEqual(result.filters, { driver_name: 'Smith' });
    const um = new Set(result.unmatchedTokens);
    assert.ok(um.has('unknown phrase'), 'tokens for unknown_key surfaced');
    assert.ok(um.has('weird token'), 'tokens for another_bogus surfaced');
    assert.ok(!um.has('Smith'), 'tokens for matched filter NOT surfaced');
  });

  await runCase('validateFilters: schema-recognised key with bad value drops + surfaces tokens', () => {
    const schema = REPORT_FILTER_SCHEMAS['revenue-by-driver'];
    const result = validateFilters({
      raw: { date_from: 'not-a-date' },
      schema,
      tokenMap: { date_from: ['yesterday'] }
    });
    assert.deepEqual(result.filters, {});
    assert.deepEqual(result.unmatchedTokens, ['yesterday']);
  });

  await runCase('validateFilters: surfaces _unmatched sentinel from model', () => {
    const schema = REPORT_FILTER_SCHEMAS['revenue-by-driver'];
    const result = validateFilters({
      raw: { driver_name: 'Smith' },
      schema,
      tokenMap: { driver_name: ['Smith'], _unmatched: ['cdl-A trucks', 'overweight'] }
    });
    assert.deepEqual(result.filters, { driver_name: 'Smith' });
    assert.deepEqual(new Set(result.unmatchedTokens), new Set(['cdl-A trucks', 'overweight']));
  });

  await runCase('validateFilters: caps unmatched tokens to MAX_UNMATCHED', () => {
    const schema = REPORT_FILTER_SCHEMAS['revenue-by-driver'];
    const tokens = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const result = validateFilters({
      raw: {},
      schema,
      tokenMap: { _unmatched: tokens }
    });
    assert.equal(result.unmatchedTokens.length, MAX_UNMATCHED);
  });

  await runCase('validateFilters: tolerates missing/non-array tokenMap entries', () => {
    const schema = REPORT_FILTER_SCHEMAS['revenue-by-driver'];
    const result = validateFilters({
      raw: { unknown: 'x' },
      schema,
      tokenMap: { unknown: 'not an array' }
    });
    assert.deepEqual(result.unmatchedTokens, []);
  });

  // ── system blocks (prompt caching) ─────────────────────────────────────
  await runCase('buildSystemBlocks: produces two ephemeral cached text blocks', () => {
    const schema = REPORT_FILTER_SCHEMAS['revenue-by-driver'];
    const blocks = buildSystemBlocks('revenue-by-driver', schema);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'text');
    assert.equal(blocks[0].cache_control.type, 'ephemeral');
    assert.ok(blocks[0].text.length > 0, 'system prompt loaded from disk');
    assert.equal(blocks[1].type, 'text');
    assert.equal(blocks[1].cache_control.type, 'ephemeral');
    assert.match(blocks[1].text, /revenue-by-driver/);
    assert.match(blocks[1].text, /driver_name/);
    assert.match(blocks[1].text, /exclude_team_leads/);
  });

  await runCase('buildSchemaBlock: lists keys with type descriptions', () => {
    const schema = REPORT_FILTER_SCHEMAS['total-revenue'];
    const block = buildSchemaBlock('total-revenue', schema);
    assert.match(block, /date_from: ISO date/);
    assert.match(block, /status: array of strings/);
  });

  await runCase('buildUserMessage: serialises only per-call payload', () => {
    const msg = buildUserMessage({
      naturalQuery: 'last month',
      currentFilters: { status: ['active'] },
      todayIso: '2026-05-04'
    });
    const parsed = JSON.parse(msg);
    assert.deepEqual(parsed, {
      today: '2026-05-04',
      currentFilters: { status: ['active'] },
      naturalQuery: 'last month'
    });
  });

  // ── handler: happy path ────────────────────────────────────────────────
  await runCase('handler: happy path returns validated filters + meta', async () => {
    const anthropic = makeMockAnthropic({
      filters: {
        date_from: '2026-04-01',
        date_to: '2026-04-30',
        exclude_team_leads: true,
        min_revenue: 1000
      },
      tokenMap: {
        date_from: ['last month'],
        date_to: ['last month'],
        exclude_team_leads: ['team leads'],
        min_revenue: ['$1000']
      },
      confidence: 0.85
    }, {
      usage: {
        input_tokens: 30,
        output_tokens: 90,
        cache_creation_input_tokens: 1500,
        cache_read_input_tokens: 0
      }
    });
    const req = makeReq();
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.fallback, false);
    assert.deepEqual(res.body.filters, {
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      exclude_team_leads: true,
      min_revenue: 1000
    });
    assert.deepEqual(res.body.unmatchedTokens, []);
    assert.equal(res.body.confidence, 0.85);
    assert.equal(res.body.meta.reportKey, 'revenue-by-driver');
    assert.equal(res.body.meta.cacheWriteTokens, 1500);
    assert.equal(res.body.meta.cacheReadTokens, 0);

    // Verify prompt-caching wiring: system blocks include cache_control,
    // temperature is 0 (deterministic), and Haiku model is used.
    const call = anthropic.calls[0];
    assert.ok(Array.isArray(call.system));
    assert.equal(call.system[0].cache_control.type, 'ephemeral');
    assert.equal(call.system[1].cache_control.type, 'ephemeral');
    assert.equal(call.temperature, 0);
    assert.match(call.model, /haiku/i);
  });

  // ── prompt caching: cache_read_input_tokens > 0 on warm call (AC) ──────
  await runCase('handler: surfaces cache_read_input_tokens on warm call', async () => {
    const anthropic = makeMockAnthropic({
      filters: { date_from: '2026-04-01', date_to: '2026-04-30' },
      tokenMap: { date_from: ['last month'], date_to: ['last month'] },
      confidence: 0.6
    }, {
      usage: {
        input_tokens: 30,
        output_tokens: 90,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1500
      }
    });
    const req = makeReq();
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.body.meta.cacheReadTokens, 1500);
    assert.equal(res.body.meta.cacheWriteTokens, 0);
  });

  // ── filter schema enforcement (AC: invalid filter drop) ─────────────────
  await runCase('handler: drops disallowed filter keys; surfaces source tokens', async () => {
    const anthropic = makeMockAnthropic({
      filters: {
        driver_name: 'Smith',
        secret_admin_filter: 'PWNED',
        sql_injection: '1=1'
      },
      tokenMap: {
        driver_name: ['Smith'],
        secret_admin_filter: ['admin secret'],
        sql_injection: ['sql shenanigans']
      },
      confidence: 0.9
    });
    const req = makeReq();
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.filters, { driver_name: 'Smith' });
    const um = new Set(res.body.unmatchedTokens);
    assert.ok(um.has('admin secret'));
    assert.ok(um.has('sql shenanigans'));
    assert.ok(!um.has('Smith'));
  });

  // ── RBAC denial (AC) ───────────────────────────────────────────────────
  await runCase('handler: 403 when caller lacks reports.view', async () => {
    const anthropic = makeMockAnthropic({ filters: {}, tokenMap: {}, confidence: 0 });
    const req = makeReq({ user: READ_ONLY_USER });
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'AI_FORBIDDEN');
    assert.equal(res.body.required, REQUIRED_PERMISSION);
    assert.equal(anthropic.calls.length, 0, 'must not call Claude on RBAC denial');
  });

  await runCase('handler: 403 when no req.user at all', async () => {
    const anthropic = makeMockAnthropic({ filters: {}, tokenMap: {}, confidence: 0 });
    const req = makeReq({ user: undefined });
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.statusCode, 403);
    assert.equal(anthropic.calls.length, 0);
  });

  await runCase('handler: super_admin bypasses explicit permission', async () => {
    const anthropic = makeMockAnthropic({
      filters: { date_from: '2026-04-01', date_to: '2026-04-30' },
      tokenMap: { date_from: ['last month'], date_to: ['last month'] },
      confidence: 0.7
    });
    const req = makeReq({ user: SUPER_ADMIN_USER });
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.equal(Object.keys(res.body.filters).length, 2);
  });

  // ── 400s ──────────────────────────────────────────────────────────────
  await runCase('handler: 400 on missing reportKey', async () => {
    const anthropic = makeMockAnthropic({ filters: {}, tokenMap: {}, confidence: 0 });
    const req = makeReq({ body: { naturalQuery: 'q' } });
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    assert.equal(anthropic.calls.length, 0);
  });

  await runCase('handler: 400 on unknown reportKey (not in REPORT_FILTER_SCHEMAS)', async () => {
    const anthropic = makeMockAnthropic({ filters: {}, tokenMap: {}, confidence: 0 });
    const req = makeReq({
      body: { reportKey: 'no-such-report', naturalQuery: 'q' }
    });
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_UNKNOWN_REPORT');
    assert.equal(anthropic.calls.length, 0);
  });

  // ── degraded paths (never 500) ────────────────────────────────────────
  await runCase('handler: unparseable model output → fallback (200, empty filters)', async () => {
    const anthropic = makeRawAnthropic('definitely not json {{{');
    const req = makeReq();
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.fallback, true);
    assert.deepEqual(res.body.filters, {});
    assert.deepEqual(res.body.unmatchedTokens, []);
    assert.equal(res.body.meta.reason, 'unparseable_model_output');
  });

  await runCase('handler: anthropic upstream error → fallback (200, never 500)', async () => {
    const anthropic = makeFailingAnthropic(Object.assign(new Error('timeout'), { status: 503 }));
    const req = makeReq();
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.fallback, true);
    assert.equal(res.body.meta.reason, 'ai_upstream_error');
  });

  await runCase('handler: model returns bare filter object (no envelope) — still validates', async () => {
    const anthropic = makeMockAnthropic({
      // legacy/loose shape — handler tolerates by treating the whole object as `filters`
      driver_name: 'Smith'
    });
    const req = makeReq();
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.filters, { driver_name: 'Smith' });
  });

  await runCase('handler: empty filters returns confidence 0', async () => {
    const anthropic = makeMockAnthropic({ filters: {}, tokenMap: {}, confidence: 0 });
    const req = makeReq();
    const res = makeRes();
    await handleReportsParseQuery(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.filters, {});
    assert.equal(res.body.confidence, 0);
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
