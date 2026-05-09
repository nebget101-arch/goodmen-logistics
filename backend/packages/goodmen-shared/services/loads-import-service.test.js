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
