'use strict';

/**
 * FN-1437 (parent FN-1431): Tests for load-driver-match-handler.
 * Runs standalone with `node`. The Anthropic client is mocked via deps.anthropic.
 */

const assert = require('node:assert/strict');
const {
  handleLoadDriverMatch,
  validateRequestBody,
  preFilterCandidates,
  mergeAndRank,
  haversineMiles
} = require('../load-driver-match-handler');

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

function makeMockAnthropic(modelOutputObj, { capture } = {}) {
  return {
    messages: {
      create: async (req) => {
        if (capture) capture.lastRequest = req;
        return {
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: JSON.stringify(modelOutputObj) }]
        };
      }
    }
  };
}

function makeBrokenAnthropic(rawText) {
  return {
    messages: {
      create: async () => ({
        model: 'claude-sonnet-4-20250514',
        content: [{ type: 'text', text: rawText }]
      })
    }
  };
}

const VALID_LOAD = {
  originLat: 32.7767,
  originLng: -96.797,
  pickupAt: '2026-05-07T08:00Z',
  equipmentClass: '53FT_DRY',
  customerId: 'cust-1'
};

function driver(overrides) {
  return {
    driverId: 'd1',
    name: 'Driver One',
    lat: 32.5,
    lng: -96.9,
    hosRemainingHours: 6.5,
    equipmentClass: '53FT_DRY',
    lastLoadWithCustomer: '2026-04-12',
    ...overrides
  };
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('load-driver-match-handler tests');

  // ---- validateRequestBody ----
  {
    assert.equal(validateRequestBody(null).error, 'Request body is required');
    assert.equal(
      validateRequestBody({}).error,
      'loadId string is required'
    );
    assert.equal(
      validateRequestBody({ loadId: 'L1' }).error,
      'load object is required'
    );
    assert.equal(
      validateRequestBody({ loadId: 'L1', load: { originLat: 'x', originLng: 0, equipmentClass: '53FT_DRY' }, candidateDrivers: [{}] }).error,
      'load.originLat and load.originLng must be numbers'
    );
    assert.equal(
      validateRequestBody({ loadId: 'L1', load: { ...VALID_LOAD, equipmentClass: '' }, candidateDrivers: [{}] }).error,
      'load.equipmentClass string is required'
    );
    assert.equal(
      validateRequestBody({ loadId: 'L1', load: VALID_LOAD, candidateDrivers: [] }).error,
      'candidateDrivers array is required and must not be empty'
    );
    assert.equal(
      validateRequestBody({ loadId: 'L1', load: VALID_LOAD, candidateDrivers: [driver({})], topN: 99 }).error,
      'topN must be an integer between 1 and 10'
    );
    const ok = validateRequestBody({ loadId: 'L1', load: VALID_LOAD, candidateDrivers: [driver({})] });
    assert.equal(ok.error, undefined);
    assert.equal(ok.topN, 5);
    // eslint-disable-next-line no-console
    console.log('  ok  validateRequestBody covers all input cases');
  }

  // ---- preFilterCandidates: zero / negative HOS dropped ----
  {
    const candidates = [
      driver({ driverId: 'd-ok', hosRemainingHours: 8 }),
      driver({ driverId: 'd-zero', hosRemainingHours: 0 }),
      driver({ driverId: 'd-neg', hosRemainingHours: -1 }),
      driver({ driverId: 'd-missing', hosRemainingHours: undefined }),
      driver({ driverId: 'd-mismatch', hosRemainingHours: 4, equipmentClass: '48FT_REEFER' })
    ];
    const { eligible, dropped } = preFilterCandidates(VALID_LOAD, candidates);
    const eligibleIds = eligible.map((d) => d.driverId);
    const droppedIds = dropped.map((d) => d.driverId);
    assert.deepEqual(eligibleIds, ['d-ok', 'd-mismatch']);
    assert.deepEqual(droppedIds, ['d-zero', 'd-neg', 'd-missing']);
    for (const d of dropped) {
      assert.equal(d.reason, 'insufficient_hos');
    }
    // Equipment-mismatch eligibles are still passed to LLM (LLM must mark score 0),
    // but equipmentMatch flag is correctly false.
    const mismatch = eligible.find((e) => e.driverId === 'd-mismatch');
    assert.equal(mismatch.equipmentMatch, false);
    const ok = eligible.find((e) => e.driverId === 'd-ok');
    assert.equal(ok.equipmentMatch, true);
    assert.equal(typeof ok.distanceMiles, 'number');
    // eslint-disable-next-line no-console
    console.log('  ok  drivers with zero/negative/missing HOS dropped pre-LLM');
  }

  // ---- haversineMiles sanity ----
  {
    // Dallas (32.7767, -96.797) → Fort Worth (32.7555, -97.3308) ≈ 32mi
    const miles = haversineMiles(32.7767, -96.797, 32.7555, -97.3308);
    assert.ok(miles > 28 && miles < 36, `expected ~32mi, got ${miles}`);
    // Same point = 0
    assert.equal(haversineMiles(32, -96, 32, -96), 0);
    // eslint-disable-next-line no-console
    console.log('  ok  haversineMiles produces sane distances');
  }

  // ---- mergeAndRank: structured fields stay server-authored ----
  {
    const eligible = [
      { driverId: 'd1', hosRemaining: 8, distanceMiles: 50, equipmentMatch: true, lastLoadWithCustomer: '2026-04-12', name: 'A', equipmentClass: '53FT_DRY' },
      { driverId: 'd2', hosRemaining: 4, distanceMiles: 200, equipmentMatch: false, lastLoadWithCustomer: null, name: 'B', equipmentClass: '48FT_REEFER' }
    ];
    const aiCandidates = [
      // LLM tries to lie about distance and equipment; we ignore.
      { driverId: 'd1', score: 0.92, rationale: '50mi, 8h HOS, perfect match', distanceMiles: 9999, equipmentMatch: false },
      { driverId: 'd2', score: 0, rationale: 'Equipment mismatch — disqualified' },
      // hallucinated id ignored
      { driverId: 'fake', score: 0.99, rationale: 'ghost' }
    ];
    const ranked = mergeAndRank(aiCandidates, eligible, 5);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].driverId, 'd1');
    assert.equal(ranked[0].score, 0.92);
    assert.equal(ranked[0].distanceMiles, 50, 'distanceMiles is server-authored, not from LLM');
    assert.equal(ranked[0].equipmentMatch, true, 'equipmentMatch is server-authored, not from LLM');
    assert.equal(ranked[0].hosRemaining, 8);
    assert.equal(ranked[0].lastLoadWithCustomer, '2026-04-12');
    assert.equal(ranked[1].driverId, 'd2');
    assert.equal(ranked[1].score, 0);
    // eslint-disable-next-line no-console
    console.log('  ok  mergeAndRank ignores LLM hallucinations and keeps server-authored fields');
  }

  // ---- mergeAndRank: missing eligible drivers backfilled with score 0 ----
  {
    const eligible = [
      { driverId: 'd1', hosRemaining: 8, distanceMiles: 50, equipmentMatch: true, lastLoadWithCustomer: null },
      { driverId: 'd2', hosRemaining: 4, distanceMiles: 200, equipmentMatch: true, lastLoadWithCustomer: null }
    ];
    const aiCandidates = [{ driverId: 'd1', score: 0.9, rationale: 'closest' }];
    const ranked = mergeAndRank(aiCandidates, eligible, 5);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].driverId, 'd1');
    assert.equal(ranked[1].driverId, 'd2');
    assert.equal(ranked[1].score, 0);
    // eslint-disable-next-line no-console
    console.log('  ok  eligible drivers missing from AI response are backfilled with score 0');
  }

  // ---- mergeAndRank: topN respected ----
  {
    const eligible = Array.from({ length: 8 }, (_, i) => ({
      driverId: `d${i}`,
      hosRemaining: 8,
      distanceMiles: 50 + i,
      equipmentMatch: true,
      lastLoadWithCustomer: null
    }));
    const aiCandidates = eligible.map((d, i) => ({ driverId: d.driverId, score: 1 - i * 0.1, rationale: 'r' }));
    const ranked = mergeAndRank(aiCandidates, eligible, 3);
    assert.equal(ranked.length, 3);
    assert.equal(ranked[0].driverId, 'd0');
    // eslint-disable-next-line no-console
    console.log('  ok  topN truncation works');
  }

  // ---- handler: schema-conforming output on happy path ----
  {
    const res = makeRes();
    const capture = {};
    const aiResponse = {
      candidates: [
        { driverId: 'd-near', score: 0.95, rationale: 'closest with full HOS' },
        { driverId: 'd-far', score: 0.4, rationale: '180mi away with marginal HOS' }
      ],
      reasoning: 'd-near wins on distance.'
    };
    const deps = { anthropic: makeMockAnthropic(aiResponse, { capture }) };
    const req = {
      body: {
        loadId: 'L1',
        load: VALID_LOAD,
        candidateDrivers: [
          driver({ driverId: 'd-near', lat: 32.5, lng: -96.9, hosRemainingHours: 8 }),
          driver({ driverId: 'd-far', lat: 30.0, lng: -94.0, hosRemainingHours: 5 }),
          driver({ driverId: 'd-zero', hosRemainingHours: 0 })
        ]
      }
    };
    await handleLoadDriverMatch(req, res, deps);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.candidates));
    assert.equal(res.body.candidates.length, 2);
    for (const c of res.body.candidates) {
      assert.equal(typeof c.driverId, 'string');
      assert.equal(typeof c.score, 'number');
      assert.equal(typeof c.rationale, 'string');
      assert.equal(typeof c.hosRemaining, 'number');
      assert.ok(c.distanceMiles == null || typeof c.distanceMiles === 'number');
      assert.equal(typeof c.equipmentMatch, 'boolean');
      assert.ok(c.lastLoadWithCustomer === null || typeof c.lastLoadWithCustomer === 'string');
    }
    assert.equal(res.body.candidates[0].driverId, 'd-near');
    assert.equal(typeof res.body.reasoning, 'string');
    assert.equal(res.body.meta.eligibleCount, 2);
    assert.equal(res.body.meta.droppedCount, 1);
    assert.equal(typeof res.body.meta.processingTimeMs, 'number');

    // Verify prompt caching was enabled on the static system prompt.
    const sentReq = capture.lastRequest;
    assert.ok(Array.isArray(sentReq.system), 'system must be sent as an array of blocks for caching');
    assert.equal(sentReq.system[0].type, 'text');
    assert.equal(
      sentReq.system[0].cache_control && sentReq.system[0].cache_control.type,
      'ephemeral',
      'system block must enable ephemeral prompt caching'
    );
    // eslint-disable-next-line no-console
    console.log('  ok  happy path returns schema-conforming output and uses prompt caching');
  }

  // ---- handler: all drivers ineligible → empty candidates, no LLM call ----
  {
    const res = makeRes();
    let llmCalled = false;
    const deps = {
      anthropic: {
        messages: {
          create: async () => {
            llmCalled = true;
            return { model: 'x', content: [{ type: 'text', text: '{}' }] };
          }
        }
      }
    };
    const req = {
      body: {
        loadId: 'L2',
        load: VALID_LOAD,
        candidateDrivers: [
          driver({ driverId: 'a', hosRemainingHours: 0 }),
          driver({ driverId: 'b', hosRemainingHours: -2 })
        ]
      }
    };
    await handleLoadDriverMatch(req, res, deps);
    assert.equal(llmCalled, false, 'LLM must not be called when all drivers are ineligible');
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.candidates, []);
    assert.equal(res.body.meta.eligibleCount, 0);
    assert.equal(res.body.meta.droppedCount, 2);
    // eslint-disable-next-line no-console
    console.log('  ok  zero eligible drivers short-circuits before LLM');
  }

  // ---- handler: bad input returns 400 ----
  {
    const res = makeRes();
    await handleLoadDriverMatch({ body: {} }, res, { anthropic: makeMockAnthropic({}) });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    // eslint-disable-next-line no-console
    console.log('  ok  bad input returns 400');
  }

  // ---- handler: unparseable model output returns 502 ----
  {
    const res = makeRes();
    const deps = { anthropic: makeBrokenAnthropic('not json at all') };
    await handleLoadDriverMatch({
      body: {
        loadId: 'L3',
        load: VALID_LOAD,
        candidateDrivers: [driver({ driverId: 'd1' })]
      }
    }, res, deps);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_PARSE_ERROR');
    // eslint-disable-next-line no-console
    console.log('  ok  unparseable AI output returns AI_PARSE_ERROR (502)');
  }

  // ---- handler: AI upstream throws → 502 AI_UNAVAILABLE ----
  {
    const res = makeRes();
    const deps = {
      anthropic: {
        messages: {
          create: async () => {
            const err = new Error('boom');
            err.status = 503;
            throw err;
          }
        }
      }
    };
    await handleLoadDriverMatch({
      body: {
        loadId: 'L4',
        load: VALID_LOAD,
        candidateDrivers: [driver({ driverId: 'd1' })]
      }
    }, res, deps);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'AI_UNAVAILABLE');
    // eslint-disable-next-line no-console
    console.log('  ok  AI upstream failure returns AI_UNAVAILABLE (502)');
  }

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
