'use strict';

/**
 * FN-1597 — regression coverage for the AI envelope-unwrap bug and the
 * `load_ai_extractions` poisoned-cache shape-guard.
 *
 * The AI handler at /api/ai/loads/spreadsheet-import returns:
 *   { success: true, fallback: false, cacheHit: false, data: {...}, meta: {...} }
 *
 * Pre-fix, callAiColumnMapping returned the whole envelope and the cache
 * stored it, so every "cacheHit" preview replied with all-null mappings.
 *
 * Run with:
 *   cd backend/packages/goodmen-shared && node --test services/loads-import-service.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// Stub the heavyweight peers (fuel-parser, r2-storage, fuzzy) BEFORE the
// service is required, so each loadService() call picks up the stubs via
// require.cache. The db bridge is injectable at runtime.
const fuelParserPath = require.resolve('./fuel-parser');
const r2StoragePath = require.resolve('../storage/r2-storage');
const fuzzyPath = require.resolve('./fuzzy-match-service');
const servicePath = require.resolve('./loads-import-service');

let parseFileBufferImpl = () => ({ headers: ['Load #'], rows: [{ 'Load #': 'L-1' }] });
let uploadBufferImpl = async () => ({ key: 'stub-key' });

require.cache[fuelParserPath] = {
  id: fuelParserPath,
  filename: fuelParserPath,
  loaded: true,
  exports: {
    parseFileBuffer: (...a) => parseFileBufferImpl(...a)
  }
};
require.cache[r2StoragePath] = {
  id: r2StoragePath,
  filename: r2StoragePath,
  loaded: true,
  exports: {
    uploadBuffer: (...a) => uploadBufferImpl(...a),
    downloadBuffer: async () => Buffer.from('')
  }
};
require.cache[fuzzyPath] = {
  id: fuzzyPath,
  filename: fuzzyPath,
  loaded: true,
  exports: {
    matchBroker: async () => null,
    matchDriver: async () => null,
    matchVehicle: async () => null
  }
};

const dbBridge = require('../internal/db');

/**
 * Re-load the service with a fresh `query` injection. The service destructures
 * `{ query, getClient }` at module load (the project-wide pattern), so the
 * mock has to be in place before the require.
 */
function loadService(query) {
  dbBridge.setDatabase({ query, getClient: async () => ({ query: async () => ({ rows: [] }), release() {} }) });
  delete require.cache[servicePath];
  return require('./loads-import-service');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALIDATED_DATA = Object.freeze({
  columnMapping: {
    load_number: { sourceHeader: 'Load #', confidence: 0.99 }
  },
  statusEnumMapping: { delivered: 'DELIVERED' },
  billingStatusEnumMapping: { paid: 'PAID' },
  multiStopPattern: 'single',
  overallConfidence: 0.91,
  warnings: []
});

function envelope(data, { fallback = false, success = true } = {}) {
  return {
    success,
    fallback,
    cacheHit: false,
    data,
    meta: { model: 'test', processingTimeMs: 1, hash: 'abc' }
  };
}

function makeFetchStub(body, { ok = true, status = 200 } = {}) {
  return async () => ({
    ok,
    status,
    async json() { return body; }
  });
}

function makeQueryStub({ cached = null, onCacheWrite } = {}) {
  return async (sql, params) => {
    if (/^\s*SELECT extracted_data/i.test(sql)) {
      return { rows: cached ? [{ extracted_data: cached }] : [] };
    }
    if (/^\s*INSERT INTO load_ai_extractions/i.test(sql)) {
      if (onCacheWrite && params && params[2]) {
        onCacheWrite(JSON.parse(params[2]));
      }
      return { rows: [] };
    }
    if (/^\s*INSERT INTO load_import_batches/i.test(sql)) {
      return { rows: [{ id: 'batch-1' }] };
    }
    return { rows: [] };
  };
}

// ─── callAiColumnMapping — envelope unwrap ────────────────────────────────────

test('callAiColumnMapping unwraps body.data on a success envelope', async () => {
  const originalFetch = global.fetch;
  global.fetch = makeFetchStub(envelope(VALIDATED_DATA));
  try {
    const { callAiColumnMapping } = loadService(makeQueryStub());
    const result = await callAiColumnMapping({
      tenantId: 't1', headers: ['Load #'], sampleRows: [], fileName: 'a.csv'
    });
    assert.equal(result?.columnMapping?.load_number?.sourceHeader, 'Load #');
    assert.equal(result?.multiStopPattern, 'single');
    assert.equal(result?.overallConfidence, 0.91);
    // Envelope keys must NOT leak through.
    assert.equal(result?.success, undefined);
    assert.equal(result?.fallback, undefined);
    assert.equal(result?.meta, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test('callAiColumnMapping returns null on a fallback envelope', async () => {
  const originalFetch = global.fetch;
  global.fetch = makeFetchStub(envelope(VALIDATED_DATA, { fallback: true }));
  try {
    const { callAiColumnMapping } = loadService(makeQueryStub());
    const result = await callAiColumnMapping({
      tenantId: 't1', headers: ['Load #'], sampleRows: [], fileName: 'a.csv'
    });
    assert.equal(result, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('callAiColumnMapping returns null when success !== true', async () => {
  const originalFetch = global.fetch;
  global.fetch = makeFetchStub(envelope(VALIDATED_DATA, { success: false }));
  try {
    const { callAiColumnMapping } = loadService(makeQueryStub());
    const result = await callAiColumnMapping({
      tenantId: 't1', headers: ['Load #'], sampleRows: [], fileName: 'a.csv'
    });
    assert.equal(result, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('callAiColumnMapping returns null on non-2xx response', async () => {
  const originalFetch = global.fetch;
  global.fetch = makeFetchStub(null, { ok: false, status: 502 });
  try {
    const { callAiColumnMapping } = loadService(makeQueryStub());
    const result = await callAiColumnMapping({
      tenantId: 't1', headers: ['Load #'], sampleRows: [], fileName: 'a.csv'
    });
    assert.equal(result, null);
  } finally {
    global.fetch = originalFetch;
  }
});

// ─── lookupAiCache — shape-guard against poisoned envelopes ──────────────────

test('lookupAiCache treats a row with a poisoned envelope as a cache miss', async () => {
  // What the cache held pre-fix: the entire envelope, no top-level columnMapping.
  const { lookupAiCache } = loadService(makeQueryStub({ cached: envelope(VALIDATED_DATA) }));
  const result = await lookupAiCache('t1', 'hash-1');
  assert.equal(result, null);
});

test('lookupAiCache returns cached data when shape is the unwrapped payload', async () => {
  const { lookupAiCache } = loadService(makeQueryStub({ cached: VALIDATED_DATA }));
  const result = await lookupAiCache('t1', 'hash-1');
  assert.equal(result?.columnMapping?.load_number?.sourceHeader, 'Load #');
});

test('lookupAiCache returns null when cached row has no columnMapping at all', async () => {
  const { lookupAiCache } = loadService(makeQueryStub({ cached: { warnings: [] } }));
  const result = await lookupAiCache('t1', 'hash-1');
  assert.equal(result, null);
});

// ─── previewImport — end-to-end with stubbed AI envelope ──────────────────────

test('previewImport returns populated columnMapping / statusEnumMapping / multiStopPattern', async () => {
  const originalFetch = global.fetch;
  global.fetch = makeFetchStub(envelope(VALIDATED_DATA));

  let writtenCacheValue;
  const query = makeQueryStub({
    cached: null,
    onCacheWrite: (val) => { writtenCacheValue = val; }
  });
  const { previewImport } = loadService(query);

  parseFileBufferImpl = () => ({
    headers: ['Load #'],
    rows: [{ 'Load #': 'L-1' }, { 'Load #': 'L-2' }]
  });

  try {
    const out = await previewImport({
      tenantId: 't1',
      operatingEntityId: null,
      userId: 'u1',
      buffer: Buffer.from('Load #\nL-1\nL-2\n'),
      fileName: 'sample.csv',
      fileMime: 'text/csv'
    });

    assert.equal(out.cacheHit, false);
    assert.equal(out.aiUnavailable, false);
    assert.equal(out.columnMapping?.load_number?.sourceHeader, 'Load #');
    assert.deepEqual(out.statusEnumMapping, { delivered: 'DELIVERED' });
    assert.deepEqual(out.billingStatusEnumMapping, { paid: 'PAID' });
    assert.equal(out.multiStopPattern, 'single');
    assert.equal(out.overallConfidence, 0.91);
    assert.deepEqual(out.warnings, []);

    // The cache must store the unwrapped data, not the envelope.
    assert.ok(writtenCacheValue, 'cache should have been written');
    assert.ok(writtenCacheValue.columnMapping, 'cached payload should have columnMapping at top level');
    assert.equal(writtenCacheValue.success, undefined, 'envelope keys must not leak into cache');
    assert.equal(writtenCacheValue.fallback, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test('previewImport refetches AI on a poisoned-envelope cache hit', async () => {
  // Simulate the pre-fix cache state: the row exists but holds the envelope.
  // After the shape-guard, this should be treated as a miss; the AI service
  // gets a fresh call and the cache is repaired with the unwrapped payload.
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200, async json() { return envelope(VALIDATED_DATA); } };
  };

  let cacheRewritten = false;
  const query = async (sql, params) => {
    if (/^\s*SELECT extracted_data/i.test(sql)) {
      return { rows: [{ extracted_data: envelope(VALIDATED_DATA) }] }; // poisoned
    }
    if (/^\s*INSERT INTO load_ai_extractions/i.test(sql)) {
      const written = JSON.parse(params[2]);
      assert.ok(written.columnMapping, 'cache repair must store unwrapped data');
      assert.equal(written.success, undefined);
      cacheRewritten = true;
      return { rows: [] };
    }
    if (/^\s*INSERT INTO load_import_batches/i.test(sql)) return { rows: [{ id: 'batch-2' }] };
    return { rows: [] };
  };
  const { previewImport } = loadService(query);

  parseFileBufferImpl = () => ({ headers: ['Load #'], rows: [{ 'Load #': 'L-1' }] });

  try {
    const out = await previewImport({
      tenantId: 't1',
      operatingEntityId: null,
      userId: 'u1',
      buffer: Buffer.from('Load #\nL-1\n'),
      fileName: 'sample.csv',
      fileMime: 'text/csv'
    });

    assert.equal(out.cacheHit, false, 'poisoned cache must be treated as miss');
    assert.equal(out.aiUnavailable, false);
    assert.equal(out.columnMapping?.load_number?.sourceHeader, 'Load #');
    assert.equal(fetchCalls, 1, 'AI service should be called fresh on poisoned-cache miss');
    assert.equal(cacheRewritten, true, 'cache must be repaired with unwrapped data');
  } finally {
    global.fetch = originalFetch;
  }
});

test('previewImport surfaces aiUnavailable when AI returns a fallback envelope', async () => {
  const originalFetch = global.fetch;
  global.fetch = makeFetchStub(envelope(VALIDATED_DATA, { fallback: true }));

  let cacheWritten = false;
  const query = async (sql) => {
    if (/^\s*SELECT extracted_data/i.test(sql)) return { rows: [] };
    if (/^\s*INSERT INTO load_ai_extractions/i.test(sql)) {
      cacheWritten = true;
      return { rows: [] };
    }
    if (/^\s*INSERT INTO load_import_batches/i.test(sql)) return { rows: [{ id: 'batch-3' }] };
    return { rows: [] };
  };
  const { previewImport } = loadService(query);

  parseFileBufferImpl = () => ({ headers: ['Load #'], rows: [{ 'Load #': 'L-1' }] });

  try {
    const out = await previewImport({
      tenantId: 't1',
      operatingEntityId: null,
      userId: 'u1',
      buffer: Buffer.from('x'),
      fileName: 'sample.csv'
    });

    assert.equal(out.aiUnavailable, true);
    assert.equal(out.columnMapping, null);
    assert.equal(out.statusEnumMapping, null);
    assert.equal(cacheWritten, false, 'fallback responses must NOT be cached');
  } finally {
    global.fetch = originalFetch;
  }
});

// ─── FN-1601: parseImportDate ────────────────────────────────────────────────

test('parseImportDate handles ISO, MM/DD/YYYY, JS toString, and Date objects', () => {
  const { parseImportDate } = loadService(makeQueryStub());

  // Bug repro fixture: spreadsheet cell stringified as JS Date.toString()
  assert.equal(
    parseImportDate('Thu May 07 2026 00:00:00 GMT+0000 (Coordinated Universal Time)'),
    '2026-05-07'
  );
  // ISO date (DATE column form)
  assert.equal(parseImportDate('2026-05-07'), '2026-05-07');
  // ISO timestamp — must keep the calendar day, not drift in host TZ
  assert.equal(parseImportDate('2026-05-07T00:00:00.000Z'), '2026-05-07');
  // US slash format
  assert.equal(parseImportDate('5/7/2026'), '2026-05-07');
  assert.equal(parseImportDate('05/07/2026'), '2026-05-07');
  // Two-digit year → 2000s
  assert.equal(parseImportDate('5/7/26'), '2026-05-07');
  // Real Date instance (xlsx cellDates: true)
  assert.equal(parseImportDate(new Date(Date.UTC(2026, 4, 7))), '2026-05-07');

  // Empty / unparseable → null (so the DATE column stays valid)
  assert.equal(parseImportDate(''), null);
  assert.equal(parseImportDate('   '), null);
  assert.equal(parseImportDate(null), null);
  assert.equal(parseImportDate(undefined), null);
  assert.equal(parseImportDate('not a date'), null);
  assert.equal(parseImportDate(new Date('invalid')), null);
});

// ─── FN-1601: commitBatch persists dates / driver_name / mapped status ───────

const COMMIT_BATCH_AI_METADATA = Object.freeze({
  finalColumnMapping: {
    pickup_date: { sourceHeader: 'Pickup Date', confidence: 0.95 },
    delivery_date: { sourceHeader: 'Delivery Date', confidence: 0.92 },
    completed_date: { sourceHeader: 'Completed Date', confidence: 0.9 },
    driver_name: { sourceHeader: 'Driver', confidence: 0.95 },
    status: { sourceHeader: 'Status', confidence: 0.95 }
  },
  statusEnumMapping: { Delivered: 'DELIVERED', Canceled: 'CANCELED' },
  billingStatusEnumMapping: { Funded: 'FUNDED' }
});

/**
 * Build a {query, getClient} pair that simulates a staged batch ready for
 * commit. Returns the captured INSERT INTO loads param array(s) so tests can
 * assert on per-row column values without a real Postgres.
 */
function makeCommitFixture({ stagedRow, batchAiMetadata = COMMIT_BATCH_AI_METADATA }) {
  const insertedLoads = [];
  const query = async (sql, params) => {
    if (/^\s*SELECT id, tenant_id, operating_entity_id, file_name, file_hash/i.test(sql)) {
      // getBatch
      return {
        rows: [{
          id: params[0],
          tenant_id: params[1],
          status: 'staged',
          ai_metadata: batchAiMetadata,
          result_summary: null,
          storage_key: 'k'
        }]
      };
    }
    if (/^\s*SELECT id, source_row_index, raw_values, normalized_values, validation_status/i.test(sql)) {
      return {
        rows: [{
          id: 'row-1',
          source_row_index: 0,
          raw_values: stagedRow.raw_values || {},
          normalized_values: stagedRow.normalized_values,
          validation_status: stagedRow.validation_status || 'ok'
        }]
      };
    }
    if (/UPDATE load_import_batches SET status = 'failed'/i.test(sql)) return { rows: [] };
    return { rows: [] };
  };

  const getClient = async () => ({
    query: async (sql, params) => {
      if (/^\s*BEGIN/i.test(sql) || /^\s*COMMIT/i.test(sql) || /^\s*ROLLBACK/i.test(sql)) {
        return { rows: [] };
      }
      if (/^\s*SELECT id, load_number FROM loads/i.test(sql)) {
        return { rows: [] }; // no duplicate
      }
      if (/^\s*INSERT INTO loads\b/i.test(sql)) {
        insertedLoads.push(params);
        return { rows: [{ id: 'load-uuid-1' }] };
      }
      // UPDATEs to load_import_rows / load_import_batches / INSERT INTO load_stops
      return { rows: [] };
    },
    release() {}
  });

  return { query, getClient, insertedLoads };
}

function loadServiceWithClient(query, getClient) {
  dbBridge.setDatabase({ query, getClient });
  delete require.cache[servicePath];
  return require('./loads-import-service');
}

// INSERT column order from commitBatch (FN-1601):
//   $1 tenant_id, $2 operating_entity_id, $3 load_number, $4 status,
//   $5 billing_status, $6 dispatcher_user_id, $7 driver_id, $8 truck_id,
//   $9 trailer_id, $10 broker_id, $11 broker_name, $12 driver_name,
//   $13 pickup_date, $14 delivery_date, $15 completed_date,
//   $16 po_number, $17 rate, $18 notes, $19 needs_review, $20 ai_metadata
const IDX = {
  status: 3,
  billing_status: 4,
  broker_name: 10,
  driver_name: 11,
  pickup_date: 12,
  delivery_date: 13,
  completed_date: 14,
  ai_metadata: 19
};

test('commitBatch persists pickup_date/delivery_date/completed_date parsed from JS Date.toString', async () => {
  const fixture = makeCommitFixture({
    stagedRow: {
      normalized_values: {
        load_number: 'L-1',
        driver_name: 'Rishawn Williams',
        pickup_date: 'Thu May 07 2026 00:00:00 GMT+0000 (Coordinated Universal Time)',
        delivery_date: '5/9/2026',
        completed_date: '2026-05-10',
        status: 'Delivered',
        _status: 'DELIVERED',
        _billing_status: 'PENDING',
        _stops_hint: { pattern: 'single' },
        pickup_city: 'Dallas', pickup_state: 'TX' // give buildStopsFromRow a stop
      }
    }
  });
  const { commitBatch } = loadServiceWithClient(fixture.query, fixture.getClient);

  await commitBatch({ tenantId: 't1', userId: 'u1', batchId: 'batch-1' });

  assert.equal(fixture.insertedLoads.length, 1);
  const params = fixture.insertedLoads[0];
  assert.equal(params[IDX.pickup_date], '2026-05-07');
  assert.equal(params[IDX.delivery_date], '2026-05-09');
  assert.equal(params[IDX.completed_date], '2026-05-10');
});

test('commitBatch keeps the AI-mapped status even when fuzzy match is below threshold', async () => {
  // Pre-FN-1601 bug: low broker/driver score force-DRAFTed the row, throwing
  // away the AI-mapped DELIVERED status. Here both fuzzy matchers return null
  // (default stub), so maxScore=0 < threshold=0.85 → aboveThreshold=false.
  const fixture = makeCommitFixture({
    stagedRow: {
      normalized_values: {
        load_number: 'L-1',
        status: 'Delivered',
        _status: 'DELIVERED',
        _billing_status: 'FUNDED',
        _stops_hint: { pattern: 'single' },
        pickup_city: 'Dallas'
      }
    }
  });
  const { commitBatch } = loadServiceWithClient(fixture.query, fixture.getClient);

  await commitBatch({ tenantId: 't1', userId: 'u1', batchId: 'batch-1' });

  const params = fixture.insertedLoads[0];
  assert.equal(params[IDX.status], 'DELIVERED', 'mapped status must survive low FK score');
  assert.equal(params[IDX.billing_status], 'FUNDED', 'billing_status enum unchanged (regression)');
});

test('commitBatch applies stashed statusEnumMapping when stage did not pre-map _status', async () => {
  // Simulate a row where stage failed to set _status (e.g. another error
  // demoted the row to needs_review before the status branch ran). The
  // mapping is still in batch.ai_metadata.statusEnumMapping; commit should
  // recover and produce DELIVERED rather than NEW/DRAFT.
  const fixture = makeCommitFixture({
    stagedRow: {
      validation_status: 'needs_review',
      normalized_values: {
        load_number: 'L-1',
        status: 'Delivered',
        _status: null,
        _billing_status: 'PENDING',
        _stops_hint: { pattern: 'single' },
        pickup_city: 'Dallas'
      }
    }
  });
  const { commitBatch } = loadServiceWithClient(fixture.query, fixture.getClient);

  await commitBatch({ tenantId: 't1', userId: 'u1', batchId: 'batch-1' });

  const params = fixture.insertedLoads[0];
  assert.equal(params[IDX.status], 'DELIVERED');
});

test('commitBatch falls back to DRAFT and warns when mapped status is not in FN enum', async () => {
  const fixture = makeCommitFixture({
    stagedRow: {
      normalized_values: {
        load_number: 'L-1',
        status: 'AwaitingPaperwork',
        _status: null,
        _billing_status: 'PENDING',
        _stops_hint: { pattern: 'single' },
        pickup_city: 'Dallas'
      }
    }
  });
  const { commitBatch } = loadServiceWithClient(fixture.query, fixture.getClient);

  await commitBatch({ tenantId: 't1', userId: 'u1', batchId: 'batch-1' });

  const params = fixture.insertedLoads[0];
  const meta = JSON.parse(params[IDX.ai_metadata]);
  assert.equal(params[IDX.status], 'DRAFT');
  assert.ok(Array.isArray(meta.warnings) && meta.warnings.length >= 1, 'must record a warning');
  assert.match(meta.warnings[0], /AwaitingPaperwork/);
});

test('commitBatch writes raw driver_name text when fuzzy match returns no driver_id', async () => {
  const fixture = makeCommitFixture({
    stagedRow: {
      normalized_values: {
        load_number: 'L-1',
        driver_name: 'Rishawn Williams',
        _status: 'NEW',
        _billing_status: 'PENDING',
        _stops_hint: { pattern: 'single' },
        pickup_city: 'Dallas'
      }
    }
  });
  const { commitBatch } = loadServiceWithClient(fixture.query, fixture.getClient);

  await commitBatch({ tenantId: 't1', userId: 'u1', batchId: 'batch-1' });

  const params = fixture.insertedLoads[0];
  assert.equal(params[IDX.driver_name], 'Rishawn Williams');
});

// ─── FN-1609: stop_date coercion in load_stops INSERT ────────────────────────

test('commitBatch persists stop_date as ISO when normalized pickup/delivery dates arrive in JS Date.toString form', async () => {
  // Pre-fix, buildStopsFromRow passed the raw string straight through and the
  // load_stops INSERT 500'd with `invalid input syntax for type date: ...`,
  // aborting the whole commit transaction.
  const insertedLoads = [];
  const insertedStops = [];
  const query = async (sql, params) => {
    if (/^\s*SELECT id, tenant_id, operating_entity_id, file_name, file_hash/i.test(sql)) {
      return {
        rows: [{
          id: params[0],
          tenant_id: params[1],
          status: 'staged',
          ai_metadata: COMMIT_BATCH_AI_METADATA,
          result_summary: null,
          storage_key: 'k'
        }]
      };
    }
    if (/^\s*SELECT id, source_row_index, raw_values, normalized_values, validation_status/i.test(sql)) {
      return {
        rows: [{
          id: 'row-1',
          source_row_index: 0,
          raw_values: {},
          normalized_values: {
            load_number: 'L-1',
            pickup_date: 'Thu May 07 2026 00:00:00 GMT+0000 (Coordinated Universal Time)',
            delivery_date: '5/9/2026',
            _status: 'NEW',
            _billing_status: 'PENDING',
            _stops_hint: { pattern: 'single' },
            pickup_city: 'Dallas', pickup_state: 'TX',
            delivery_city: 'Atlanta', delivery_state: 'GA'
          },
          validation_status: 'ok'
        }]
      };
    }
    return { rows: [] };
  };

  const getClient = async () => ({
    query: async (sql, params) => {
      if (/^\s*BEGIN/i.test(sql) || /^\s*COMMIT/i.test(sql) || /^\s*ROLLBACK/i.test(sql)) return { rows: [] };
      if (/^\s*SELECT id, load_number FROM loads/i.test(sql)) return { rows: [] };
      if (/^\s*INSERT INTO loads\b/i.test(sql)) {
        insertedLoads.push(params);
        return { rows: [{ id: 'load-uuid-1' }] };
      }
      if (/^\s*INSERT INTO load_stops\b/i.test(sql)) {
        // [load_id, stop_type, stop_date, city, state, zip, sequence]
        insertedStops.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {}
  });

  const { commitBatch } = loadServiceWithClient(query, getClient);
  await commitBatch({ tenantId: 't1', userId: 'u1', batchId: 'batch-1' });

  assert.equal(insertedLoads.length, 1, 'commit must succeed (no aborted transaction)');
  assert.equal(insertedStops.length, 2, 'one PICKUP and one DELIVERY stop should be inserted');

  const pickup = insertedStops.find((p) => p[1] === 'PICKUP');
  const delivery = insertedStops.find((p) => p[1] === 'DELIVERY');
  assert.equal(pickup[2], '2026-05-07', 'pickup stop_date must be ISO-coerced');
  assert.equal(delivery[2], '2026-05-09', 'delivery stop_date must be ISO-coerced');
});

test('commitBatch inserts the stop with stop_date = NULL when normalized date is unparseable', async () => {
  // AC: gibberish stop date must not fail the whole row; the stop is still
  // created so the load + addresses persist with stop_date = NULL.
  const insertedStops = [];
  const query = async (sql, params) => {
    if (/^\s*SELECT id, tenant_id, operating_entity_id, file_name, file_hash/i.test(sql)) {
      return {
        rows: [{
          id: params[0],
          tenant_id: params[1],
          status: 'staged',
          ai_metadata: COMMIT_BATCH_AI_METADATA,
          result_summary: null,
          storage_key: 'k'
        }]
      };
    }
    if (/^\s*SELECT id, source_row_index, raw_values, normalized_values, validation_status/i.test(sql)) {
      return {
        rows: [{
          id: 'row-1',
          source_row_index: 0,
          raw_values: {},
          normalized_values: {
            load_number: 'L-1',
            pickup_date: 'not-a-date',
            _status: 'NEW',
            _billing_status: 'PENDING',
            _stops_hint: { pattern: 'single' },
            pickup_city: 'Dallas'
          },
          validation_status: 'ok'
        }]
      };
    }
    return { rows: [] };
  };

  const getClient = async () => ({
    query: async (sql, params) => {
      if (/^\s*BEGIN/i.test(sql) || /^\s*COMMIT/i.test(sql) || /^\s*ROLLBACK/i.test(sql)) return { rows: [] };
      if (/^\s*SELECT id, load_number FROM loads/i.test(sql)) return { rows: [] };
      if (/^\s*INSERT INTO loads\b/i.test(sql)) return { rows: [{ id: 'load-uuid-1' }] };
      if (/^\s*INSERT INTO load_stops\b/i.test(sql)) {
        insertedStops.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {}
  });

  const { commitBatch } = loadServiceWithClient(query, getClient);
  await commitBatch({ tenantId: 't1', userId: 'u1', batchId: 'batch-1' });

  assert.equal(insertedStops.length, 1);
  assert.equal(insertedStops[0][2], null, 'unparseable stop_date must be NULL, not a raw string');
});

test('commitBatch records per-row confidences from finalColumnMapping in ai_metadata', async () => {
  const fixture = makeCommitFixture({
    stagedRow: {
      normalized_values: {
        load_number: 'L-1',
        driver_name: 'Rishawn Williams',
        pickup_date: '2026-05-07',
        delivery_date: '2026-05-09',
        completed_date: '2026-05-10',
        status: 'Delivered',
        _status: 'DELIVERED',
        _billing_status: 'PENDING',
        _stops_hint: { pattern: 'single' },
        pickup_city: 'Dallas'
      }
    }
  });
  const { commitBatch } = loadServiceWithClient(fixture.query, fixture.getClient);

  await commitBatch({ tenantId: 't1', userId: 'u1', batchId: 'batch-1' });

  const params = fixture.insertedLoads[0];
  const meta = JSON.parse(params[IDX.ai_metadata]);
  assert.equal(meta.confidences.pickup_date, 0.95);
  assert.equal(meta.confidences.delivery_date, 0.92);
  assert.equal(meta.confidences.completed_date, 0.9);
  assert.equal(meta.confidences.driver_name, 0.95);
  assert.equal(meta.confidences.status, 0.95);
  // Pre-existing match-score confidences must still be present.
  assert.ok('broker' in meta.confidences);
  assert.ok('driver' in meta.confidences);
});
