'use strict';

/**
 * Tests for triage-enrichment.service.js — joining AI-suggested parts with
 * the tenant's parts catalog and inventory.
 *
 * Run: cd backend/packages/goodmen-shared && node --test test/triage-enrichment.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeAiParts,
  buildEnrichedParts,
  enrichTriageParts,
} = require('../services/triage-enrichment.service');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function makePart(id, sku, name, reorderPointDefault) {
  return { id, sku, name, reorder_point_default: reorderPointDefault };
}

function makeInventoryRow({ partId, locationId, onHand, reserved = 0, bin = null, minStock = null }) {
  return {
    part_id: partId,
    location_id: locationId,
    on_hand_qty: onHand,
    reserved_qty: reserved,
    bin_location: bin,
    min_stock_level: minStock,
  };
}

test('normalizeAiParts — accepts new partName/suggestedSku shape', () => {
  const result = normalizeAiParts([
    { partName: 'Oil Filter', suggestedSku: 'OF-100', qty: 2, confidence: 0.9 },
  ]);
  assert.deepEqual(result, [
    { partName: 'Oil Filter', suggestedSku: 'OF-100', qty: 2, confidence: 0.9 },
  ]);
});

test('normalizeAiParts — accepts legacy { query, qty } shape', () => {
  const result = normalizeAiParts([{ query: 'Brake Pad Set', qty: 1 }]);
  assert.deepEqual(result, [
    { partName: 'Brake Pad Set', suggestedSku: null, qty: 1, confidence: null },
  ]);
});

test('normalizeAiParts — drops items with neither name nor sku, defaults bad qty to 1', () => {
  const result = normalizeAiParts([
    { qty: 1 },
    { partName: '   ', suggestedSku: '' },
    { partName: 'Filter', qty: -3 },
    { partName: 'Belt', qty: 'abc' },
  ]);
  assert.deepEqual(result, [
    { partName: 'Filter', suggestedSku: null, qty: 1, confidence: null },
    { partName: 'Belt', suggestedSku: null, qty: 1, confidence: null },
  ]);
});

test('buildEnrichedParts — in_stock when on-hand above reorder point', () => {
  const normalized = normalizeAiParts([{ partName: 'Oil Filter', suggestedSku: 'OF-100', qty: 1 }]);
  const partRows = [makePart('p1', 'OF-100', 'Oil Filter', 5)];
  const inventoryRows = [makeInventoryRow({ partId: 'p1', locationId: 'loc1', onHand: 12, bin: 'A1', minStock: 5 })];

  const result = buildEnrichedParts({ normalized, partRows, inventoryRows });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    partName: 'Oil Filter',
    suggestedSku: 'OF-100',
    qty: 1,
    confidence: null,
    partId: 'p1',
    onHand: 12,
    binLocation: 'A1',
    reorderPoint: 5,
    isLowStock: false,
    inventoryStatus: 'in_stock',
  });
});

test('buildEnrichedParts — low_stock when on-hand <= reorder point but > 0', () => {
  const normalized = normalizeAiParts([{ partName: 'Oil Filter', suggestedSku: 'OF-100', qty: 1 }]);
  const partRows = [makePart('p1', 'OF-100', 'Oil Filter', 5)];
  const inventoryRows = [makeInventoryRow({ partId: 'p1', locationId: 'loc1', onHand: 3, bin: 'A1', minStock: 5 })];

  const result = buildEnrichedParts({ normalized, partRows, inventoryRows });
  assert.equal(result[0].inventoryStatus, 'low_stock');
  assert.equal(result[0].isLowStock, true);
  assert.equal(result[0].onHand, 3);
});

test('buildEnrichedParts — out_of_stock when inventory row has 0 on-hand', () => {
  const normalized = normalizeAiParts([{ partName: 'Oil Filter', suggestedSku: 'OF-100', qty: 1 }]);
  const partRows = [makePart('p1', 'OF-100', 'Oil Filter', 5)];
  const inventoryRows = [makeInventoryRow({ partId: 'p1', locationId: 'loc1', onHand: 0, bin: 'A1', minStock: 5 })];

  const result = buildEnrichedParts({ normalized, partRows, inventoryRows });
  assert.equal(result[0].inventoryStatus, 'out_of_stock');
  assert.equal(result[0].isLowStock, true);
  assert.equal(result[0].onHand, 0);
});

test('buildEnrichedParts — out_of_stock when part exists in catalog but no inventory row', () => {
  const normalized = normalizeAiParts([{ partName: 'Oil Filter', suggestedSku: 'OF-100', qty: 1 }]);
  const partRows = [makePart('p1', 'OF-100', 'Oil Filter', 4)];
  const inventoryRows = [];

  const result = buildEnrichedParts({ normalized, partRows, inventoryRows });
  assert.equal(result[0].inventoryStatus, 'out_of_stock');
  assert.equal(result[0].onHand, 0);
  assert.equal(result[0].partId, 'p1');
  assert.equal(result[0].reorderPoint, 4);
});

test('buildEnrichedParts — not_found when SKU has no part match', () => {
  const normalized = normalizeAiParts([{ partName: 'Mystery Widget', suggestedSku: 'ZZ-999', qty: 1 }]);
  const result = buildEnrichedParts({ normalized, partRows: [], inventoryRows: [] });

  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    partName: 'Mystery Widget',
    suggestedSku: 'ZZ-999',
    qty: 1,
    confidence: null,
    partId: null,
    onHand: null,
    binLocation: null,
    reorderPoint: null,
    isLowStock: false,
    inventoryStatus: 'not_found',
  });
});

test('buildEnrichedParts — falls back to name match when SKU is absent', () => {
  const normalized = normalizeAiParts([{ query: 'Brake Pad Set', qty: 1 }]);
  const partRows = [makePart('p2', 'BP-200', 'Brake Pad Set', 3)];
  const inventoryRows = [makeInventoryRow({ partId: 'p2', locationId: 'loc1', onHand: 8, bin: 'B2', minStock: 3 })];

  const result = buildEnrichedParts({ normalized, partRows, inventoryRows });
  assert.equal(result[0].partId, 'p2');
  assert.equal(result[0].suggestedSku, 'BP-200');
  assert.equal(result[0].onHand, 8);
});

test('buildEnrichedParts — aggregates on-hand across multiple inventory rows for same part', () => {
  const normalized = normalizeAiParts([{ partName: 'Filter', suggestedSku: 'F1', qty: 1 }]);
  const partRows = [makePart('p1', 'F1', 'Filter', 5)];
  const inventoryRows = [
    makeInventoryRow({ partId: 'p1', locationId: 'loc1', onHand: 4, bin: 'A1', minStock: 2 }),
    makeInventoryRow({ partId: 'p1', locationId: 'loc2', onHand: 7, bin: 'B2', minStock: 3 }),
  ];

  const result = buildEnrichedParts({ normalized, partRows, inventoryRows });
  assert.equal(result[0].onHand, 11);
  assert.equal(result[0].binLocation, 'A1');
});

test('buildEnrichedParts — returns multiple suggested parts in order, mixing matched and not_found', () => {
  const normalized = normalizeAiParts([
    { partName: 'Oil Filter', suggestedSku: 'OF-100', qty: 1 },
    { partName: 'Mystery Widget', suggestedSku: 'ZZ-999', qty: 1 },
    { partName: 'Brake Pad Set', qty: 2 },
  ]);
  const partRows = [
    makePart('p1', 'OF-100', 'Oil Filter', 5),
    makePart('p2', 'BP-200', 'Brake Pad Set', 3),
  ];
  const inventoryRows = [
    makeInventoryRow({ partId: 'p1', locationId: 'loc1', onHand: 10, bin: 'A1', minStock: 5 }),
    makeInventoryRow({ partId: 'p2', locationId: 'loc1', onHand: 1, bin: 'B2', minStock: 3 }),
  ];

  const result = buildEnrichedParts({ normalized, partRows, inventoryRows });
  assert.equal(result.length, 3);
  assert.equal(result[0].inventoryStatus, 'in_stock');
  assert.equal(result[1].inventoryStatus, 'not_found');
  assert.equal(result[2].inventoryStatus, 'low_stock');
  assert.equal(result[2].partId, 'p2');
});

// ---------------------------------------------------------------------------
// Tenant scoping — verify that the SQL queries always filter by tenant
// ---------------------------------------------------------------------------

function createKnexSpy({ partRows = [], inventoryRows = [] } = {}) {
  const calls = [];

  function builder(tableSpec) {
    const state = {
      table: String(tableSpec),
      whereCalls: [],
      whereInCalls: [],
      whereRawCalls: [],
      orWhereNullCalls: [],
      joinCalls: [],
      selects: null,
    };

    const self = {
      where(...args) {
        // Sub-callbacks executed against `self` so we can inspect nested where filters too.
        if (typeof args[0] === 'function') {
          args[0].call(self);
        } else {
          state.whereCalls.push(args);
        }
        return self;
      },
      andWhere(...args) {
        if (typeof args[0] === 'function') {
          args[0].call(self);
        } else {
          state.whereCalls.push(args);
        }
        return self;
      },
      orWhereNull(column) {
        state.orWhereNullCalls.push(column);
        return self;
      },
      whereNull(column) {
        state.orWhereNullCalls.push(column);
        return self;
      },
      whereRaw(sql, bindings) {
        state.whereRawCalls.push({ sql, bindings });
        return self;
      },
      orWhereRaw(sql, bindings) {
        state.whereRawCalls.push({ sql, bindings });
        return self;
      },
      whereIn(column, values) {
        state.whereInCalls.push({ column, values });
        return self;
      },
      join(table, left, right) {
        state.joinCalls.push({ table, left, right });
        return self;
      },
      select(...cols) {
        state.selects = cols;
        return self;
      },
      then(onFulfilled, onRejected) {
        const data = state.table.startsWith('parts') ? partRows : inventoryRows;
        return Promise.resolve(data).then(onFulfilled, onRejected);
      },
    };

    calls.push(state);
    return self;
  }

  return { builder, calls };
}

test('enrichTriageParts — parts query filters by tenant_id and inventory query joins locations.tenant_id', async () => {
  const partRows = [makePart('p1', 'OF-100', 'Oil Filter', 5)];
  const inventoryRows = [makeInventoryRow({ partId: 'p1', locationId: 'loc1', onHand: 9, bin: 'A1', minStock: 5 })];
  const spy = createKnexSpy({ partRows, inventoryRows });

  const result = await enrichTriageParts({
    knex: spy.builder,
    tenantId: TENANT_A,
    locationId: null,
    parts: [{ partName: 'Oil Filter', suggestedSku: 'OF-100', qty: 1 }],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].onHand, 9);

  const partsCall = spy.calls.find((c) => c.table === 'parts');
  assert.ok(partsCall, 'parts table queried');
  const tenantWhere = partsCall.whereCalls.find((args) => args[0] === 'tenant_id' && args[1] === TENANT_A);
  assert.ok(tenantWhere, 'parts query filters by tenant_id');

  const inventoryCall = spy.calls.find((c) => c.table === 'inventory as i');
  assert.ok(inventoryCall, 'inventory table queried');
  const locTenantWhere = inventoryCall.whereCalls.find((args) => args[0] === 'l.tenant_id' && args[1] === TENANT_A);
  assert.ok(locTenantWhere, 'inventory query filters by joined locations.tenant_id');
  const locationJoin = inventoryCall.joinCalls.find((j) => j.table === 'locations as l');
  assert.ok(locationJoin, 'inventory query joins locations');
});

test('enrichTriageParts — locationId filter is applied when provided', async () => {
  const partRows = [makePart('p1', 'OF-100', 'Oil Filter', 5)];
  const inventoryRows = [makeInventoryRow({ partId: 'p1', locationId: 'loc-target', onHand: 4, bin: 'A1', minStock: 5 })];
  const spy = createKnexSpy({ partRows, inventoryRows });

  await enrichTriageParts({
    knex: spy.builder,
    tenantId: TENANT_A,
    locationId: 'loc-target',
    parts: [{ partName: 'Oil Filter', suggestedSku: 'OF-100', qty: 1 }],
  });

  const inventoryCall = spy.calls.find((c) => c.table === 'inventory as i');
  const locFilter = inventoryCall.whereCalls.find((args) => args[0] === 'i.location_id' && args[1] === 'loc-target');
  assert.ok(locFilter, 'inventory query filters by requested location_id');
});

test('enrichTriageParts — never queries inventory when no parts match catalog', async () => {
  const spy = createKnexSpy({ partRows: [], inventoryRows: [] });

  const result = await enrichTriageParts({
    knex: spy.builder,
    tenantId: TENANT_A,
    locationId: null,
    parts: [{ partName: 'Mystery Widget', suggestedSku: 'ZZ-999', qty: 1 }],
  });

  assert.equal(result[0].inventoryStatus, 'not_found');
  const inventoryCall = spy.calls.find((c) => c.table === 'inventory as i');
  assert.equal(inventoryCall, undefined, 'no inventory query was issued');
});

test('enrichTriageParts — empty parts input short-circuits without any DB calls', async () => {
  const spy = createKnexSpy();
  const result = await enrichTriageParts({
    knex: spy.builder,
    tenantId: TENANT_A,
    locationId: null,
    parts: [],
  });

  assert.deepEqual(result, []);
  assert.equal(spy.calls.length, 0);
});

test('enrichTriageParts — does not leak parts from a different tenant (spy returns only the requested tenant rows)', async () => {
  // Spy returns parts that match the tenant filter the caller asked for.
  const tenantAParts = [makePart('p1', 'OF-100', 'Oil Filter', 5)];
  const tenantAInventory = [makeInventoryRow({ partId: 'p1', locationId: 'loc1', onHand: 9, minStock: 5 })];
  const spy = createKnexSpy({ partRows: tenantAParts, inventoryRows: tenantAInventory });

  const result = await enrichTriageParts({
    knex: spy.builder,
    tenantId: TENANT_B, // caller is tenant B
    locationId: null,
    parts: [{ partName: 'Oil Filter', suggestedSku: 'OF-100', qty: 1 }],
  });

  // The spy was queried with tenant B as the filter — assert the filter was set.
  const partsCall = spy.calls.find((c) => c.table === 'parts');
  const tenantWhere = partsCall.whereCalls.find((args) => args[0] === 'tenant_id' && args[1] === TENANT_B);
  assert.ok(tenantWhere, 'parts query passes the calling tenant id, not a hardcoded value');

  // The result is whatever the DB returned — in production it would be 0 rows for tenant B.
  // This test guards the contract that we *pass* tenantId into the where clause.
  assert.equal(result.length, 1);
});
