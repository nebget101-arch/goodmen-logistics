'use strict';

/**
 * FN-1592 — Tests for loads-spreadsheet-handler.
 *
 * Runs standalone with `node` (no jest/mocha). Anthropic SDK is stubbed via
 * `deps.anthropic` so no real API calls happen. Recorded fixtures live under
 * `./fixtures/loads-spreadsheet/`.
 *
 * QA scope (FN-1593) extends this file — keep test names stable.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  handleLoadsSpreadsheetImport,
  buildSystemPrompt,
  validateAiResult,
  computeRequestHash,
  stableStringify,
  clampConfidence,
  filterEnumMapping,
  FN_LOAD_FIELDS,
  LOAD_STATUSES,
  BILLING_STATUSES,
  MAX_SAMPLE_ROWS
} = require('../loads-spreadsheet-handler');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'loads-spreadsheet');
function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

/**
 * Build a stub Anthropic client that returns the given recorded fixture
 * (raw `messages.create` response shape).
 */
function makeMockAnthropic(fixture, capture) {
  return {
    messages: {
      create: async (params) => {
        if (capture) capture.lastCall = params;
        return fixture;
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

function makeThrowingAnthropic(error) {
  return {
    messages: {
      create: async () => { throw error; }
    }
  };
}

const TENANT_ID = '11111111-2222-3333-4444-555555555555';

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

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------
async function main() {
  // eslint-disable-next-line no-console
  console.log('loads-spreadsheet-handler tests');

  // ------------------------------------------------------------------------
  // Pure helpers
  // ------------------------------------------------------------------------
  await runCase('FN_LOAD_FIELDS includes all locked fields from FN-1585', () => {
    assert.ok(Array.isArray(FN_LOAD_FIELDS));
    assert.equal(FN_LOAD_FIELDS.length, 22);
    for (const k of [
      'load_number', 'po_number', 'rate',
      'broker_name', 'broker_mc', 'broker_dot',
      'pickup_city', 'pickup_state', 'pickup_zip', 'pickup_address1', 'pickup_date',
      'delivery_city', 'delivery_state', 'delivery_zip', 'delivery_address1', 'delivery_date',
      'driver_name', 'truck_unit', 'trailer_unit',
      'status', 'billing_status', 'notes'
    ]) {
      assert.ok(FN_LOAD_FIELDS.includes(k), `missing field: ${k}`);
    }
  });

  await runCase('clampConfidence enforces [0, 1]', () => {
    assert.equal(clampConfidence(0.5), 0.5);
    assert.equal(clampConfidence(0), 0);
    assert.equal(clampConfidence(1), 1);
    assert.equal(clampConfidence(-1), 0);
    assert.equal(clampConfidence(2.7), 1);
    assert.equal(clampConfidence('not a number'), 0);
    assert.equal(clampConfidence(undefined), 0);
    assert.equal(clampConfidence(null), 0);
    assert.equal(clampConfidence(NaN), 0);
  });

  await runCase('stableStringify is deterministic regardless of key order', () => {
    const a = stableStringify({ headers: ['B', 'A'], sampleRows: [{ x: 1, y: 2 }] });
    const b = stableStringify({ sampleRows: [{ y: 2, x: 1 }], headers: ['B', 'A'] });
    assert.equal(a, b);
  });

  await runCase('computeRequestHash is stable across key reorderings', () => {
    const h1 = computeRequestHash(['Load #', 'Rate'], [{ a: 1, b: 2 }]);
    const h2 = computeRequestHash(['Load #', 'Rate'], [{ b: 2, a: 1 }]);
    assert.equal(h1, h2);
    assert.equal(h1.length, 64); // SHA-256 hex
  });

  await runCase('filterEnumMapping drops unknown values, normalizes to upper', () => {
    const out = filterEnumMapping({
      'Delivered': 'delivered',
      'Garbage':   'NOT_A_STATUS',
      'Cancelled': 'CANCELLED',
      '':          'PAID',                  // blank source key dropped
      'Hold':      ' DRAFT ',
      'Bogus':     123                      // non-string value dropped
    }, LOAD_STATUSES);
    assert.deepEqual(out, {
      'Delivered': 'DELIVERED',
      'Cancelled': 'CANCELLED',
      'Hold':      'DRAFT'
    });
  });

  // ------------------------------------------------------------------------
  // System prompt + cache_control
  // ------------------------------------------------------------------------
  await runCase('system prompt names every locked FN field', () => {
    const sys = buildSystemPrompt();
    for (const f of FN_LOAD_FIELDS) {
      assert.ok(sys.includes(`"${f}":`), `system prompt missing field "${f}"`);
    }
    assert.ok(sys.includes('multiStopPattern'));
    assert.ok(sys.includes('overallConfidence'));
    assert.ok(sys.includes('LOAD_STATUSES'));
    assert.ok(sys.includes('BILLING_STATUSES'));
  });

  await runCase('handler wraps system prompt in cache_control: ephemeral', async () => {
    const fixture = loadFixture('clean-headers');
    const capture = {};
    const deps = { anthropic: makeMockAnthropic(fixture, capture) };
    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: {
        headers: ['Load #', 'Rate'],
        sampleRows: [{ 'Load #': 'L-1', 'Rate': 1500 }],
        tenantId: TENANT_ID,
        fileName: 'test.csv'
      }
    }, res, deps);

    assert.ok(capture.lastCall, 'Anthropic.messages.create was not invoked');
    assert.ok(Array.isArray(capture.lastCall.system), 'system must be an array of text blocks');
    assert.equal(capture.lastCall.system.length, 1);
    assert.equal(capture.lastCall.system[0].type, 'text');
    assert.deepEqual(capture.lastCall.system[0].cache_control, { type: 'ephemeral' });
    assert.equal(capture.lastCall.temperature, 0.1);
    assert.equal(capture.lastCall.max_tokens, 2048);
  });

  // ------------------------------------------------------------------------
  // Validator behavior
  // ------------------------------------------------------------------------
  await runCase('validator backfills missing FN fields with null/0', () => {
    const result = validateAiResult({
      columnMapping: {
        load_number: { sourceHeader: 'Load #', confidence: 0.9 }
        // Everything else missing
      },
      multiStopPattern: 'single',
      overallConfidence: 0.9
    });
    for (const f of FN_LOAD_FIELDS) {
      assert.ok(result.columnMapping[f], `missing backfilled field ${f}`);
      assert.equal(typeof result.columnMapping[f].confidence, 'number');
    }
    assert.equal(result.columnMapping.load_number.sourceHeader, 'Load #');
    assert.equal(result.columnMapping.po_number.sourceHeader, null);
    assert.equal(result.columnMapping.po_number.confidence, 0);
  });

  await runCase('validator clamps confidences to [0, 1]', () => {
    const result = validateAiResult({
      columnMapping: {
        load_number:    { sourceHeader: 'X', confidence: 1.5 },
        po_number:      { sourceHeader: 'Y', confidence: -0.3 },
        rate:           { sourceHeader: 'Z', confidence: 'not-a-number' },
        broker_name:    { sourceHeader: 'B', confidence: 0.7 }
      },
      overallConfidence: 999
    });
    assert.equal(result.columnMapping.load_number.confidence, 1);
    assert.equal(result.columnMapping.po_number.confidence, 0);
    assert.equal(result.columnMapping.rate.confidence, 0);
    assert.equal(result.columnMapping.broker_name.confidence, 0.7);
    assert.equal(result.overallConfidence, 1);
  });

  await runCase('validator coerces unknown multiStopPattern to "single"', () => {
    const result = validateAiResult({ multiStopPattern: 'banana' });
    assert.equal(result.multiStopPattern, 'single');
  });

  await runCase('validator drops invalid status enums', () => {
    const result = validateAiResult({
      statusEnumMapping: { 'Delivered': 'DELIVERED', 'Garbage': 'INVALID' },
      billingStatusEnumMapping: { 'Paid': 'PAID', 'Bogus': 'NOPE' }
    });
    assert.deepEqual(result.statusEnumMapping, { 'Delivered': 'DELIVERED' });
    assert.deepEqual(result.billingStatusEnumMapping, { 'Paid': 'PAID' });
  });

  await runCase('validator returns full shape on null/undefined input', () => {
    const r1 = validateAiResult(null);
    const r2 = validateAiResult(undefined);
    const r3 = validateAiResult('garbage');
    for (const r of [r1, r2, r3]) {
      assert.ok(r.columnMapping);
      assert.equal(typeof r.overallConfidence, 'number');
      assert.equal(r.multiStopPattern, 'single');
      assert.deepEqual(r.warnings, []);
    }
  });

  // ------------------------------------------------------------------------
  // Fixture-driven cases — 3 broker formats
  // ------------------------------------------------------------------------
  await runCase('clean headers fixture maps every FN field with high confidence', async () => {
    const fixture = loadFixture('clean-headers');
    const deps = { anthropic: makeMockAnthropic(fixture) };
    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: {
        headers: ['Load #', 'PO #', 'Rate', 'Broker', 'Broker MC', 'Pickup City', 'Pickup State', 'Pickup Zip', 'Pickup Address', 'Pickup Date', 'Delivery City', 'Delivery State', 'Delivery Zip', 'Delivery Address', 'Delivery Date', 'Driver', 'Truck #', 'Trailer #', 'Status', 'Billing Status', 'Notes'],
        sampleRows: [
          { 'Load #': 'L-1001', 'Rate': 1750, 'Broker': 'CH Robinson', 'Status': 'Delivered', 'Billing Status': 'Paid' }
        ],
        tenantId: TENANT_ID,
        fileName: 'broker-export-clean.csv'
      }
    }, res, deps);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.fallback, false);
    assert.equal(res.body.cacheHit, false);
    assert.ok(res.body.data);
    assert.equal(res.body.data.multiStopPattern, 'single');
    assert.equal(res.body.data.columnMapping.load_number.sourceHeader, 'Load #');
    assert.equal(res.body.data.columnMapping.broker_dot.sourceHeader, null); // not present in input
    assert.ok(res.body.data.overallConfidence > 0.9);
    assert.equal(res.body.data.statusEnumMapping['Delivered'], 'DELIVERED');
    assert.equal(res.body.data.billingStatusEnumMapping['Paid'], 'PAID');
  });

  await runCase('abbreviated headers fixture preserves abbreviations + warnings', async () => {
    const fixture = loadFixture('abbreviated-headers');
    const deps = { anthropic: makeMockAnthropic(fixture) };
    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: {
        headers: ['LD', 'PO', 'Amt', 'Brkr', 'MC', 'DOT', 'PU City', 'PU St', 'PU Zip', 'PU Addr', 'PU Date', 'DL City', 'DL St', 'DL Zip', 'DL Addr', 'DL Date', 'Drv', 'Trk', 'Trl', 'Stat', 'Bill'],
        sampleRows: [
          { 'LD': 'A-1', 'Brkr': 'XPO', 'Stat': 'Del', 'Bill': 'Pd' }
        ],
        tenantId: TENANT_ID
      }
    }, res, deps);

    assert.equal(res.body.success, true);
    assert.equal(res.body.fallback, false);
    assert.equal(res.body.data.columnMapping.load_number.sourceHeader, 'LD');
    assert.equal(res.body.data.statusEnumMapping['Del'], 'DELIVERED');
    assert.equal(res.body.data.billingStatusEnumMapping['Pd'], 'PAID');
    assert.ok(res.body.data.warnings.length >= 1);
    assert.equal(res.body.data.warnings[0].code, 'ABBREVIATED_HEADERS');
    assert.ok(res.body.data.overallConfidence < 0.9);
  });

  await runCase('multi-row stops fixture sets pattern + groupByColumn', async () => {
    const fixture = loadFixture('multi-row-stops');
    const deps = { anthropic: makeMockAnthropic(fixture) };
    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: {
        headers: ['Order Number', 'PO Number', 'Line Haul', 'Broker Name', 'Stop City', 'Stop State', 'Stop Zip', 'Stop Address', 'Stop Date', 'Driver Name', 'Tractor #', 'Trailer #', 'Load Status', 'Invoice Status', 'Comments'],
        sampleRows: [
          { 'Order Number': 'O-1', 'Stop City': 'Atlanta', 'Stop State': 'GA' },
          { 'Order Number': 'O-1', 'Stop City': 'Dallas',  'Stop State': 'TX' },
          { 'Order Number': 'O-2', 'Stop City': 'Phoenix', 'Stop State': 'AZ' }
        ],
        tenantId: TENANT_ID,
        fileName: 'multi-row-stops.csv'
      }
    }, res, deps);

    assert.equal(res.body.success, true);
    assert.equal(res.body.data.multiStopPattern, 'multi_row');
    assert.equal(res.body.data.groupByColumn, 'Order Number');
    assert.equal(res.body.data.statusEnumMapping['On Hold'], 'DRAFT');
    assert.equal(res.body.data.billingStatusEnumMapping['Awaiting BOL'], 'PENDING');
    assert.equal(res.body.data.billingStatusEnumMapping['Sent to Factor'], 'SENT_TO_FACTORING');
    assert.ok(res.body.data.warnings.find((w) => w.code === 'MULTI_ROW_STOPS'));
  });

  // ------------------------------------------------------------------------
  // Fallback paths
  // ------------------------------------------------------------------------
  await runCase('unparseable model output → fallback envelope (NOT 5xx)', async () => {
    const deps = { anthropic: makeBrokenAnthropic('this is not json at all') };
    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: {
        headers: ['x'],
        sampleRows: [{ x: 1 }],
        tenantId: TENANT_ID
      }
    }, res, deps);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.fallback, true);
    assert.equal(res.body.meta.reason, 'unparseable_model_output');
    assert.equal(res.body.data, undefined);
  });

  await runCase('Anthropic upstream error → fallback envelope (NOT 5xx)', async () => {
    const err = new Error('upstream blew up');
    err.status = 503;
    const deps = { anthropic: makeThrowingAnthropic(err) };
    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: {
        headers: ['x'],
        sampleRows: [{ x: 1 }],
        tenantId: TENANT_ID
      }
    }, res, deps);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.fallback, true);
    assert.equal(res.body.meta.reason, 'ai_upstream_error');
  });

  // ------------------------------------------------------------------------
  // Cache lookup is attempted before the AI call.
  // ------------------------------------------------------------------------
  await runCase('cache hit short-circuits the AI call', async () => {
    // Anthropic stub that fails the test if invoked.
    const aiCalls = { count: 0 };
    const anthropic = {
      messages: {
        create: async () => {
          aiCalls.count += 1;
          throw new Error('AI should not be called on cache hit');
        }
      }
    };

    const cached = {
      columnMapping: Object.fromEntries(FN_LOAD_FIELDS.map((f) => [f, { sourceHeader: null, confidence: 0 }])),
      statusEnumMapping: {},
      billingStatusEnumMapping: {},
      multiStopPattern: 'single',
      extraStopColumns: [],
      groupByColumn: null,
      warnings: [],
      overallConfidence: 0.42
    };

    // knex-like stub: returns the cached row for any (tenant, hash, method) match.
    // Mirrors the real chain: db('table').where(obj).where(col, op, val).select(...).first().
    const stubKnex = (_table) => ({
      where(_first) {
        return {
          where(_col, _op, _val) {
            return {
              select(_a, _b) {
                return { first: async () => ({ extracted_data: cached }) };
              }
            };
          }
        };
      }
    });

    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: {
        headers: ['Load #'],
        sampleRows: [{ 'Load #': 'L-1' }],
        tenantId: TENANT_ID
      }
    }, res, { anthropic, db: stubKnex });

    assert.equal(res.body.success, true);
    assert.equal(res.body.cacheHit, true);
    assert.equal(res.body.fallback, false);
    assert.deepEqual(res.body.data, cached);
    assert.equal(aiCalls.count, 0, 'AI client must NOT be called on cache hit');
  });

  await runCase('cache miss followed by AI call writes to cache', async () => {
    // Track DB writes via a stub that records inserts but returns no cached row.
    const dbWrites = [];
    const stubKnex = (_table) => ({
      where(_first) {
        return {
          where(_col, _op, _val) {
            return {
              select(_a, _b) {
                return { first: async () => null }; // cache miss
              }
            };
          }
        };
      },
      raw: async (_sql, bindings) => { dbWrites.push(bindings); }
    });
    // The real handler calls db.raw(...) — attach raw to the stub function itself.
    stubKnex.raw = async (_sql, bindings) => { dbWrites.push(bindings); };

    const fixture = loadFixture('clean-headers');
    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: {
        headers: ['Load #', 'Rate'],
        sampleRows: [{ 'Load #': 'L-99', 'Rate': 2200 }],
        tenantId: TENANT_ID
      }
    }, res, { anthropic: makeMockAnthropic(fixture), db: stubKnex });

    assert.equal(res.body.success, true);
    assert.equal(res.body.cacheHit, false);
    assert.equal(res.body.fallback, false);
    assert.equal(dbWrites.length, 1, 'cache write should fire exactly once');
    // bindings = [tenantId, hash, JSON.stringify(data), method]
    assert.equal(dbWrites[0][0], TENANT_ID);
    assert.equal(typeof dbWrites[0][1], 'string');
    assert.equal(dbWrites[0][1].length, 64);
    assert.equal(dbWrites[0][3], 'loads-spreadsheet-mapping');
  });

  await runCase('cache miss on DB unavailable falls through to AI call (no error)', async () => {
    // Default state: no @goodmen/shared db installed → getDb() returns null,
    // cache lookup silently misses, AI call proceeds.
    const fixture = loadFixture('clean-headers');
    const deps = { anthropic: makeMockAnthropic(fixture) };
    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: {
        headers: ['Load #', 'Rate'],
        sampleRows: [{ 'Load #': 'L-1', 'Rate': 1500 }],
        tenantId: TENANT_ID
      }
    }, res, deps);

    assert.equal(res.body.success, true);
    assert.equal(res.body.fallback, false);
    assert.equal(res.body.cacheHit, false);
    assert.ok(res.body.data);
  });

  // ------------------------------------------------------------------------
  // 400 validation
  // ------------------------------------------------------------------------
  await runCase('missing headers → 400', async () => {
    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: { sampleRows: [{}], tenantId: TENANT_ID }
    }, res, { anthropic: makeMockAnthropic(loadFixture('clean-headers')) });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
  });

  await runCase('empty headers array → 400', async () => {
    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: { headers: [], sampleRows: [{}], tenantId: TENANT_ID }
    }, res, { anthropic: makeMockAnthropic(loadFixture('clean-headers')) });
    assert.equal(res.statusCode, 400);
  });

  await runCase('missing tenantId → 400', async () => {
    const res = makeRes();
    await handleLoadsSpreadsheetImport({
      body: { headers: ['x'], sampleRows: [{}] }
    }, res, { anthropic: makeMockAnthropic(loadFixture('clean-headers')) });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'AI_BAD_REQUEST');
  });

  await runCase('sampleRows > 20 → 400', async () => {
    const res = makeRes();
    const tooMany = Array.from({ length: MAX_SAMPLE_ROWS + 1 }, (_, i) => ({ row: i }));
    await handleLoadsSpreadsheetImport({
      body: { headers: ['x'], sampleRows: tooMany, tenantId: TENANT_ID }
    }, res, { anthropic: makeMockAnthropic(loadFixture('clean-headers')) });
    assert.equal(res.statusCode, 400);
  });

  // ------------------------------------------------------------------------
  // Sanity: enums match goodmen-shared route
  // ------------------------------------------------------------------------
  await runCase('LOAD_STATUSES matches goodmen-shared loads-nlq enum', () => {
    const expected = ['DRAFT', 'NEW', 'CANCELLED', 'CANCELED', 'TONU', 'DISPATCHED', 'EN_ROUTE', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
    assert.deepEqual(LOAD_STATUSES, expected);
  });

  await runCase('BILLING_STATUSES matches goodmen-shared loads-nlq enum', () => {
    const expected = ['PENDING', 'CANCELLED', 'CANCELED', 'BOL_RECEIVED', 'INVOICED', 'SENT_TO_FACTORING', 'FUNDED', 'PAID'];
    assert.deepEqual(BILLING_STATUSES, expected);
  });

  // eslint-disable-next-line no-console
  console.log('all tests passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
