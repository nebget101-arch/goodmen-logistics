'use strict';

/**
 * FN-1134: Tests for reports-anomalies-handler.
 * Runs standalone with `node`. The Anthropic client is mocked via deps.anthropic.
 */

const assert = require('node:assert/strict');
const {
  handleReportsAnomalies,
  validateRequest,
  validateAnomaly,
  validateAnomalies,
  buildSystemBlocks,
  buildUserMessage,
  hasReportsView,
  REQUIRED_PERMISSION,
  MAX_ANOMALIES
} = require('../reports-anomalies-handler');

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
          model: options.model || 'claude-sonnet-4-6',
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
        model: 'claude-sonnet-4-6',
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
  return {
    messages: {
      create: async () => {
        throw err;
      }
    }
  };
}

const VALID_OUTPUT = {
  anomalies: [
    {
      metric: 'revenue',
      value: 12345,
      deltaPct: -0.32,
      severity: 'warning',
      context: 'Below 90-day mean by 1.8 standard deviations.'
    },
    {
      metric: 'deadhead_miles',
      value: 412,
      deltaPct: 0.41,
      severity: 'critical',
      context: 'Up 41% vs prior period; concentrated in Tuesday lanes.'
    }
  ]
};

const PERMISSIVE_USER = { id: 'u1', role: 'dispatch_manager', permissions: ['reports.view', 'loads.view'] };
const SUPER_ADMIN_USER = { id: 'u-root', role: 'super_admin', permissions: [] };
const READ_ONLY_USER = { id: 'u2', role: 'driver', permissions: ['loads.view'] };

const SAMPLE_BODY = {
  data: [
    { dispatcher: 'A', revenue: 12345, deadhead_miles: 412 }
  ],
  filters: { period: 'last_30_days' },
  priorPeriod: { revenue: 18000, deadhead_miles: 290 }
};

function makeReq(overrides = {}) {
  return Object.assign(
    {
      params: { reportKey: 'dispatcher_summary' },
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
  console.log('reports-anomalies-handler');

  // ── permission helper ───────────────────────────────────────────────────
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

  // ── request validation ──────────────────────────────────────────────────
  await runCase('validateRequest: rejects bad reportKey', () => {
    const r = validateRequest({}, '../../../etc/passwd');
    assert.ok(r.error);
  });

  await runCase('validateRequest: rejects non-object body', () => {
    const r = validateRequest(null, 'dispatcher_summary');
    assert.ok(r.error);
  });

  await runCase('validateRequest: accepts minimal body', () => {
    const r = validateRequest({}, 'dispatcher_summary');
    assert.equal(r.error, undefined);
    assert.equal(r.reportKey, 'dispatcher_summary');
    assert.equal(r.data, null);
    assert.equal(r.filters, null);
    assert.equal(r.priorPeriod, null);
  });

  await runCase('validateRequest: rejects malformed filters', () => {
    const r = validateRequest({ filters: 'oops' }, 'dispatcher_summary');
    assert.ok(r.error);
  });

  // ── output validation ───────────────────────────────────────────────────
  await runCase('validateAnomaly: drops missing metric', () => {
    assert.equal(
      validateAnomaly({ value: 1, severity: 'info', context: 'x' }),
      null
    );
  });

  await runCase('validateAnomaly: drops invalid severity', () => {
    assert.equal(
      validateAnomaly({ metric: 'r', value: 1, severity: 'urgent', context: 'x' }),
      null
    );
  });

  await runCase('validateAnomaly: drops non-number value', () => {
    assert.equal(
      validateAnomaly({ metric: 'r', value: 'lots', severity: 'info', context: 'x' }),
      null
    );
  });

  await runCase('validateAnomaly: accepts null deltaPct', () => {
    const out = validateAnomaly({
      metric: 'r', value: 1, deltaPct: null, severity: 'info', context: 'x'
    });
    assert.deepEqual(out, { metric: 'r', value: 1, deltaPct: null, severity: 'info', context: 'x' });
  });

  await runCase('validateAnomalies: drops bad entries, caps to MAX_ANOMALIES', () => {
    const big = {
      anomalies: Array.from({ length: 20 }, (_, i) => ({
        metric: `m${i}`,
        value: i,
        deltaPct: 0.1,
        severity: 'info',
        context: `ctx ${i}`
      }))
    };
    const out = validateAnomalies(big);
    assert.ok(out);
    assert.equal(out.anomalies.length, MAX_ANOMALIES);
  });

  await runCase('validateAnomalies: rejects non-array .anomalies', () => {
    assert.equal(validateAnomalies({ anomalies: 'no' }), null);
  });

  // ── system blocks (prompt caching) ──────────────────────────────────────
  await runCase('buildSystemBlocks: produces two cached text blocks', () => {
    const blocks = buildSystemBlocks('dispatcher_summary');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'text');
    assert.equal(blocks[0].cache_control.type, 'ephemeral');
    assert.equal(blocks[1].type, 'text');
    assert.equal(blocks[1].cache_control.type, 'ephemeral');
    assert.match(blocks[1].text, /dispatcher_summary/);
  });

  await runCase('buildUserMessage: serialises only per-call payload', () => {
    const msg = buildUserMessage({
      reportKey: 'k',
      data: [1, 2],
      filters: { p: 1 },
      priorPeriod: null
    });
    const parsed = JSON.parse(msg);
    assert.deepEqual(parsed, { reportKey: 'k', filters: { p: 1 }, priorPeriod: null, data: [1, 2] });
  });

  // ── handler: happy path ────────────────────────────────────────────────
  await runCase('handler: returns validated anomalies on happy path', async () => {
    const anthropic = makeMockAnthropic(VALID_OUTPUT, {
      usage: {
        input_tokens: 30,
        output_tokens: 90,
        cache_creation_input_tokens: 1500,
        cache_read_input_tokens: 0
      }
    });
    const req = makeReq();
    const res = makeRes();
    await handleReportsAnomalies(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.anomalies.length, 2);
    assert.equal(res.body.anomalies[0].metric, 'revenue');
    assert.equal(res.body.meta.scoredBy, 'ai');
    assert.equal(res.body.meta.cacheWriteTokens, 1500);
    assert.equal(res.body.meta.cacheReadTokens, 0);

    // Verify the call used cache_control on system blocks (prompt caching).
    const call = anthropic.calls[0];
    assert.ok(Array.isArray(call.system));
    assert.equal(call.system[0].cache_control.type, 'ephemeral');
    assert.equal(call.system[1].cache_control.type, 'ephemeral');
    assert.equal(call.temperature, 0.1);
  });

  await runCase('handler: surfaces cache_read_input_tokens on warm call', async () => {
    const anthropic = makeMockAnthropic(VALID_OUTPUT, {
      usage: {
        input_tokens: 30,
        output_tokens: 90,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1500
      }
    });
    const req = makeReq();
    const res = makeRes();
    await handleReportsAnomalies(req, res, { anthropic });
    assert.equal(res.body.meta.cacheReadTokens, 1500);
    assert.equal(res.body.meta.cacheWriteTokens, 0);
  });

  // ── handler: malformed → empty array fallback (NOT 500) ─────────────────
  await runCase('handler: malformed Claude output collapses to empty array (200)', async () => {
    const anthropic = makeRawAnthropic('definitely not json {{{');
    const req = makeReq();
    const res = makeRes();
    await handleReportsAnomalies(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.anomalies, []);
    assert.equal(res.body.meta.scoredBy, 'rules:unparseable-ai-response');
  });

  await runCase('handler: schema-mismatched output collapses to empty array', async () => {
    const anthropic = makeRawAnthropic(JSON.stringify({ wrong: 'shape' }));
    const req = makeReq();
    const res = makeRes();
    await handleReportsAnomalies(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.anomalies, []);
    assert.equal(res.body.meta.scoredBy, 'rules:schema-mismatch');
  });

  await runCase('handler: anthropic upstream error returns empty array (not 500)', async () => {
    const anthropic = makeFailingAnthropic(Object.assign(new Error('upstream down'), { status: 503 }));
    const req = makeReq();
    const res = makeRes();
    await handleReportsAnomalies(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.anomalies, []);
    assert.equal(res.body.meta.scoredBy, 'rules:ai-error');
  });

  // ── handler: RBAC denial ───────────────────────────────────────────────
  await runCase('handler: 403 when caller lacks reports.view', async () => {
    const anthropic = makeMockAnthropic(VALID_OUTPUT);
    const req = makeReq({ user: READ_ONLY_USER });
    const res = makeRes();
    await handleReportsAnomalies(req, res, { anthropic });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'AI_FORBIDDEN');
    assert.equal(res.body.required, REQUIRED_PERMISSION);
    assert.equal(anthropic.calls.length, 0, 'must not call Claude on RBAC denial');
  });

  await runCase('handler: 403 when no req.user at all', async () => {
    const anthropic = makeMockAnthropic(VALID_OUTPUT);
    const req = makeReq({ user: undefined });
    const res = makeRes();
    await handleReportsAnomalies(req, res, { anthropic });
    assert.equal(res.statusCode, 403);
    assert.equal(anthropic.calls.length, 0);
  });

  await runCase('handler: super_admin bypasses explicit permission', async () => {
    const anthropic = makeMockAnthropic(VALID_OUTPUT);
    const req = makeReq({ user: SUPER_ADMIN_USER });
    const res = makeRes();
    await handleReportsAnomalies(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.anomalies.length, 2);
  });

  // ── handler: bad request + bad reportKey ───────────────────────────────
  await runCase('handler: 400 on invalid reportKey', async () => {
    const anthropic = makeMockAnthropic(VALID_OUTPUT);
    const req = makeReq({ params: { reportKey: '../../etc/passwd' } });
    const res = makeRes();
    await handleReportsAnomalies(req, res, { anthropic });
    assert.equal(res.statusCode, 400);
    assert.equal(anthropic.calls.length, 0);
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
