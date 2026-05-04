'use strict';

/**
 * FN-1139: Tests for briefing-handler.
 * Runs standalone with `node`. The Anthropic client is mocked via deps.anthropic.
 */

const assert = require('node:assert/strict');
const {
  handleBriefingGenerate,
  validateBriefing,
  validateRequest,
  parseAiResponse,
  REQUIRED_SECTIONS
} = require('../briefing-handler');
const briefingCache = require('../../cache/briefing-cache');

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
          content: [{ type: 'text', text: JSON.stringify(modelOutputObj) }]
        };
      }
    }
  };
}

function makeRawAnthropic(rawText) {
  return {
    messages: {
      create: async () => ({
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: rawText }]
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

const VALID_BRIEFING = {
  throughput: {
    headline: '11 of 14 loads delivered today',
    detail: '3 loads pending; pace matches plan within 1 unit.',
    metric: '11 / 14 loads'
  },
  exceptions: {
    headline: '2 open exceptions need dispatcher review',
    detail: 'Load #884 ETA-slipped 3h; Load #901 missing BOL.',
    metric: '2 open'
  },
  driverRisk: {
    headline: 'Driver Marquez near HOS limit',
    detail: 'Carlos Marquez at 9.5h on-duty; reset window opens 18:00.',
    metric: 'Marquez'
  },
  vehicleRisk: {
    headline: 'Unit 412 PM overdue',
    detail: 'Unit 412 (Volvo VNL) 1,200 mi past PM-A schedule.',
    metric: 'Unit 412'
  },
  recommendedAction: {
    headline: 'Reassign Load #884 to driver Patel before 14:00',
    detail: 'Marquez nearing HOS; Patel has 7h remaining and matching lane.',
    metric: ''
  }
};

const SAMPLE_REQUEST = {
  tenantId: 'tenant-abc',
  date: '2026-05-04',
  metrics: {
    throughput: { delivered: 11, planned: 14 },
    exceptions: [
      { loadNumber: '884', type: 'eta_slip' },
      { loadNumber: '901', type: 'missing_bol' }
    ],
    drivers: [{ name: 'Carlos Marquez', hosRemainingHours: 1.5 }],
    vehicles: [{ unit: '412', overdueDays: 12 }]
  }
};

async function runCase(name, fn) {
  briefingCache.clearAll();
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

async function main() {
  // eslint-disable-next-line no-console
  console.log('briefing-handler tests');

  assert.deepEqual(REQUIRED_SECTIONS, [
    'throughput',
    'exceptions',
    'driverRisk',
    'vehicleRisk',
    'recommendedAction'
  ]);

  await runCase('valid request returns five-section briefing', async () => {
    const res = makeRes();
    const anthropic = makeMockAnthropic(VALID_BRIEFING);
    await handleBriefingGenerate({ body: SAMPLE_REQUEST }, res, { anthropic });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.cached, false);
    for (const section of REQUIRED_SECTIONS) {
      assert.ok(res.body.data[section], `section ${section} present`);
      assert.ok(res.body.data[section].headline);
      assert.ok(res.body.data[section].detail);
    }
    assert.ok(res.body.generatedAt);
    assert.ok(res.body.meta.model);
    assert.equal(typeof res.body.meta.processingTimeMs, 'number');
    assert.equal(anthropic.calls.length, 1);
    const userMsg = anthropic.calls[0].messages[0].content;
    const parsedUserMsg = JSON.parse(userMsg);
    assert.equal(parsedUserMsg.tenantId, 'tenant-abc');
    assert.equal(parsedUserMsg.date, '2026-05-04');
  });

  await runCase('second call same tenant+date hits cache', async () => {
    const res1 = makeRes();
    const anthropic = makeMockAnthropic(VALID_BRIEFING);
    await handleBriefingGenerate({ body: SAMPLE_REQUEST }, res1, { anthropic });
    assert.equal(res1.body.cached, false);
    assert.equal(anthropic.calls.length, 1);

    const res2 = makeRes();
    await handleBriefingGenerate({ body: SAMPLE_REQUEST }, res2, { anthropic });
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.body.success, true);
    assert.equal(res2.body.cached, true);
    assert.deepEqual(res2.body.data, res1.body.data);
    assert.equal(anthropic.calls.length, 1, 'no second upstream call');
  });

  await runCase('forceRefresh bypasses cache', async () => {
    const anthropic = makeMockAnthropic(VALID_BRIEFING);
    const res1 = makeRes();
    await handleBriefingGenerate({ body: SAMPLE_REQUEST }, res1, { anthropic });
    assert.equal(anthropic.calls.length, 1);

    const res2 = makeRes();
    await handleBriefingGenerate(
      { body: { ...SAMPLE_REQUEST, forceRefresh: true } },
      res2,
      { anthropic }
    );
    assert.equal(res2.body.cached, false);
    assert.equal(anthropic.calls.length, 2);
  });

  await runCase('missing tenantId returns 400', async () => {
    const res = makeRes();
    await handleBriefingGenerate(
      { body: { date: '2026-05-04', metrics: {} } },
      res,
      { anthropic: makeMockAnthropic(VALID_BRIEFING) }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    assert.match(res.body.error, /tenantId/);
  });

  await runCase('missing date returns 400', async () => {
    const res = makeRes();
    await handleBriefingGenerate(
      { body: { tenantId: 't', metrics: {} } },
      res,
      { anthropic: makeMockAnthropic(VALID_BRIEFING) }
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /date/);
  });

  await runCase('bad date format returns 400', async () => {
    const res = makeRes();
    await handleBriefingGenerate(
      { body: { tenantId: 't', date: '05/04/2026' } },
      res,
      { anthropic: makeMockAnthropic(VALID_BRIEFING) }
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /YYYY-MM-DD/);
  });

  await runCase('non-object metrics returns 400', async () => {
    const res = makeRes();
    await handleBriefingGenerate(
      { body: { tenantId: 't', date: '2026-05-04', metrics: 'not-an-object' } },
      res,
      { anthropic: makeMockAnthropic(VALID_BRIEFING) }
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /metrics/);
  });

  await runCase('unparseable model output returns 502', async () => {
    const res = makeRes();
    await handleBriefingGenerate(
      { body: SAMPLE_REQUEST },
      res,
      { anthropic: makeRawAnthropic('not json at all') }
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_PARSE_ERROR');
  });

  await runCase('briefing missing required section returns 502', async () => {
    const incomplete = { ...VALID_BRIEFING };
    delete incomplete.recommendedAction;
    const res = makeRes();
    await handleBriefingGenerate(
      { body: SAMPLE_REQUEST },
      res,
      { anthropic: makeMockAnthropic(incomplete) }
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_SCHEMA_ERROR');
  });

  await runCase('upstream error returns 502 AI_UNAVAILABLE', async () => {
    const res = makeRes();
    const err = new Error('boom');
    err.status = 503;
    await handleBriefingGenerate(
      { body: SAMPLE_REQUEST },
      res,
      { anthropic: makeFailingAnthropic(err) }
    );
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_UNAVAILABLE');
  });

  await runCase('parseAiResponse strips markdown fences', async () => {
    const fenced = '```json\n{"a": 1}\n```';
    assert.deepEqual(parseAiResponse(fenced), { a: 1 });
  });

  await runCase('validateRequest accepts minimal valid input', async () => {
    const out = validateRequest({ tenantId: 't', date: '2026-05-04' });
    assert.equal(out.tenantId, 't');
    assert.equal(out.date, '2026-05-04');
    assert.deepEqual(out.metrics, {});
    assert.equal(out.forceRefresh, false);
  });

  await runCase('validateBriefing rejects missing detail', async () => {
    const broken = JSON.parse(JSON.stringify(VALID_BRIEFING));
    broken.throughput.detail = '';
    assert.equal(validateBriefing(broken), null);
  });

  await runCase('validateBriefing rejects empty metric on non-action section', async () => {
    const broken = JSON.parse(JSON.stringify(VALID_BRIEFING));
    broken.throughput.metric = '';
    assert.equal(validateBriefing(broken), null);
  });

  await runCase('validateBriefing accepts empty metric on recommendedAction', async () => {
    const ok = JSON.parse(JSON.stringify(VALID_BRIEFING));
    ok.recommendedAction.metric = '';
    const out = validateBriefing(ok);
    assert.ok(out);
    assert.equal(out.recommendedAction.metric, '');
  });

  await runCase('validateBriefing trims overlong fields', async () => {
    const long = JSON.parse(JSON.stringify(VALID_BRIEFING));
    long.throughput.headline = 'x'.repeat(120);
    long.throughput.detail = 'y'.repeat(400);
    long.throughput.metric = 'z'.repeat(80);
    const out = validateBriefing(long);
    assert.ok(out);
    assert.equal(out.throughput.headline.length, 60);
    assert.equal(out.throughput.detail.length, 200);
    assert.equal(out.throughput.metric.length, 30);
  });

  await runCase('cache TTL expiry triggers regeneration', async () => {
    const anthropic = makeMockAnthropic(VALID_BRIEFING);
    const res1 = makeRes();
    await handleBriefingGenerate({ body: SAMPLE_REQUEST }, res1, { anthropic });
    assert.equal(anthropic.calls.length, 1);

    briefingCache.set(
      SAMPLE_REQUEST.tenantId,
      SAMPLE_REQUEST.date,
      { data: VALID_BRIEFING, generatedAt: '2026-05-04T00:00:00Z', meta: {} },
      -1
    );

    const res2 = makeRes();
    await handleBriefingGenerate({ body: SAMPLE_REQUEST }, res2, { anthropic });
    assert.equal(res2.body.cached, false);
    assert.equal(anthropic.calls.length, 2);
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
