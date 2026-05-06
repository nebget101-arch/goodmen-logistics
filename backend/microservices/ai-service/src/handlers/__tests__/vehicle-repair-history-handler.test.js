'use strict';

/**
 * FN-1445 / FN-1433: Tests for vehicle-repair-history-handler.
 * Runs standalone with `node`. The Anthropic client is mocked via deps.anthropic
 * so no real API calls are made.
 */

const assert = require('node:assert/strict');
const {
  handleVehicleRepairHistorySummary,
  RISK_LEVELS,
  STATIC_SYSTEM_PROMPT,
  validateResult,
  normalizeHistoryRow,
  parseAiResponse,
  cacheKey,
  clearCache
} = require('../vehicle-repair-history-handler');

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

function makeMockAnthropic({ output, capture, usage }) {
  return {
    messages: {
      create: async (args) => {
        if (capture) capture.lastArgs = args;
        return {
          model: 'claude-haiku-4-5-20251001',
          content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }],
          usage: usage || { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 }
        };
      }
    }
  };
}

async function runShortCircuitCases() {
  // history.length < 2 → no LLM call, returns "Not enough history".
  const capture = { lastArgs: null };
  const deps = { anthropic: makeMockAnthropic({ output: { should: 'not be called' }, capture }) };

  // Empty history.
  {
    const res = makeRes();
    await handleVehicleRepairHistorySummary(
      { body: { vin: '1FUJGHDV0CLBT1234', history: [] } },
      res,
      deps
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.summary, 'Not enough history');
    assert.deepEqual(res.body.data.recurringIssues, []);
    assert.equal(res.body.data.comebackRisk, 'low');
    assert.equal(res.body.meta.shortCircuited, true);
    assert.equal(res.body.meta.rowsAnalyzed, 0);
    assert.equal(capture.lastArgs, null, 'LLM must not be called for empty history');
    // eslint-disable-next-line no-console
    console.log('  ok  short-circuit on empty history');
  }

  // history with 1 row → still short-circuits.
  {
    const res = makeRes();
    await handleVehicleRepairHistorySummary(
      {
        body: {
          vin: '1FUJGHDV0CLBT1234',
          history: [{ id: 'wo-1', date: '2026-04-01', complaint: 'Brake noise' }]
        }
      },
      res,
      deps
    );
    assert.equal(res.body.data.summary, 'Not enough history');
    assert.equal(res.body.meta.shortCircuited, true);
    assert.equal(res.body.meta.rowsAnalyzed, 1);
    assert.equal(capture.lastArgs, null, 'LLM must not be called for thin history');
    // eslint-disable-next-line no-console
    console.log('  ok  short-circuit on 1-row history');
  }
}

async function runHappyPath() {
  clearCache();
  const capture = { lastArgs: null };
  const deps = {
    anthropic: makeMockAnthropic({
      output: {
        summary: 'Repeat DEF system faults; high comeback risk.',
        recurringIssues: [
          {
            pattern: 'DEF system faults',
            occurrences: 3,
            workOrderIds: ['wo-1', 'wo-2', 'wo-3']
          }
        ],
        comebackRisk: 'high'
      },
      capture,
      usage: { cache_creation_input_tokens: 1500, cache_read_input_tokens: 0 }
    })
  };

  const res = makeRes();
  await handleVehicleRepairHistorySummary(
    {
      body: {
        vin: '1FUJGHDV0CLBT1234',
        history: [
          { id: 'wo-1', date: '2026-04-01', complaint: 'DEF light on', diagnosis: 'NOx sensor' },
          { id: 'wo-2', date: '2026-04-25', complaint: 'DEF system fault', diagnosis: 'NOx sensor' },
          { id: 'wo-3', date: '2026-05-04', complaint: 'DEF derate' }
        ]
      }
    },
    res,
    deps
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.cached, false);
  assert.equal(res.body.data.comebackRisk, 'high');
  assert.equal(res.body.data.recurringIssues.length, 1);
  assert.equal(res.body.data.recurringIssues[0].pattern, 'DEF system faults');
  assert.deepEqual(res.body.data.recurringIssues[0].workOrderIds, ['wo-1', 'wo-2', 'wo-3']);
  assert.equal(res.body.meta.rowsAnalyzed, 3);
  assert.equal(res.body.meta.shortCircuited, false);
  assert.equal(res.body.meta.cacheCreationInputTokens, 1500);
  assert.equal(typeof res.body.meta.processingTimeMs, 'number');

  // Verify the prompt cache header was set on the system block.
  assert.ok(capture.lastArgs, 'LLM was called');
  assert.ok(Array.isArray(capture.lastArgs.system), 'system prompt sent as blocks for caching');
  const systemBlock = capture.lastArgs.system[0];
  assert.equal(systemBlock.type, 'text');
  assert.deepEqual(systemBlock.cache_control, { type: 'ephemeral' });
  assert.equal(systemBlock.text, STATIC_SYSTEM_PROMPT);
  // eslint-disable-next-line no-console
  console.log('  ok  happy path returns risk=high with prompt cache header set');

  // Second call with same input → should hit in-memory cache (no second LLM call).
  capture.lastArgs = null;
  const res2 = makeRes();
  await handleVehicleRepairHistorySummary(
    {
      body: {
        vin: '1FUJGHDV0CLBT1234',
        history: [
          { id: 'wo-1', date: '2026-04-01', complaint: 'DEF light on', diagnosis: 'NOx sensor' },
          { id: 'wo-2', date: '2026-04-25', complaint: 'DEF system fault', diagnosis: 'NOx sensor' },
          { id: 'wo-3', date: '2026-05-04', complaint: 'DEF derate' }
        ]
      }
    },
    res2,
    deps
  );
  assert.equal(res2.body.cached, true);
  assert.equal(res2.body.data.comebackRisk, 'high');
  assert.equal(capture.lastArgs, null, 'LLM must not be re-called when result is cached');
  // eslint-disable-next-line no-console
  console.log('  ok  second call served from in-memory cache');
}

async function runValidationCases() {
  // Missing vin.
  {
    const res = makeRes();
    await handleVehicleRepairHistorySummary({ body: { history: [] } }, res, {
      anthropic: makeMockAnthropic({ output: {} })
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    // eslint-disable-next-line no-console
    console.log('  ok  missing vin returns 400');
  }

  // history not an array.
  {
    const res = makeRes();
    await handleVehicleRepairHistorySummary(
      { body: { vin: '1FUJ', history: 'nope' } },
      res,
      { anthropic: makeMockAnthropic({ output: {} }) }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
    // eslint-disable-next-line no-console
    console.log('  ok  non-array history returns 400');
  }

  // Empty body.
  {
    const res = makeRes();
    await handleVehicleRepairHistorySummary({ body: {} }, res, {
      anthropic: makeMockAnthropic({ output: {} })
    });
    assert.equal(res.statusCode, 400);
    // eslint-disable-next-line no-console
    console.log('  ok  empty body returns 400');
  }
}

async function runSchemaValidation() {
  // validateResult drops invented WO IDs (model hallucinates an ID not in input).
  const allowed = new Set(['wo-1', 'wo-2', 'wo-3']);
  const validated = validateResult(
    {
      summary: 'A summary'.padEnd(400, 'x'), // long → should be truncated
      recurringIssues: [
        {
          pattern: 'Real pattern',
          occurrences: 3,
          workOrderIds: ['wo-1', 'wo-2', 'wo-99-fake'] // wo-99-fake not allowed
        },
        {
          pattern: 'Bad — only one ID',
          occurrences: 2,
          workOrderIds: ['wo-3']
        }
      ],
      comebackRisk: 'HIGH'
    },
    allowed
  );

  assert.ok(validated.summary.length <= 280);
  assert.equal(validated.comebackRisk, 'high');
  assert.equal(validated.recurringIssues.length, 1, 'second issue dropped (only 1 valid id)');
  assert.deepEqual(validated.recurringIssues[0].workOrderIds, ['wo-1', 'wo-2']);
  // eslint-disable-next-line no-console
  console.log('  ok  validateResult drops invented IDs and clamps fields');

  // Bogus risk → defaults to low.
  const out2 = validateResult({ comebackRisk: 'extreme' }, allowed);
  assert.equal(out2.comebackRisk, 'low');
  // eslint-disable-next-line no-console
  console.log('  ok  invalid risk level defaults to low');

  // Empty / nullish input.
  assert.deepEqual(validateResult(null, allowed), { summary: '', recurringIssues: [], comebackRisk: 'low' });
  // eslint-disable-next-line no-console
  console.log('  ok  null input returns safe defaults');
}

async function runUnparseableFallback() {
  clearCache();
  const deps = { anthropic: makeMockAnthropic({ output: 'not json at all, just prose' }) };
  const res = makeRes();
  await handleVehicleRepairHistorySummary(
    {
      body: {
        vin: 'NEWVIN9999999999',
        history: [
          { id: 'a', complaint: 'x' },
          { id: 'b', complaint: 'y' }
        ]
      }
    },
    res,
    deps
  );
  assert.equal(res.body.success, true);
  assert.equal(res.body.meta.fallback, true);
  assert.equal(res.body.meta.reason, 'unparseable_model_output');
  assert.equal(res.body.data.comebackRisk, 'low');
  // eslint-disable-next-line no-console
  console.log('  ok  unparseable model output falls back to safe defaults');
}

async function runMaxRowsCap() {
  clearCache();
  const capture = { lastArgs: null };
  const deps = {
    anthropic: makeMockAnthropic({
      output: { summary: 's', recurringIssues: [], comebackRisk: 'low' },
      capture
    })
  };
  // Send 75 rows; expect handler to cap at 50.
  const history = Array.from({ length: 75 }, (_, i) => ({
    id: `wo-${i}`,
    date: '2026-04-01',
    complaint: 'oil change'
  }));
  const res = makeRes();
  await handleVehicleRepairHistorySummary(
    { body: { vin: 'CAPVIN0000000000', history } },
    res,
    deps
  );
  assert.equal(res.body.meta.rowsAnalyzed, 50);
  // eslint-disable-next-line no-console
  console.log('  ok  history truncated to MAX_WO_ROWS (50)');
}

async function runHelpers() {
  // normalizeHistoryRow drops rows without an id.
  assert.equal(normalizeHistoryRow({ id: '' }), null);
  assert.equal(normalizeHistoryRow(null), null);
  assert.equal(normalizeHistoryRow({}), null);
  const norm = normalizeHistoryRow({
    id: 42,
    date: '2026-05-01T00:00:00Z',
    complaint: 'a'.repeat(1000),
    mileage: 'abc' // non-finite → null
  });
  assert.equal(norm.id, '42');
  assert.equal(norm.date, '2026-05-01');
  assert.equal(norm.complaint.length, 500);
  assert.equal(norm.mileage, null);
  // eslint-disable-next-line no-console
  console.log('  ok  normalizeHistoryRow trims and validates fields');

  // cacheKey is order-insensitive.
  const k1 = cacheKey('VINX', [{ id: 'a' }, { id: 'b' }]);
  const k2 = cacheKey('VINX', [{ id: 'b' }, { id: 'a' }]);
  assert.equal(k1, k2);
  // eslint-disable-next-line no-console
  console.log('  ok  cacheKey is order-insensitive on WO IDs');

  // parseAiResponse strips fences.
  assert.deepEqual(parseAiResponse('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseAiResponse('```\n{"a":2}\n```'), { a: 2 });
  // eslint-disable-next-line no-console
  console.log('  ok  parseAiResponse handles markdown fences');

  // Risk levels frozen + correct enum.
  assert.deepEqual([...RISK_LEVELS], ['low', 'medium', 'high']);
  assert.ok(Object.isFrozen(RISK_LEVELS));
  // eslint-disable-next-line no-console
  console.log('  ok  RISK_LEVELS is the expected frozen tuple');
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('vehicle-repair-history-handler tests');

  await runShortCircuitCases();
  await runHappyPath();
  await runValidationCases();
  await runSchemaValidation();
  await runUnparseableFallback();
  await runMaxRowsCap();
  await runHelpers();

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
