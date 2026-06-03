'use strict';

/**
 * FN-1524 — Round-trips scheduled_date / start_date / completion_date through
 * createWorkOrder + updateWorkOrder, with empty-string → NULL normalization.
 *
 * The service is loaded with `../internal/db` swapped for a fake knex via
 * require.cache — captures every insert/update payload so we can assert on
 * the exact column values reaching the DB.
 */

const path = require('node:path');
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');

const SERVICE_PATH = path.resolve(__dirname, '../../services/work-orders.service.js');
const DB_PATH = require.resolve('../../internal/db');

const calls = { inserts: [], updates: [] };
let workOrderRow = null;

function builderFor(table) {
  const builder = {};
  const noop = () => builder;
  [
    'where', 'andWhere', 'orWhere', 'whereIn', 'whereRaw', 'whereNot',
    'modify', 'select', 'orderBy', 'leftJoin', 'innerJoin', 'join',
    'distinctOn', 'as', 'limit', 'offset', 'clone', 'clearSelect',
    'forUpdate', 'onConflict', 'merge', 'increment', 'decrement', 'returning',
  ].forEach(m => { builder[m] = noop; });

  builder.first = async () => {
    if (table === 'work_orders' && workOrderRow) return { ...workOrderRow };
    return null;
  };

  builder.count = async () => [{ count: '0' }];

  builder.insert = (payload) => {
    calls.inserts.push({ table, payload });
    if (table === 'work_orders') {
      workOrderRow = { id: 'wo-test-id', ...payload };
      return { returning: async () => [{ ...workOrderRow }] };
    }
    return { returning: async () => [{}] };
  };

  builder.update = (payload) => {
    calls.updates.push({ table, payload });
    if (table === 'work_orders') {
      workOrderRow = { ...(workOrderRow || {}), ...payload };
      const wrapper = {
        returning: async () => [{ ...workOrderRow }],
        then: (resolve, reject) => Promise.resolve(1).then(resolve, reject),
      };
      return wrapper;
    }
    return Promise.resolve(1);
  };

  builder.del = async () => 0;

  // Make builder thenable so `await trx('table').where(...)` resolves to []
  builder.then = (resolve, reject) => Promise.resolve([]).then(resolve, reject);

  return builder;
}

function makeKnex() {
  function knex(tableSpec) {
    const table = String(tableSpec).split(/\s+as\s+/i)[0].trim();
    return builderFor(table);
  }
  knex.raw = async () => ({ rows: [{ rel: null, max_seq: 0 }] });
  knex.fn = { now: () => 'NOW()' };
  knex.transaction = async (cb) => {
    function trx(tableSpec) {
      const table = String(tableSpec).split(/\s+as\s+/i)[0].trim();
      return builderFor(table);
    }
    trx.raw = knex.raw;
    trx.fn = knex.fn;
    return cb(trx);
  };
  return knex;
}

// Inject db stub before loading the service.
require.cache[DB_PATH] = {
  id: DB_PATH,
  filename: DB_PATH,
  loaded: true,
  exports: { knex: makeKnex() },
};

const service = require(SERVICE_PATH);

function findInsert(table) {
  return calls.inserts.find(c => c.table === table)?.payload;
}

function workOrderUpdatePayloads() {
  return calls.updates.filter(c => c.table === 'work_orders').map(c => c.payload);
}

const VALID_VEHICLE_ID = '00000000-0000-0000-0000-000000000001';
const VALID_LOCATION_ID = '00000000-0000-0000-0000-000000000002';

describe('normalizeDateString', () => {
  it('passes ISO date strings through unchanged', () => {
    assert.strictEqual(service.normalizeDateString('2026-05-15'), '2026-05-15');
    assert.strictEqual(service.normalizeDateString('2026-01-01'), '2026-01-01');
    assert.strictEqual(service.normalizeDateString('2026-12-31'), '2026-12-31');
  });

  it('coerces empty string to null', () => {
    assert.strictEqual(service.normalizeDateString(''), null);
    assert.strictEqual(service.normalizeDateString('   '), null);
  });

  it('coerces null and undefined to null', () => {
    assert.strictEqual(service.normalizeDateString(null), null);
    assert.strictEqual(service.normalizeDateString(undefined), null);
  });
});

describe('createWorkOrder — date columns round-trip', () => {
  beforeEach(() => {
    calls.inserts.length = 0;
    calls.updates.length = 0;
    workOrderRow = null;
  });

  it('persists scheduled_date / start_date / completion_date when provided', async () => {
    await service.createWorkOrder({
      vehicleId: VALID_VEHICLE_ID,
      locationId: VALID_LOCATION_ID,
      scheduledDate: '2026-05-15',
      startDate: '2026-05-16',
      completionDate: '2026-05-20',
    }, null, null);

    const insert = findInsert('work_orders');
    assert.ok(insert, 'expected work_orders insert');
    assert.strictEqual(insert.scheduled_date, '2026-05-15');
    assert.strictEqual(insert.start_date, '2026-05-16');
    assert.strictEqual(insert.completion_date, '2026-05-20');
  });

  it('coerces empty-string date payload values to NULL', async () => {
    await service.createWorkOrder({
      vehicleId: VALID_VEHICLE_ID,
      locationId: VALID_LOCATION_ID,
      scheduledDate: '',
      startDate: '   ',
      completionDate: '2026-05-20',
    }, null, null);

    const insert = findInsert('work_orders');
    assert.ok(insert, 'expected work_orders insert');
    assert.strictEqual(insert.scheduled_date, null);
    assert.strictEqual(insert.start_date, null);
    assert.strictEqual(insert.completion_date, '2026-05-20');
  });

  it('writes NULL for all three columns when payload omits them', async () => {
    await service.createWorkOrder({
      vehicleId: VALID_VEHICLE_ID,
      locationId: VALID_LOCATION_ID,
    }, null, null);

    const insert = findInsert('work_orders');
    assert.ok(insert, 'expected work_orders insert');
    assert.strictEqual(insert.scheduled_date, null);
    assert.strictEqual(insert.start_date, null);
    assert.strictEqual(insert.completion_date, null);
  });
});

describe('updateWorkOrder — date columns round-trip', () => {
  beforeEach(() => {
    calls.inserts.length = 0;
    calls.updates.length = 0;
    workOrderRow = {
      id: 'wo-test-id',
      vehicle_id: VALID_VEHICLE_ID,
      location_id: VALID_LOCATION_ID,
      shop_client_id: null,
      type: 'REPAIR',
      priority: 'NORMAL',
      status: 'open',
      description: 'Test',
      odometer_miles: null,
      assigned_mechanic_user_id: null,
      requested_by_user_id: null,
      cost_type: 'BILLABLE',
      discount_type: 'NONE',
      discount_value: 0,
      tax_rate_percent: 0,
      scheduled_date: '2026-04-01',
      start_date: '2026-04-02',
      completion_date: null,
    };
  });

  it('persists the three dates when payload provides them', async () => {
    await service.updateWorkOrder('wo-test-id', {
      scheduledDate: '2026-06-01',
      startDate: '2026-06-02',
      completionDate: '2026-06-15',
    }, null, null);

    const updates = workOrderUpdatePayloads();
    const dateUpdate = updates.find(p => 'scheduled_date' in p);
    assert.ok(dateUpdate, 'expected work_orders update with date columns');
    assert.strictEqual(dateUpdate.scheduled_date, '2026-06-01');
    assert.strictEqual(dateUpdate.start_date, '2026-06-02');
    assert.strictEqual(dateUpdate.completion_date, '2026-06-15');
  });

  it('coerces empty-string date payload values to NULL on update', async () => {
    await service.updateWorkOrder('wo-test-id', {
      scheduledDate: '',
      startDate: '   ',
      completionDate: '2026-06-15',
    }, null, null);

    const updates = workOrderUpdatePayloads();
    const dateUpdate = updates.find(p => 'scheduled_date' in p);
    assert.ok(dateUpdate, 'expected work_orders update with date columns');
    assert.strictEqual(dateUpdate.scheduled_date, null);
    assert.strictEqual(dateUpdate.start_date, null);
    assert.strictEqual(dateUpdate.completion_date, '2026-06-15');
  });

  it('omits date columns from update when payload does not include them (preserves existing)', async () => {
    await service.updateWorkOrder('wo-test-id', { description: 'New description' }, null, null);

    const updates = workOrderUpdatePayloads();
    // Neither the user-update payload nor the totals-recompute payload should
    // touch the date columns when the caller did not pass them.
    updates.forEach(payload => {
      assert.ok(!('scheduled_date' in payload),
        'scheduled_date should be absent from update when not in payload');
      assert.ok(!('start_date' in payload),
        'start_date should be absent from update when not in payload');
      assert.ok(!('completion_date' in payload),
        'completion_date should be absent from update when not in payload');
    });
  });
});
