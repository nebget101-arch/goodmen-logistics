'use strict';

/**
 * FN-1446: integration tests for the vehicle repair-history-summary service.
 *
 * Run with:
 *   cd backend/packages/goodmen-shared && node --test test/vehicles-repair-history-summary.test.js
 *
 * Covers:
 *   1. clampWindowDays — default + min/max clamps + non-numeric fallback.
 *   2. fetchVehicleWorkOrderHistory — tenant scoping (404 case), VIN→
 *      customer_vehicles join, 50-row cap passed to SQL, windowDays passed.
 *   3. getRepairHistorySummary — happy path, AI failure surfaces, in-process
 *      cache prevents duplicate AI calls, "not enough history" pass-through.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const dbBridge = require('../internal/db');

// Stub axios at the require cache layer before loading the service so the
// service's `require('axios')` returns the spy. This avoids a real HTTP call.
const axiosCalls = [];
let axiosResponse = { status: 200, data: { summary: 'ok', recurringIssues: [], comebackRisk: 'low' } };
let axiosThrow = null;

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'axios') {
    return {
      post: async (url, body, opts) => {
        axiosCalls.push({ url, body, opts });
        if (axiosThrow) throw axiosThrow;
        return axiosResponse;
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

// Now load the service — it picks up the stubbed axios.
const service = require('../services/vehicle-repair-history.service');

// Restore Module._load for any subsequent unrelated requires; the service
// already captured the stubbed axios reference.
Module._load = originalLoad;

const {
  clampWindowDays,
  fetchVehicleWorkOrderHistory,
  getRepairHistorySummary,
  WINDOW_DAYS_DEFAULT,
  WINDOW_DAYS_MIN,
  WINDOW_DAYS_MAX,
  MAX_AI_ROWS,
  _resetCacheForTests
} = service;

// ---------------------------------------------------------------------------
// 1. clampWindowDays
// ---------------------------------------------------------------------------

test('clampWindowDays: default for non-numeric / null / undefined', () => {
  assert.equal(clampWindowDays(undefined), WINDOW_DAYS_DEFAULT);
  assert.equal(clampWindowDays(null), WINDOW_DAYS_DEFAULT);
  assert.equal(clampWindowDays('not-a-number'), WINDOW_DAYS_DEFAULT);
  assert.equal(clampWindowDays(''), WINDOW_DAYS_DEFAULT);
});

test('clampWindowDays: clamps below the minimum', () => {
  assert.equal(clampWindowDays(0), WINDOW_DAYS_MIN);
  assert.equal(clampWindowDays(7), WINDOW_DAYS_MIN);
  assert.equal(clampWindowDays(-100), WINDOW_DAYS_MIN);
});

test('clampWindowDays: clamps above the maximum', () => {
  assert.equal(clampWindowDays(10000), WINDOW_DAYS_MAX);
  assert.equal(clampWindowDays(WINDOW_DAYS_MAX + 1), WINDOW_DAYS_MAX);
});

test('clampWindowDays: passes valid values through (string + numeric)', () => {
  assert.equal(clampWindowDays(180), 180);
  assert.equal(clampWindowDays('365'), 365);
  assert.equal(clampWindowDays(WINDOW_DAYS_MIN), WINDOW_DAYS_MIN);
  assert.equal(clampWindowDays(WINDOW_DAYS_MAX), WINDOW_DAYS_MAX);
});

// ---------------------------------------------------------------------------
// 2. fetchVehicleWorkOrderHistory — DB layer
// ---------------------------------------------------------------------------

/**
 * Build a query stub that scripts replies in order. Each call records its
 * SQL + params for later assertion.
 */
function makeQueryStub(scripted) {
  const calls = [];
  let i = 0;
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    const next = scripted[i++];
    if (typeof next === 'function') return next(sql, params);
    return next || { rows: [] };
  };
  return { fn, calls };
}

function withDb(query, run) {
  const original = dbBridge.query;
  dbBridge.setDatabase({ query });
  return Promise.resolve(run()).finally(() => {
    dbBridge.setDatabase({ query: original });
  });
}

test('fetchVehicleWorkOrderHistory: returns null when vehicle not visible to tenant', async () => {
  const stub = makeQueryStub([
    { rows: [{ rel: 'all_vehicles' }] }, // resolveVehicleSource → all_vehicles
    { rows: [] }, // vehicle lookup misses on tenant_id
    { rows: [] }  // customer_vehicles fallback also misses (FN-1500)
  ]);
  await withDb(stub.fn, async () => {
    const result = await fetchVehicleWorkOrderHistory('veh-1', {
      tenantId: 'tenant-A',
      windowDays: 365
    });
    assert.equal(result, null);
  });
  // Tenant scoping on both lookups: vehicle SELECT and customer_vehicles fallback
  // are both parameterized on (vehicleId, tenantId).
  assert.deepEqual(stub.calls[1].params, ['veh-1', 'tenant-A']);
  assert.deepEqual(stub.calls[2].params, ['veh-1', 'tenant-A']);
  assert.match(stub.calls[2].sql, /customer_vehicles WHERE vehicle_uuid = \$1/);
});

test('fetchVehicleWorkOrderHistory: resolves via customer_vehicles fallback when vehicles miss (FN-1500)', async () => {
  // WO form's vehicleId comes from customer_vehicles.vehicle_uuid, so the
  // primary vehicles/all_vehicles lookup misses. Service must fall back to
  // customer_vehicles to recover the VIN before going to work_orders.
  const stub = makeQueryStub([
    { rows: [{ rel: 'all_vehicles' }] },
    { rows: [] }, // vehicles/all_vehicles miss
    { rows: [{ vin: 'VIN-CV-FALLBACK' }] }, // customer_vehicles fallback hit
    { rows: [{ vehicle_uuid: 'cv-1' }, { vehicle_uuid: 'cv-2' }] }, // VIN→UUIDs join
    { rows: [
      { work_order_id: 'wo-1', work_order_number: 'WO-1', type: 'm', status: 'OPEN', title: 't', request_date: null, completion_date: null, grand_total: '10' },
      { work_order_id: 'wo-2', work_order_number: 'WO-2', type: 'm', status: 'OPEN', title: 't', request_date: null, completion_date: null, grand_total: '20' }
    ] }
  ]);

  await withDb(stub.fn, async () => {
    const result = await fetchVehicleWorkOrderHistory('cv-uuid-from-wo-form', {
      tenantId: 'tenant-A',
      windowDays: 365
    });
    assert.ok(result);
    assert.equal(result.vin, 'VIN-CV-FALLBACK');
    assert.equal(result.history.length, 2);
  });

  assert.deepEqual(stub.calls[2].params, ['cv-uuid-from-wo-form', 'tenant-A']);
});

test('fetchVehicleWorkOrderHistory: caps SQL LIMIT at 50 rows and forwards windowDays', async () => {
  const vehicleUuids = ['cv-uuid-1', 'cv-uuid-2'];
  const stub = makeQueryStub([
    { rows: [{ rel: 'all_vehicles' }] },
    { rows: [{ vin: 'VIN123' }] },
    { rows: vehicleUuids.map((u) => ({ vehicle_uuid: u })) },
    {
      rows: Array.from({ length: 3 }, (_, idx) => ({
        work_order_id: `wo-${idx}`,
        work_order_number: `WO-${idx}`,
        type: 'maintenance',
        status: 'COMPLETED',
        title: 'brake job',
        request_date: '2025-04-01',
        completion_date: '2025-04-02',
        grand_total: '125.50'
      }))
    }
  ]);

  await withDb(stub.fn, async () => {
    const result = await fetchVehicleWorkOrderHistory('veh-2', {
      tenantId: 'tenant-B',
      windowDays: 200,
      // Caller asks for 999 — service must clamp to MAX_AI_ROWS=50.
      capRows: 999
    });
    assert.ok(result);
    assert.equal(result.vin, 'VIN123');
    assert.equal(result.history.length, 3);
    assert.equal(result.history[0].grand_total, 125.5);
  });

  const woCall = stub.calls[3];
  // params: [vehicleUuids, tenantId, windowDaysAsString, cap]
  assert.deepEqual(woCall.params[0], vehicleUuids);
  assert.equal(woCall.params[1], 'tenant-B');
  assert.equal(woCall.params[2], '200');
  assert.equal(woCall.params[3], MAX_AI_ROWS); // clamped to 50
  // SQL applies the windowDays interval at the DB layer.
  assert.match(woCall.sql, /NOW\(\) - \(\$3 \|\| ' days'\)::interval/);
  assert.match(woCall.sql, /ORDER BY wo\.created_at DESC/);
});

test('fetchVehicleWorkOrderHistory: returns empty history when no work orders match', async () => {
  const stub = makeQueryStub([
    { rows: [{ rel: 'vehicles' }] },
    { rows: [{ vin: 'VIN-NEW' }] },
    { rows: [{ vehicle_uuid: 'cv-uuid-9' }] },
    { rows: [] }
  ]);
  await withDb(stub.fn, async () => {
    const result = await fetchVehicleWorkOrderHistory('veh-new', {
      tenantId: 'tenant-C',
      windowDays: 365
    });
    assert.deepEqual(result, { vin: 'VIN-NEW', history: [] });
  });
});

// ---------------------------------------------------------------------------
// 3. getRepairHistorySummary — orchestration + cache + AI pass-through
// ---------------------------------------------------------------------------

function makeReq() {
  return { headers: { authorization: 'Bearer test-token' } };
}

test('getRepairHistorySummary: forwards bearer token + body to ai-service', async () => {
  _resetCacheForTests();
  axiosCalls.length = 0;
  axiosResponse = {
    status: 200,
    data: {
      summary: 'Brake-system comebacks suspected.',
      recurringIssues: [{ pattern: 'rear brake noise', work_order_ids: ['wo-1', 'wo-2'] }],
      comebackRisk: 'high'
    }
  };

  const stub = makeQueryStub([
    { rows: [{ rel: 'all_vehicles' }] },
    { rows: [{ vin: 'VIN-AI' }] },
    { rows: [{ vehicle_uuid: 'cv-1' }] },
    {
      rows: [
        { work_order_id: 'wo-1', work_order_number: 'WO-1', type: 'maintenance', status: 'COMPLETED', title: 'brake', request_date: '2025-04-01', completion_date: '2025-04-02', grand_total: '50' },
        { work_order_id: 'wo-2', work_order_number: 'WO-2', type: 'maintenance', status: 'COMPLETED', title: 'brake', request_date: '2025-03-01', completion_date: '2025-03-03', grand_total: '60' }
      ]
    }
  ]);

  await withDb(stub.fn, async () => {
    const result = await getRepairHistorySummary('veh-A', {
      tenantId: 'tenant-A',
      windowDays: 365,
      req: makeReq()
    });
    assert.ok(result?.ok);
    assert.equal(result.fromCache, false);
    assert.equal(result.body.comebackRisk, 'high');
  });

  assert.equal(axiosCalls.length, 1);
  const call = axiosCalls[0];
  assert.match(call.url, /\/api\/ai\/vehicles\/repair-history-summary$/);
  assert.equal(call.body.vin, 'VIN-AI');
  assert.equal(call.body.history.length, 2);
  assert.equal(call.opts.headers.Authorization, 'Bearer test-token');
});

test('getRepairHistorySummary: empty-history short-circuits without calling AI (FN-1500)', async () => {
  _resetCacheForTests();
  axiosCalls.length = 0;

  const stub = makeQueryStub([
    { rows: [{ rel: 'all_vehicles' }] },
    { rows: [{ vin: 'VIN-NEW' }] },
    { rows: [{ vehicle_uuid: 'cv-x' }] },
    { rows: [] } // zero WOs in window
  ]);

  await withDb(stub.fn, async () => {
    const result = await getRepairHistorySummary('veh-new', {
      tenantId: 'tenant-A',
      windowDays: 365,
      req: makeReq()
    });
    assert.ok(result?.ok);
    assert.equal(result.fromCache, false);
    assert.equal(result.body.insufficientHistory, true);
    assert.equal(result.body.count, 0);
    assert.equal(result.body.vin, 'VIN-NEW');
    assert.equal(result.body.windowDays, 365);
  });

  // Empty history must NOT round-trip to the AI service — that's the whole
  // point of the short-circuit.
  assert.equal(axiosCalls.length, 0);
});

test('getRepairHistorySummary: empty-history response is cached for the TTL window', async () => {
  _resetCacheForTests();
  axiosCalls.length = 0;

  const stub = makeQueryStub([
    { rows: [{ rel: 'all_vehicles' }] },
    { rows: [{ vin: 'VIN-EMPTY' }] },
    { rows: [{ vehicle_uuid: 'cv-empty' }] },
    { rows: [] }
  ]);

  const opts = { tenantId: 'tenant-A', windowDays: 365, req: makeReq() };

  await withDb(stub.fn, async () => {
    const first = await getRepairHistorySummary('veh-empty', opts);
    assert.equal(first.fromCache, false);
    assert.equal(first.body.insufficientHistory, true);
  });

  // Second call must skip DB entirely and return cached body.
  let dbHit = 0;
  const errStub = async () => { dbHit += 1; throw new Error('DB should not be hit on cache hit'); };
  await withDb(errStub, async () => {
    const second = await getRepairHistorySummary('veh-empty', opts);
    assert.equal(second.fromCache, true);
    assert.equal(second.body.insufficientHistory, true);
  });
  assert.equal(dbHit, 0);
  assert.equal(axiosCalls.length, 0);
});

test('getRepairHistorySummary: axios network throw → ai_unavailable (FN-1500)', async () => {
  // Pre-FN-1500, validateStatus only suppressed HTTP-status errors. A real
  // network failure (DNS, ECONNREFUSED, timeout) bubbled to the route catch
  // and returned 500. Now the orchestrator must translate any throw into the
  // same `{ ok: false, reason: 'ai_unavailable' }` path → route 502.
  _resetCacheForTests();
  axiosCalls.length = 0;
  const networkError = new Error('connect ECONNREFUSED 127.0.0.1:4100');
  networkError.code = 'ECONNREFUSED';
  axiosThrow = networkError;

  const stub = makeQueryStub([
    { rows: [{ rel: 'all_vehicles' }] },
    { rows: [{ vin: 'VIN-DOWN' }] },
    { rows: [{ vehicle_uuid: 'cv-d' }] },
    { rows: [
      { work_order_id: 'wo-1', work_order_number: 'WO-1', type: 'm', status: 'OPEN', title: 't', request_date: null, completion_date: null, grand_total: null },
      { work_order_id: 'wo-2', work_order_number: 'WO-2', type: 'm', status: 'OPEN', title: 't', request_date: null, completion_date: null, grand_total: null }
    ] }
  ]);

  try {
    await withDb(stub.fn, async () => {
      const result = await getRepairHistorySummary('veh-down', {
        tenantId: 'tenant-A',
        windowDays: 365,
        req: makeReq()
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'ai_unavailable');
      assert.equal(result.status, 0);
    });
    assert.equal(axiosCalls.length, 1, 'axios was invoked once before throwing');
  } finally {
    axiosThrow = null;
  }
});

test('getRepairHistorySummary: returns ai_unavailable on non-200 from ai-service', async () => {
  _resetCacheForTests();
  axiosCalls.length = 0;
  axiosResponse = { status: 503, data: null };

  const stub = makeQueryStub([
    { rows: [{ rel: 'all_vehicles' }] },
    { rows: [{ vin: 'VIN-X' }] },
    { rows: [{ vehicle_uuid: 'cv-y' }] },
    { rows: [{ work_order_id: 'wo-1', work_order_number: 'WO-1', type: 'm', status: 'OPEN', title: 't', request_date: null, completion_date: null, grand_total: null }] }
  ]);

  await withDb(stub.fn, async () => {
    const result = await getRepairHistorySummary('veh-X', {
      tenantId: 'tenant-A',
      windowDays: 365,
      req: makeReq()
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'ai_unavailable');
    assert.equal(result.status, 503);
  });
});

test('getRepairHistorySummary: caches successful response (no second AI call inside TTL)', async () => {
  _resetCacheForTests();
  axiosCalls.length = 0;
  axiosResponse = { status: 200, data: { summary: 's', recurringIssues: [], comebackRisk: 'medium' } };

  const buildStub = () => makeQueryStub([
    { rows: [{ rel: 'all_vehicles' }] },
    { rows: [{ vin: 'VIN-CACHE' }] },
    { rows: [{ vehicle_uuid: 'cv-z' }] },
    { rows: [
      { work_order_id: 'wo-1', work_order_number: 'WO-1', type: 'm', status: 'OPEN', title: 't', request_date: null, completion_date: null, grand_total: null },
      { work_order_id: 'wo-2', work_order_number: 'WO-2', type: 'm', status: 'OPEN', title: 't', request_date: null, completion_date: null, grand_total: null }
    ] }
  ]);

  const opts = { tenantId: 'tenant-A', windowDays: 365, req: makeReq() };

  let stub = buildStub();
  await withDb(stub.fn, async () => {
    const first = await getRepairHistorySummary('veh-cache', opts);
    assert.equal(first.fromCache, false);
  });

  // Second call: even with a fresh DB stub that would error on use, the
  // cache must short-circuit so DB and AI are never touched.
  let dbHit = 0;
  const errStub = async () => { dbHit += 1; throw new Error('DB should not be hit on cache hit'); };
  await withDb(errStub, async () => {
    const second = await getRepairHistorySummary('veh-cache', opts);
    assert.equal(second.fromCache, true);
    assert.equal(second.body.comebackRisk, 'medium');
  });
  assert.equal(dbHit, 0);
  assert.equal(axiosCalls.length, 1, 'AI service called only once across two route invocations');
});

test('getRepairHistorySummary: returns null when vehicle is not visible to tenant', async () => {
  _resetCacheForTests();
  axiosCalls.length = 0;
  const stub = makeQueryStub([
    { rows: [{ rel: 'all_vehicles' }] },
    { rows: [] } // tenant scoping miss
  ]);
  await withDb(stub.fn, async () => {
    const result = await getRepairHistorySummary('veh-other-tenant', {
      tenantId: 'tenant-A',
      windowDays: 365,
      req: makeReq()
    });
    assert.equal(result, null);
  });
  assert.equal(axiosCalls.length, 0, 'no AI call for cross-tenant vehicles');
});
