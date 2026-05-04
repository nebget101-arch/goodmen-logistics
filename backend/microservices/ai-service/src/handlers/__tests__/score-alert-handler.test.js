'use strict';

/**
 * FN-1159: Tests for score-alert-handler.
 * Runs standalone with `node`. No jest/mocha required.
 * The Anthropic client is mocked via deps.anthropic so no real API calls are made.
 */

const assert = require('node:assert/strict');
const {
  handleScoreAlert
} = require('../score-alert-handler');
const {
  computeBaseScore,
  combineScore,
  clampSeverity,
  clampBoost,
  validateAlert,
  TYPE_DEFAULT_BASELINE,
  SUPPORTED_TYPES
} = require('../../services/severity-scorer');

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

function makeMockAnthropic(modelOutputObj) {
  return {
    messages: {
      create: async () => ({
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: JSON.stringify(modelOutputObj) }]
      })
    }
  };
}

function makeBrokenAnthropic(rawText) {
  return {
    messages: {
      create: async () => ({
        model: 'claude-haiku-4-5-20251001',
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

function alertEnvelope(overrides) {
  return {
    tenantId: 'tenant-1',
    alert: Object.assign(
      {
        id: 'hos:driver-1:2026-05-04T12:00:00Z',
        type: 'hos_imminent',
        subjectId: 'driver-1',
        subjectKind: 'driver',
        facts: {
          driverName: 'Jane Smith',
          minutesRemaining: 25,
          windowType: 'driving'
        }
      },
      overrides || {}
    )
  };
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

async function main() {
  // eslint-disable-next-line no-console
  console.log('score-alert-handler tests');

  // ---- pure scorer ----

  await runCase('SUPPORTED_TYPES is frozen and complete', () => {
    assert.ok(Object.isFrozen(SUPPORTED_TYPES));
    assert.deepEqual(
      [...SUPPORTED_TYPES].sort(),
      ['fatigue', 'hos_imminent', 'inspection_overdue', 'late_load_risk']
    );
  });

  await runCase('clampSeverity caps at 0 and 100, rounds to int', () => {
    assert.equal(clampSeverity(-5), 0);
    assert.equal(clampSeverity(0), 0);
    assert.equal(clampSeverity(50.4), 50);
    assert.equal(clampSeverity(50.6), 51);
    assert.equal(clampSeverity(100), 100);
    assert.equal(clampSeverity(150), 100);
    assert.equal(clampSeverity(NaN), 0);
  });

  await runCase('clampBoost caps at -10 and +20', () => {
    assert.equal(clampBoost(-50), -10);
    assert.equal(clampBoost(-10), -10);
    assert.equal(clampBoost(0), 0);
    assert.equal(clampBoost(15), 15);
    assert.equal(clampBoost(20), 20);
    assert.equal(clampBoost(40), 20);
    assert.equal(clampBoost('not a number'), 0);
  });

  await runCase('combineScore sums base + boost and clamps', () => {
    assert.equal(combineScore({ baseScore: 80, boost: 15 }), 95);
    assert.equal(combineScore({ baseScore: 90, boost: 20 }), 100);
    assert.equal(combineScore({ baseScore: 90, boost: -100 }), 80); // boost clamped to -10
    assert.equal(combineScore({ baseScore: 5, boost: -10 }), 0);
  });

  await runCase('hos_imminent baseline scales with minutesRemaining', () => {
    assert.equal(
      computeBaseScore({ type: 'hos_imminent', facts: { minutesRemaining: 10 } }),
      95
    );
    assert.equal(
      computeBaseScore({ type: 'hos_imminent', facts: { minutesRemaining: 25 } }),
      90
    );
    assert.equal(
      computeBaseScore({ type: 'hos_imminent', facts: { minutesRemaining: 60 } }),
      85
    );
    assert.equal(
      computeBaseScore({ type: 'hos_imminent', facts: { minutesRemaining: 200 } }),
      75
    );
    assert.equal(
      computeBaseScore({ type: 'hos_imminent', facts: { minutesRemaining: 999 } }),
      70
    );
    // Missing facts falls back to default baseline
    assert.equal(
      computeBaseScore({ type: 'hos_imminent', facts: {} }),
      TYPE_DEFAULT_BASELINE.hos_imminent
    );
  });

  await runCase('fatigue uses fatigueScore when present, falls back to dutyHours', () => {
    assert.equal(
      computeBaseScore({ type: 'fatigue', facts: { fatigueScore: 88 } }),
      88
    );
    // Floor at 50, ceiling at 95
    assert.equal(
      computeBaseScore({ type: 'fatigue', facts: { fatigueScore: 10 } }),
      50
    );
    assert.equal(
      computeBaseScore({ type: 'fatigue', facts: { fatigueScore: 99 } }),
      95
    );
    assert.equal(
      computeBaseScore({ type: 'fatigue', facts: { consecutiveDutyHours: 13 } }),
      80
    );
    assert.equal(
      computeBaseScore({ type: 'fatigue', facts: { consecutiveDutyHours: 11 } }),
      70
    );
    assert.equal(
      computeBaseScore({ type: 'fatigue', facts: { consecutiveDutyHours: 5 } }),
      50
    );
    assert.equal(
      computeBaseScore({ type: 'fatigue', facts: {} }),
      TYPE_DEFAULT_BASELINE.fatigue
    );
  });

  await runCase('inspection_overdue baseline scales with daysOverdue', () => {
    assert.equal(
      computeBaseScore({ type: 'inspection_overdue', facts: { daysOverdue: 45 } }),
      90
    );
    assert.equal(
      computeBaseScore({ type: 'inspection_overdue', facts: { daysOverdue: 14 } }),
      80
    );
    assert.equal(
      computeBaseScore({ type: 'inspection_overdue', facts: { daysOverdue: 7 } }),
      70
    );
    assert.equal(
      computeBaseScore({ type: 'inspection_overdue', facts: { daysOverdue: 1 } }),
      65
    );
    assert.equal(
      computeBaseScore({ type: 'inspection_overdue', facts: {} }),
      TYPE_DEFAULT_BASELINE.inspection_overdue
    );
  });

  await runCase('late_load_risk baseline scales with etaDelta', () => {
    assert.equal(
      computeBaseScore({ type: 'late_load_risk', facts: { etaDelta: 300 } }),
      80
    );
    assert.equal(
      computeBaseScore({ type: 'late_load_risk', facts: { etaDelta: 120 } }),
      70
    );
    assert.equal(
      computeBaseScore({ type: 'late_load_risk', facts: { etaDelta: 60 } }),
      60
    );
    assert.equal(
      computeBaseScore({ type: 'late_load_risk', facts: { etaDelta: 30 } }),
      55
    );
    assert.equal(
      computeBaseScore({ type: 'late_load_risk', facts: { etaDelta: 5 } }),
      50
    );
    assert.equal(
      computeBaseScore({ type: 'late_load_risk', facts: {} }),
      TYPE_DEFAULT_BASELINE.late_load_risk
    );
  });

  await runCase('validateAlert rejects missing fields and unsupported types', () => {
    assert.equal(validateAlert(null).valid, false);
    assert.equal(validateAlert({}).valid, false);
    assert.equal(validateAlert({ id: 'a' }).valid, false);
    assert.equal(validateAlert({ id: 'a', type: 'unknown' }).valid, false);
    assert.equal(
      validateAlert({ id: 'a', type: 'hos_imminent', subjectKind: 'wat' }).valid,
      false
    );
    assert.equal(
      validateAlert({ id: 'a', type: 'hos_imminent', facts: [] }).valid,
      false
    );
    assert.equal(validateAlert({ id: 'a', type: 'hos_imminent' }).valid, true);
  });

  // ---- handler ----

  await runCase('happy path uses base + boost from Claude', async () => {
    const res = makeRes();
    const deps = {
      anthropic: makeMockAnthropic({
        boost: 5,
        reasoning: 'Driver Jane Smith has 25 min before HOS violation.',
        action: 'Call driver to confirm parking plan'
      })
    };
    await handleScoreAlert({ body: alertEnvelope() }, res, deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.severity, 95); // base 90 + boost 5
    assert.equal(res.body.meta.baseScore, 90);
    assert.equal(res.body.meta.boost, 5);
    assert.equal(res.body.meta.scoredBy, 'ai');
    assert.equal(typeof res.body.reasoning, 'string');
    assert.equal(typeof res.body.action, 'string');
    assert.ok(res.body.reasoning.length <= 160);
    assert.ok(res.body.action.length <= 80);
  });

  await runCase('boost is clamped between -10 and +20', async () => {
    const res = makeRes();
    const deps = {
      anthropic: makeMockAnthropic({
        boost: 999,
        reasoning: 'Compounding risk: holiday traffic, high-value load.',
        action: 'Reroute load via alternate corridor'
      })
    };
    await handleScoreAlert({ body: alertEnvelope() }, res, deps);
    assert.equal(res.body.severity, 100); // base 90 + clamped 20 = 110 -> 100
    assert.equal(res.body.meta.boost, 20);
  });

  await runCase('negative boost lowers severity but not below 0', async () => {
    const res = makeRes();
    const deps = {
      anthropic: makeMockAnthropic({
        boost: -10,
        reasoning: 'Driver already off-duty; alert is stale.',
        action: 'Dismiss alert if confirmed off-duty'
      })
    };
    await handleScoreAlert({ body: alertEnvelope() }, res, deps);
    assert.equal(res.body.severity, 80); // 90 - 10 = 80
    assert.equal(res.body.meta.boost, -10);
  });

  await runCase('unparseable Claude output falls back to base score', async () => {
    const res = makeRes();
    const deps = { anthropic: makeBrokenAnthropic('not json at all') };
    await handleScoreAlert({ body: alertEnvelope() }, res, deps);
    assert.equal(res.body.severity, 90); // base only
    assert.equal(res.body.meta.scoredBy, 'rules:unparseable-ai-response');
    assert.ok(res.body.reasoning); // canned fallback
    assert.ok(res.body.action);
  });

  await runCase('Claude upstream error falls back to base score', async () => {
    const res = makeRes();
    const err = new Error('upstream timeout');
    err.status = 503;
    const deps = { anthropic: makeFailingAnthropic(err) };
    await handleScoreAlert({ body: alertEnvelope() }, res, deps);
    assert.equal(res.body.severity, 90);
    assert.equal(res.body.meta.scoredBy, 'rules:ai-error');
  });

  await runCase('missing alert returns 400', async () => {
    const res = makeRes();
    await handleScoreAlert(
      { body: { tenantId: 'tenant-1' } },
      res,
      { anthropic: makeMockAnthropic({}) }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
  });

  await runCase('unsupported alert type returns 400', async () => {
    const res = makeRes();
    await handleScoreAlert(
      {
        body: {
          tenantId: 'tenant-1',
          alert: { id: 'x', type: 'definitely_not_a_type', facts: {} }
        }
      },
      res,
      { anthropic: makeMockAnthropic({}) }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
  });

  await runCase('truncates over-long reasoning and action', async () => {
    const res = makeRes();
    const longReasoning = 'x'.repeat(500);
    const longAction = 'y'.repeat(500);
    const deps = {
      anthropic: makeMockAnthropic({
        boost: 0,
        reasoning: longReasoning,
        action: longAction
      })
    };
    await handleScoreAlert({ body: alertEnvelope() }, res, deps);
    assert.ok(res.body.reasoning.length <= 160);
    assert.ok(res.body.action.length <= 80);
  });

  await runCase('inspection_overdue alert path produces sensible base score', async () => {
    const res = makeRes();
    const deps = {
      anthropic: makeMockAnthropic({
        boost: 0,
        reasoning: 'Truck 47 inspection 18 days overdue.',
        action: 'Pull truck 47 from service'
      })
    };
    await handleScoreAlert(
      {
        body: alertEnvelope({
          id: 'inspection:vehicle-47',
          type: 'inspection_overdue',
          subjectId: 'vehicle-47',
          subjectKind: 'vehicle',
          facts: { unit: 'Truck 47', daysOverdue: 18, inspectionType: 'annual' }
        })
      },
      res,
      deps
    );
    assert.equal(res.body.meta.baseScore, 80);
    assert.equal(res.body.severity, 80);
    assert.equal(res.body.meta.scoredBy, 'ai');
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
