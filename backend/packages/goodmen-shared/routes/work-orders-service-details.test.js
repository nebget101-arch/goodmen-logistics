'use strict';

/**
 * FN-1518 / FN-1529: Round-trip integration test for the 8 Service Details
 * fields (service_category, service_description, problem_reported,
 * safety_issue, downtime_reason, road_call, breakdown_location,
 * estimated_duration_hours).
 *
 * Hermetic — uses an in-memory mock knex via the shared db bridge,
 * matching the pattern in services/parts.service.bulk.test.js.
 *
 * Run: cd backend/packages/goodmen-shared && node --test routes/work-orders-service-details.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const dbBridge = require('../internal/db');

function makeMockDb() {
  const tables = {
    work_orders: [],
    work_order_labor_items: [],
    work_order_part_items: [],
    work_order_fees: [],
    work_order_documents: [],
    invoices: [],
    shop_clients: [],
    users: [],
    locations: [],
    vehicles: [],
    maintenance_records: []
  };

  function tableBuilder(name) {
    if (!tables[name]) tables[name] = [];
    const rows = tables[name];
    let whereCriteria = null;
    let returningRequested = false;

    const matches = (r) => {
      if (!whereCriteria) return true;
      return Object.keys(whereCriteria).every((k) => {
        // strip table prefix (e.g. "work_orders.tenant_id" -> "tenant_id")
        const key = k.includes('.') ? k.split('.').pop() : k;
        return r[key] === whereCriteria[k];
      });
    };

    const builder = {
      where(criteriaOrCol, value) {
        if (typeof criteriaOrCol === 'string' && arguments.length === 2) {
          whereCriteria = { ...(whereCriteria || {}), [criteriaOrCol]: value };
        } else if (typeof criteriaOrCol === 'object' && criteriaOrCol !== null) {
          whereCriteria = { ...(whereCriteria || {}), ...criteriaOrCol };
        }
        return this;
      },
      andWhere(col, value) {
        whereCriteria = { ...(whereCriteria || {}), [col]: value };
        return this;
      },
      whereRaw() { return this; },
      modify(cb) { cb(this); return this; },
      orderBy() { return this; },
      leftJoin() { return this; },
      select() { return this; },
      first() {
        return Promise.resolve(rows.find(matches) || undefined);
      },
      async count(col) {
        const cnt = rows.filter(matches).length;
        const alias = typeof col === 'string' && col.includes(' as ')
          ? col.split(' as ').pop().trim()
          : 'count';
        return [{ [alias]: cnt, count: cnt, cnt }];
      },
      then(resolve, reject) {
        // bare query awaited — return all matching rows
        return Promise.resolve(rows.filter(matches)).then(resolve, reject);
      },
      insert(data) {
        const arr = Array.isArray(data) ? data : [data];
        const inserted = arr.map((row) => ({
          id: row.id || randomUUID(),
          ...row
        }));
        rows.push(...inserted);
        return {
          returning: async () => inserted,
          then: (resolve) => resolve(inserted.length)
        };
      },
      update(patch) {
        const matching = rows.filter(matches);
        matching.forEach((r) => Object.assign(r, patch));
        const result = {
          returning: async () => matching,
          then: (resolve) => resolve(matching.length)
        };
        return returningRequested ? result : result;
      },
      returning() {
        returningRequested = true;
        return this;
      },
      async del() {
        const matching = rows.filter(matches);
        for (let i = rows.length - 1; i >= 0; i--) {
          if (matching.includes(rows[i])) rows.splice(i, 1);
        }
        return matching.length;
      }
    };
    return builder;
  }

  const db = (n) => tableBuilder(n);
  db.fn = { now: () => new Date() };
  db.raw = async (sql) => {
    if (/to_regclass/.test(sql)) {
      // Pretend the vehicles table exists, all_vehicles view does not.
      if (sql.includes('all_vehicles')) return { rows: [{ rel: null }] };
      return { rows: [{ rel: 'vehicles' }] };
    }
    if (/MAX\(/i.test(sql) && /work_order_number/.test(sql)) {
      const max = tables.work_orders
        .map((w) => Number((w.work_order_number || '').replace(/\D/g, '')) || 0)
        .reduce((a, b) => Math.max(a, b), 0);
      return { rows: [{ max_seq: max }] };
    }
    return { rows: [] };
  };
  db.transaction = async (fn) => fn(db);
  return { db, tables };
}

function loadServiceWithMock() {
  const { db, tables } = makeMockDb();
  dbBridge.setDatabase({ knex: db });

  const servicePath = require.resolve('../services/work-orders.service');
  delete require.cache[servicePath];
  // invoices.service is required by work-orders.service — clear it too so it
  // re-binds the new knex.
  const invoicesPath = require.resolve('../services/invoices.service');
  delete require.cache[invoicesPath];
  const creditPath = require.resolve('../services/credit.service');
  delete require.cache[creditPath];
  const barcodesPath = require.resolve('../services/barcodes.service');
  delete require.cache[barcodesPath];

  return { service: require('../services/work-orders.service'), tables, db };
}

const SERVICE_DETAILS_INPUT = {
  serviceCategory: 'BRAKES',
  serviceDescription: 'Front pads + rotors replacement',
  problemReported: 'Squealing on hard stops',
  safetyIssue: 'medium',
  downtimeReason: 'WAITING_PARTS',
  roadCall: true,
  breakdownLocation: 'I-35 mile 212 northbound',
  estimatedDurationHours: 4.5
};

test('FN-1518: createWorkOrder persists all 8 Service Details fields', async () => {
  const { service, tables } = loadServiceWithMock();

  const vehicleId = randomUUID();
  const locationId = randomUUID();
  tables.vehicles.push({ id: vehicleId, unit_number: 'TRK-1', vin: 'VIN1' });
  tables.locations.push({ id: locationId, name: 'Main' });

  const wo = await service.createWorkOrder({
    vehicleId,
    locationId,
    description: 'Round-trip test',
    ...SERVICE_DETAILS_INPUT
  }, null, null);

  assert.equal(wo.service_category, 'BRAKES');
  assert.equal(wo.service_description, 'Front pads + rotors replacement');
  assert.equal(wo.problem_reported, 'Squealing on hard stops');
  assert.equal(wo.safety_issue, 'medium');
  assert.equal(wo.downtime_reason, 'WAITING_PARTS');
  assert.equal(wo.road_call, true);
  assert.equal(wo.breakdown_location, 'I-35 mile 212 northbound');
  assert.equal(wo.estimated_duration_hours, 4.5);
});

test('FN-1518: createWorkOrder coerces empty strings to NULL and roadCall defaults to false', async () => {
  const { service, tables } = loadServiceWithMock();

  const vehicleId = randomUUID();
  const locationId = randomUUID();
  tables.vehicles.push({ id: vehicleId });
  tables.locations.push({ id: locationId });

  const wo = await service.createWorkOrder({
    vehicleId,
    locationId,
    description: 'Defaults test',
    serviceCategory: '',
    serviceDescription: '   ',
    problemReported: '',
    safetyIssue: '',
    downtimeReason: '',
    breakdownLocation: '',
    estimatedDurationHours: ''
    // roadCall omitted entirely
  }, null, null);

  assert.equal(wo.service_category, null, 'empty string should become null');
  assert.equal(wo.service_description, null);
  assert.equal(wo.problem_reported, null);
  assert.equal(wo.safety_issue, null);
  assert.equal(wo.downtime_reason, null);
  assert.equal(wo.breakdown_location, null);
  assert.equal(wo.estimated_duration_hours, null);
  assert.equal(wo.road_call, false, 'roadCall should default to false');
});

test('FN-1518: updateWorkOrder updates all 8 fields and round-trips through getWorkOrderById', async () => {
  const { service, tables } = loadServiceWithMock();

  const vehicleId = randomUUID();
  const locationId = randomUUID();
  tables.vehicles.push({ id: vehicleId });
  tables.locations.push({ id: locationId });

  const created = await service.createWorkOrder({
    vehicleId,
    locationId,
    description: 'Round-trip test',
    serviceCategory: 'INITIAL',
    roadCall: false
  }, null, null);

  const updated = await service.updateWorkOrder(created.id, {
    serviceCategory: 'BRAKES',
    serviceDescription: 'Updated description',
    problemReported: 'New problem',
    safetyIssue: 'high',
    downtimeReason: 'PARTS_ORDERED',
    roadCall: true,
    breakdownLocation: 'Updated location',
    estimatedDurationHours: 8.25
  }, null, null);

  assert.equal(updated.service_category, 'BRAKES');
  assert.equal(updated.service_description, 'Updated description');
  assert.equal(updated.problem_reported, 'New problem');
  assert.equal(updated.safety_issue, 'high');
  assert.equal(updated.downtime_reason, 'PARTS_ORDERED');
  assert.equal(updated.road_call, true);
  assert.equal(updated.breakdown_location, 'Updated location');
  assert.equal(updated.estimated_duration_hours, 8.25);

  const fetched = await service.getWorkOrderById(created.id, null);
  assert.ok(fetched, 'getWorkOrderById should return the work order');
  const wo = fetched.workOrder;
  assert.equal(wo.service_category, 'BRAKES');
  assert.equal(wo.service_description, 'Updated description');
  assert.equal(wo.problem_reported, 'New problem');
  assert.equal(wo.safety_issue, 'high');
  assert.equal(wo.downtime_reason, 'PARTS_ORDERED');
  assert.equal(wo.road_call, true);
  assert.equal(wo.breakdown_location, 'Updated location');
  assert.equal(wo.estimated_duration_hours, 8.25);
});

test('FN-1518: updateWorkOrder leaves omitted Service Details fields unchanged', async () => {
  const { service, tables } = loadServiceWithMock();

  const vehicleId = randomUUID();
  const locationId = randomUUID();
  tables.vehicles.push({ id: vehicleId });
  tables.locations.push({ id: locationId });

  const created = await service.createWorkOrder({
    vehicleId,
    locationId,
    description: 'Persistence test',
    ...SERVICE_DETAILS_INPUT
  }, null, null);

  // Update only one unrelated field — Service Details should stay intact.
  await service.updateWorkOrder(created.id, { priority: 'HIGH' }, null, null);

  const fetched = await service.getWorkOrderById(created.id, null);
  const wo = fetched.workOrder;
  assert.equal(wo.priority, 'HIGH');
  assert.equal(wo.service_category, 'BRAKES');
  assert.equal(wo.service_description, 'Front pads + rotors replacement');
  assert.equal(wo.problem_reported, 'Squealing on hard stops');
  assert.equal(wo.safety_issue, 'medium');
  assert.equal(wo.downtime_reason, 'WAITING_PARTS');
  assert.equal(wo.road_call, true);
  assert.equal(wo.breakdown_location, 'I-35 mile 212 northbound');
  assert.equal(wo.estimated_duration_hours, 4.5);
});
