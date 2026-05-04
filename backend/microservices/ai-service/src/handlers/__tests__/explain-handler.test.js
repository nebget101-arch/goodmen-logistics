'use strict';

/**
 * FN-1176: Tests for explain-handler.
 * Runs standalone with `node`. Includes end-to-end coverage that mints tokens
 * via briefing-handler and score-alert-handler then resolves them through
 * explain-handler — the same flow the frontend drill-down panel uses.
 */

const assert = require('node:assert/strict');
const { handleExplain } = require('../explain-handler');
const explainabilityStore = require('../../services/explainability-store');
const { handleBriefingGenerate, REQUIRED_SECTIONS } = require('../briefing-handler');
const { handleScoreAlert } = require('../score-alert-handler');
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
  return {
    messages: {
      create: async () => ({
        model: options.model || 'claude-sonnet-4-6',
        content: [{ type: 'text', text: JSON.stringify(modelOutputObj) }]
      })
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

const SAMPLE_BRIEFING_REQUEST = {
  tenantId: 'tenant-explain',
  date: '2026-05-04',
  metrics: { throughput: { delivered: 11, planned: 14 } }
};

const SAMPLE_ALERT_REQUEST = {
  tenantId: 'tenant-explain',
  alert: {
    id: 'hos:driver-7:2026-05-04T12:00:00Z',
    type: 'hos_imminent',
    subjectId: 'driver-7',
    subjectKind: 'driver',
    facts: { driverName: 'Jane Smith', minutesRemaining: 25 }
  }
};

async function runCase(name, fn) {
  explainabilityStore.clearAll();
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
  console.log('explain-handler tests');

  // ---- handler unit tests ----

  await runCase('400 on malformed token', async () => {
    const res = makeRes();
    await handleExplain({ params: { token: 'not-a-token' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_BAD_TOKEN');
  });

  await runCase('400 when token param missing', async () => {
    const res = makeRes();
    await handleExplain({ params: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_TOKEN');
  });

  await runCase('404 when token format is valid but unknown', async () => {
    const res = makeRes();
    const fake = 'expl_' + 'd'.repeat(32);
    await handleExplain({ params: { token: fake } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'AI_TOKEN_NOT_FOUND');
  });

  await runCase('200 returns rationale + meta for live token', async () => {
    const rationale = {
      kind: 'briefing-section',
      section: 'throughput',
      headline: '11 of 14 loads delivered today'
    };
    const token = explainabilityStore.mint(rationale);

    const res = makeRes();
    await handleExplain({ params: { token } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data, rationale);
    assert.equal(res.body.meta.token, token);
    assert.ok(res.body.meta.createdAt);
    assert.ok(res.body.meta.expiresAt);
    assert.equal(typeof res.body.meta.processingTimeMs, 'number');
  });

  await runCase('tenant-mismatch returns 404 (not 200) — defense-in-depth for FN-1177 gateway', async () => {
    const token = explainabilityStore.mint({
      kind: 'severity',
      tenantId: 'tenant-A',
      alertId: 'a:1'
    });

    const res = makeRes();
    await handleExplain(
      { params: { token }, query: { tenantId: 'tenant-B' } },
      res
    );
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'AI_TOKEN_NOT_FOUND');
  });

  await runCase('matching tenantId resolves successfully', async () => {
    const token = explainabilityStore.mint({
      kind: 'severity',
      tenantId: 'tenant-A',
      alertId: 'a:1'
    });

    const res = makeRes();
    await handleExplain(
      { params: { token }, query: { tenantId: 'tenant-A' } },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
  });

  await runCase('tenantId query is optional — direct ai-service callers (no gateway) still work', async () => {
    const token = explainabilityStore.mint({
      kind: 'severity',
      tenantId: 'tenant-A',
      alertId: 'a:1'
    });

    const res = makeRes();
    await handleExplain({ params: { token } }, res);
    assert.equal(res.statusCode, 200);
  });

  // ---- end-to-end: briefing-handler mints, explain-handler resolves ----

  await runCase('briefing-handler mints one token per section, all resolvable', async () => {
    const briefingRes = makeRes();
    await handleBriefingGenerate(
      { body: SAMPLE_BRIEFING_REQUEST },
      briefingRes,
      { anthropic: makeMockAnthropic(VALID_BRIEFING) }
    );
    assert.equal(briefingRes.statusCode, 200);
    assert.equal(briefingRes.body.success, true);

    // Each section should expose an explainabilityToken
    const seenTokens = new Set();
    for (const section of REQUIRED_SECTIONS) {
      const sectionData = briefingRes.body.data[section];
      assert.ok(
        sectionData.explainabilityToken,
        `section ${section} has explainabilityToken`
      );
      assert.match(sectionData.explainabilityToken, /^expl_[a-f0-9]{32}$/);
      seenTokens.add(sectionData.explainabilityToken);
    }
    assert.equal(seenTokens.size, REQUIRED_SECTIONS.length, 'each section gets a unique token');

    // Each token should resolve via explain-handler
    for (const section of REQUIRED_SECTIONS) {
      const token = briefingRes.body.data[section].explainabilityToken;
      const explainRes = makeRes();
      await handleExplain({ params: { token } }, explainRes);
      assert.equal(explainRes.statusCode, 200);
      assert.equal(explainRes.body.data.kind, 'briefing-section');
      assert.equal(explainRes.body.data.section, section);
      assert.equal(explainRes.body.data.tenantId, SAMPLE_BRIEFING_REQUEST.tenantId);
      assert.equal(explainRes.body.data.date, SAMPLE_BRIEFING_REQUEST.date);
      assert.ok(explainRes.body.data.headline);
      assert.ok(explainRes.body.data.detail);
      assert.ok(explainRes.body.data.sources);
    }
  });

  await runCase('cached briefing returns the same tokens on second call', async () => {
    const anthropic = makeMockAnthropic(VALID_BRIEFING);
    const r1 = makeRes();
    await handleBriefingGenerate({ body: SAMPLE_BRIEFING_REQUEST }, r1, { anthropic });
    const r2 = makeRes();
    await handleBriefingGenerate({ body: SAMPLE_BRIEFING_REQUEST }, r2, { anthropic });
    assert.equal(r2.body.cached, true);
    for (const section of REQUIRED_SECTIONS) {
      assert.equal(
        r1.body.data[section].explainabilityToken,
        r2.body.data[section].explainabilityToken
      );
    }
  });

  // ---- end-to-end: score-alert-handler mints, explain-handler resolves ----

  await runCase('score-alert success path mints resolvable severity token', async () => {
    const scoreRes = makeRes();
    await handleScoreAlert(
      { body: SAMPLE_ALERT_REQUEST },
      scoreRes,
      {
        anthropic: makeMockAnthropic({
          boost: 5,
          reasoning: 'Driver has 25 min before HOS violation.',
          action: 'Call driver to confirm parking plan'
        })
      }
    );
    assert.equal(scoreRes.statusCode, 200);
    const token = scoreRes.body.meta.explainabilityToken;
    assert.match(token, /^expl_[a-f0-9]{32}$/);

    const explainRes = makeRes();
    await handleExplain({ params: { token } }, explainRes);
    assert.equal(explainRes.statusCode, 200);
    assert.equal(explainRes.body.data.kind, 'severity');
    assert.equal(explainRes.body.data.alertId, SAMPLE_ALERT_REQUEST.alert.id);
    assert.equal(explainRes.body.data.alertType, 'hos_imminent');
    assert.equal(explainRes.body.data.scores.baseScore, 90);
    assert.equal(explainRes.body.data.scores.boost, 5);
    assert.equal(explainRes.body.data.scores.finalSeverity, 95);
    assert.equal(explainRes.body.data.sources.scoredBy, 'ai');
    assert.deepEqual(
      explainRes.body.data.rules.facts,
      SAMPLE_ALERT_REQUEST.alert.facts
    );
  });

  await runCase('score-alert no-AI fallback still mints a token', async () => {
    // Force the no-AI branch by passing no anthropic dep AND no env key
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const scoreRes = makeRes();
      await handleScoreAlert({ body: SAMPLE_ALERT_REQUEST }, scoreRes, {});
      const token = scoreRes.body.meta.explainabilityToken;
      assert.match(token, /^expl_[a-f0-9]{32}$/);
      assert.equal(scoreRes.body.meta.scoredBy, 'rules:no-anthropic');

      const explainRes = makeRes();
      await handleExplain({ params: { token } }, explainRes);
      assert.equal(explainRes.statusCode, 200);
      assert.equal(explainRes.body.data.sources.scoredBy, 'rules:no-anthropic');
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  await runCase('expired token returns 404 (30-day TTL behavior)', async () => {
    const t0 = 1_000_000_000_000;
    const token = explainabilityStore.mint(
      { kind: 'severity', note: 'will expire' },
      { now: t0, ttlMs: 1000 }
    );

    // Simulate time travel by manually evicting via get(now, large)
    explainabilityStore.purgeExpired(t0 + 5000);

    const res = makeRes();
    await handleExplain({ params: { token } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'AI_TOKEN_NOT_FOUND');
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
