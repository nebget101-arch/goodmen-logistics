'use strict';

/**
 * FN-1137: Tests for reports-chat-handler.
 * Runs standalone with `node`. The Anthropic client is mocked via deps.anthropic.
 */

const assert = require('node:assert/strict');
const {
  handleReportsChat,
  hasReportsShop,
  validateRequest,
  truncateHistory,
  truncateData,
  buildSystemBlocks,
  buildMessages,
  REQUIRED_PERMISSION,
  DEFAULT_MAX_HISTORY,
  DEFAULT_MAX_DATA_ROWS,
  MAX_MESSAGE_LENGTH
} = require('../reports-chat-handler');

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

function makeMockAnthropic(replyText, options = {}) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (args) => {
        calls.push(args);
        return {
          model: options.model || 'claude-sonnet-4-6',
          content: [{ type: 'text', text: replyText }],
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

function makeFailingAnthropic(err) {
  return {
    messages: {
      create: async () => {
        throw err;
      }
    }
  };
}

const SHOP_USER = { id: 'u1', role: 'shop_manager', permissions: ['reports.shop'] };
const SUPER_ADMIN_USER = { id: 'u-root', role: 'super_admin', permissions: [] };
const VIEW_ONLY_USER = { id: 'u2', role: 'executive_read_only', permissions: ['reports.view'] };
const NO_PERM_USER = { id: 'u3', role: 'driver', permissions: [] };

const SAMPLE_BODY = {
  reportKey: 'direct-load-profit',
  filters: { period: 'last_30_days' },
  data: [
    { dispatcher: 'A', revenue: 12345, margin_pct: 0.18 },
    { dispatcher: 'B', revenue: 9800, margin_pct: 0.082 }
  ],
  history: [],
  message: 'Which dispatcher had the lowest margin?',
  summary: { totalRevenue: 22145 }
};

function makeReq(overrides = {}) {
  return Object.assign(
    { body: SAMPLE_BODY, user: SHOP_USER, headers: {} },
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
  console.log('reports-chat-handler');

  // ── permission helper ─────────────────────────────────────────────────────
  await runCase('hasReportsShop: super_admin always allowed', () => {
    assert.equal(hasReportsShop(SUPER_ADMIN_USER), true);
  });

  await runCase('hasReportsShop: explicit reports.shop allowed', () => {
    assert.equal(hasReportsShop({ permissions: ['reports.shop'] }), true);
  });

  await runCase('hasReportsShop: reports.view alone is NOT sufficient', () => {
    assert.equal(hasReportsShop(VIEW_ONLY_USER), false);
  });

  await runCase('hasReportsShop: empty perms denied', () => {
    assert.equal(hasReportsShop(NO_PERM_USER), false);
  });

  await runCase('hasReportsShop: undefined user denied', () => {
    assert.equal(hasReportsShop(undefined), false);
  });

  // ── request validation ────────────────────────────────────────────────────
  await runCase('validateRequest: rejects bad reportKey', () => {
    const r = validateRequest({ ...SAMPLE_BODY, reportKey: '../etc/passwd' });
    assert.ok(r.error);
  });

  await runCase('validateRequest: rejects missing message', () => {
    const r = validateRequest({ ...SAMPLE_BODY, message: '' });
    assert.ok(r.error);
  });

  await runCase('validateRequest: rejects non-array data', () => {
    const r = validateRequest({ ...SAMPLE_BODY, data: 'oops' });
    assert.ok(r.error);
  });

  await runCase('validateRequest: rejects non-object filters', () => {
    const r = validateRequest({ ...SAMPLE_BODY, filters: 'oops' });
    assert.ok(r.error);
  });

  await runCase('validateRequest: rejects non-array history', () => {
    const r = validateRequest({ ...SAMPLE_BODY, history: 'oops' });
    assert.ok(r.error);
  });

  await runCase('validateRequest: caps message at MAX_MESSAGE_LENGTH', () => {
    const long = 'x'.repeat(MAX_MESSAGE_LENGTH + 100);
    const r = validateRequest({ ...SAMPLE_BODY, message: long });
    assert.equal(r.message.length, MAX_MESSAGE_LENGTH);
  });

  // ── truncation: history ──────────────────────────────────────────────────
  await runCase('truncateHistory: keeps last N messages', () => {
    const big = Array.from({ length: 25 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` }));
    const out = truncateHistory(big, 10);
    assert.equal(out.length, 10);
    // Should keep the LAST 10
    assert.equal(out[0].content, 'm15');
    assert.equal(out[9].content, 'm24');
  });

  await runCase('truncateHistory: drops malformed entries', () => {
    const messy = [
      { role: 'user', content: 'ok' },
      { role: 'system', content: 'sneaky' },
      null,
      { role: 'assistant', content: '' },
      { role: 'assistant', content: 'fine' }
    ];
    const out = truncateHistory(messy, 10);
    assert.equal(out.length, 2);
    assert.equal(out[0].content, 'ok');
    assert.equal(out[1].content, 'fine');
  });

  await runCase('truncateHistory: empty/null returns []', () => {
    assert.deepEqual(truncateHistory(null, 10), []);
    assert.deepEqual(truncateHistory([], 10), []);
  });

  // ── truncation: data ──────────────────────────────────────────────────────
  await runCase('truncateData: passes through when under limit', () => {
    const rows = [{ a: 1 }, { a: 2 }];
    const out = truncateData(rows, 100);
    assert.equal(out.truncated, false);
    assert.equal(out.rows.length, 2);
    assert.equal(out.originalCount, 2);
  });

  await runCase('truncateData: slices and flags when over limit', () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ i }));
    const out = truncateData(rows, 100);
    assert.equal(out.truncated, true);
    assert.equal(out.rows.length, 100);
    assert.equal(out.originalCount, 250);
  });

  await runCase('truncateData: non-array returns empty', () => {
    const out = truncateData(null, 100);
    assert.equal(out.truncated, false);
    assert.equal(out.rows.length, 0);
  });

  // ── system blocks (prompt caching) ────────────────────────────────────────
  await runCase('buildSystemBlocks: cache_control on dataset block', () => {
    const blocks = buildSystemBlocks({
      reportKey: 'direct-load-profit',
      filters: { period: 'last_30_days' },
      summary: { totalRevenue: 22145 },
      rows: [{ dispatcher: 'A', revenue: 12345 }],
      truncated: false,
      originalCount: 1
    });
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'text');
    assert.equal(blocks[0].cache_control, undefined, 'instructions block is not cached');
    assert.equal(blocks[1].type, 'text');
    assert.equal(blocks[1].cache_control.type, 'ephemeral', 'dataset block must be cached');
    assert.match(blocks[1].text, /direct-load-profit/);
    assert.match(blocks[1].text, /totalRevenue/);
  });

  await runCase('buildMessages: appends user message after history', () => {
    const out = buildMessages(
      [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hey' }],
      'next?'
    );
    assert.equal(out.length, 3);
    assert.equal(out[2].role, 'user');
    assert.equal(out[2].content, 'next?');
  });

  // ── handler: happy path ──────────────────────────────────────────────────
  await runCase('handler: happy path returns reply, generatedAt, usage', async () => {
    const anthropic = makeMockAnthropic('Dispatcher B at 8.2% margin.', {
      usage: {
        input_tokens: 30,
        output_tokens: 90,
        cache_creation_input_tokens: 1500,
        cache_read_input_tokens: 0
      }
    });
    const req = makeReq();
    const res = makeRes();
    await handleReportsChat(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.reply, 'Dispatcher B at 8.2% margin.');
    assert.ok(res.body.generatedAt);
    assert.equal(res.body.usage.cache_creation_input_tokens, 1500);
    assert.equal(res.body.usage.cache_read_input_tokens, 0);
    assert.equal(res.body.usage._truncated, false);
    assert.equal(res.body.meta.reportKey, 'direct-load-profit');

    // Verify the call shape: cache_control on the system dataset block.
    const call = anthropic.calls[0];
    assert.ok(Array.isArray(call.system));
    assert.equal(call.system[1].cache_control.type, 'ephemeral');
    assert.equal(call.temperature, 0.2);
    // Message array should end with our user message.
    assert.equal(call.messages[call.messages.length - 1].role, 'user');
    assert.equal(call.messages[call.messages.length - 1].content, SAMPLE_BODY.message);
  });

  await runCase('handler: 2nd-turn surfaces cache_read_input_tokens (warm cache)', async () => {
    const anthropic = makeMockAnthropic('You already asked.', {
      usage: {
        input_tokens: 30,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 5200
      }
    });
    const req = makeReq({
      body: {
        ...SAMPLE_BODY,
        history: [
          { role: 'user', content: 'Which dispatcher had the lowest margin?' },
          { role: 'assistant', content: 'Dispatcher B at 8.2% margin.' }
        ],
        message: 'And the highest?'
      }
    });
    const res = makeRes();
    await handleReportsChat(req, res, { anthropic });
    assert.equal(res.body.usage.cache_read_input_tokens, 5200);
    assert.equal(res.body.usage.cache_creation_input_tokens, 0);
  });

  // ── handler: history truncation ──────────────────────────────────────────
  await runCase('handler: history truncated to default 10 messages', async () => {
    const anthropic = makeMockAnthropic('ok');
    const longHistory = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn-${i}`
    }));
    const req = makeReq({ body: { ...SAMPLE_BODY, history: longHistory } });
    const res = makeRes();
    await handleReportsChat(req, res, { anthropic });
    const sent = anthropic.calls[0].messages;
    // last 10 history messages + 1 new user message = 11
    assert.equal(sent.length, DEFAULT_MAX_HISTORY + 1);
    assert.equal(sent[0].content, 'turn-20');
    assert.equal(res.body.meta.historyMessages, DEFAULT_MAX_HISTORY);
  });

  await runCase('handler: history truncation respects AI_REPORTS_CHAT_MAX_HISTORY env', async () => {
    const anthropic = makeMockAnthropic('ok');
    const prev = process.env.AI_REPORTS_CHAT_MAX_HISTORY;
    process.env.AI_REPORTS_CHAT_MAX_HISTORY = '4';
    try {
      const req = makeReq({
        body: {
          ...SAMPLE_BODY,
          history: Array.from({ length: 12 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `t${i}`
          }))
        }
      });
      const res = makeRes();
      await handleReportsChat(req, res, { anthropic });
      assert.equal(anthropic.calls[0].messages.length, 4 + 1);
      assert.equal(res.body.meta.historyMessages, 4);
    } finally {
      if (prev === undefined) delete process.env.AI_REPORTS_CHAT_MAX_HISTORY;
      else process.env.AI_REPORTS_CHAT_MAX_HISTORY = prev;
    }
  });

  // ── handler: data truncation ─────────────────────────────────────────────
  await runCase('handler: data over threshold sets usage._truncated=true', async () => {
    const anthropic = makeMockAnthropic('ok');
    const big = Array.from({ length: DEFAULT_MAX_DATA_ROWS + 50 }, (_, i) => ({ i }));
    const req = makeReq({ body: { ...SAMPLE_BODY, data: big } });
    const res = makeRes();
    await handleReportsChat(req, res, { anthropic });
    assert.equal(res.body.usage._truncated, true);
    assert.equal(res.body.meta.rowsSent, DEFAULT_MAX_DATA_ROWS);
    assert.equal(res.body.meta.originalRowCount, DEFAULT_MAX_DATA_ROWS + 50);
  });

  await runCase('handler: data under threshold sets usage._truncated=false', async () => {
    const anthropic = makeMockAnthropic('ok');
    const req = makeReq();
    const res = makeRes();
    await handleReportsChat(req, res, { anthropic });
    assert.equal(res.body.usage._truncated, false);
  });

  // ── handler: RBAC ────────────────────────────────────────────────────────
  await runCase('handler: 403 when caller has only reports.view (escalation enforced)', async () => {
    const anthropic = makeMockAnthropic('ok');
    const req = makeReq({ user: VIEW_ONLY_USER });
    const res = makeRes();
    await handleReportsChat(req, res, { anthropic });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'AI_FORBIDDEN');
    assert.equal(res.body.required, REQUIRED_PERMISSION);
    assert.equal(anthropic.calls.length, 0, 'must not call Claude on RBAC denial');
  });

  await runCase('handler: 403 when no req.user at all', async () => {
    const anthropic = makeMockAnthropic('ok');
    const req = makeReq({ user: undefined });
    const res = makeRes();
    await handleReportsChat(req, res, { anthropic });
    assert.equal(res.statusCode, 403);
    assert.equal(anthropic.calls.length, 0);
  });

  await runCase('handler: super_admin bypasses explicit permission', async () => {
    const anthropic = makeMockAnthropic('admin reply');
    const req = makeReq({ user: SUPER_ADMIN_USER });
    const res = makeRes();
    await handleReportsChat(req, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.reply, 'admin reply');
  });

  // ── handler: bad request paths ───────────────────────────────────────────
  await runCase('handler: 400 on invalid reportKey', async () => {
    const anthropic = makeMockAnthropic('ok');
    const req = makeReq({ body: { ...SAMPLE_BODY, reportKey: '../oops' } });
    const res = makeRes();
    await handleReportsChat(req, res, { anthropic });
    assert.equal(res.statusCode, 400);
    assert.equal(anthropic.calls.length, 0);
  });

  await runCase('handler: 400 on missing message', async () => {
    const anthropic = makeMockAnthropic('ok');
    const req = makeReq({ body: { ...SAMPLE_BODY, message: '' } });
    const res = makeRes();
    await handleReportsChat(req, res, { anthropic });
    assert.equal(res.statusCode, 400);
    assert.equal(anthropic.calls.length, 0);
  });

  // ── handler: upstream errors ─────────────────────────────────────────────
  await runCase('handler: 502 when Anthropic upstream fails', async () => {
    const anthropic = makeFailingAnthropic(Object.assign(new Error('upstream'), { status: 503 }));
    const req = makeReq();
    const res = makeRes();
    await handleReportsChat(req, res, { anthropic });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_UNAVAILABLE');
  });

  await runCase('handler: 503 when AI not configured (no client, no API key)', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const req = makeReq();
      const res = makeRes();
      await handleReportsChat(req, res, { anthropic: null });
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.code, 'AI_UNCONFIGURED');
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
