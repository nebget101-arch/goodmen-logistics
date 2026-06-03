'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

/**
 * FN-1389: Tests for getVehicleMaintenanceHistory.
 * The service walks vehicle.id → VIN → customer_vehicles.vehicle_uuid → work_orders + invoices.
 * We stub `query()` per-call so each test asserts on exactly the SQL+params it cares about.
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const VEHICLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CV_UUID_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CV_UUID_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const WO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const INV_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function makeQueryStub(handlers) {
  const calls = [];
  async function query(sql, params = []) {
    calls.push({ sql: sql.trim(), params });
    for (const handler of handlers) {
      if (handler.match(sql)) {
        return handler.respond(params);
      }
    }
    return { rows: [] };
  }
  return { query, calls };
}

function loadService(queryFn) {
  const dbPath = require.resolve('../internal/db');
  const servicePath = require.resolve('./vehicles-maintenance-history.service');
  delete require.cache[dbPath];
  delete require.cache[servicePath];

  const db = require('../internal/db');
  db.setDatabase({ query: queryFn });
  return require('./vehicles-maintenance-history.service');
}

describe('getVehicleMaintenanceHistory (FN-1389)', () => {
  let calls;

  beforeEach(() => { calls = null; });
  afterEach(() => {
    delete require.cache[require.resolve('./vehicles-maintenance-history.service')];
    delete require.cache[require.resolve('../internal/db')];
  });

  it('returns null when tenantId is missing', async () => {
    const stub = makeQueryStub([]);
    const svc = loadService(stub.query);
    const result = await svc.getVehicleMaintenanceHistory(VEHICLE_ID, { tenantId: null });
    assert.strictEqual(result, null);
    assert.strictEqual(stub.calls.length, 0, 'no DB calls when tenant context is missing');
  });

  it('returns null when the vehicle is not visible to the tenant', async () => {
    // Vehicle exists in tenant A but request comes from tenant B → 404.
    const stub = makeQueryStub([
      { match: (sql) => sql.includes("to_regclass('public.all_vehicles')"), respond: () => ({ rows: [{ rel: 'all_vehicles' }] }) },
      { match: (sql) => sql.includes('FROM all_vehicles WHERE id ='), respond: () => ({ rows: [] }) }
    ]);
    const svc = loadService(stub.query);
    const result = await svc.getVehicleMaintenanceHistory(VEHICLE_ID, { tenantId: TENANT_B });
    assert.strictEqual(result, null);
  });

  it('returns empty data when the VIN has no customer_vehicles mirror rows', async () => {
    const stub = makeQueryStub([
      { match: (sql) => sql.includes("to_regclass('public.all_vehicles')"), respond: () => ({ rows: [{ rel: 'all_vehicles' }] }) },
      { match: (sql) => sql.includes('FROM all_vehicles WHERE id ='), respond: () => ({ rows: [{ vin: '1FUJA6CG12LK12345' }] }) },
      { match: (sql) => sql.includes('FROM customer_vehicles WHERE vin ='), respond: () => ({ rows: [] }) }
    ]);
    const svc = loadService(stub.query);
    const result = await svc.getVehicleMaintenanceHistory(VEHICLE_ID, { tenantId: TENANT_A });
    assert.deepStrictEqual(result, {
      data: [],
      meta: { page: 1, pageSize: 25, total: 0, lifetime_spend: 0 }
    });
  });

  it('joins WO + invoice rows and returns the documented shape', async () => {
    const stub = makeQueryStub([
      { match: (sql) => sql.includes("to_regclass('public.all_vehicles')"), respond: () => ({ rows: [{ rel: 'all_vehicles' }] }) },
      { match: (sql) => sql.includes('FROM all_vehicles WHERE id ='), respond: () => ({ rows: [{ vin: '1FUJA6CG12LK12345' }] }) },
      {
        match: (sql) => sql.includes('FROM customer_vehicles WHERE vin ='),
        respond: () => ({ rows: [{ vehicle_uuid: CV_UUID_1 }, { vehicle_uuid: CV_UUID_2 }] })
      },
      {
        match: (sql) => sql.includes('SELECT COUNT(*)'),
        respond: () => ({ rows: [{ total: '2', lifetime_spend: '1492.55' }] })
      },
      {
        match: (sql) => sql.includes('LEFT JOIN locations'),
        respond: () => ({
          rows: [
            {
              work_order_id: WO_ID,
              work_order_number: 'WO-2026-0042',
              type: 'PM',
              status: 'COMPLETED',
              title: '1500-mile PM',
              request_date: '2026-04-22',
              completion_date: '2026-04-23',
              shop_location_name: 'MCKINNEY YARD',
              labor_total: '240.00',
              parts_total: '612.50',
              grand_total: '852.50',
              invoice_id: INV_ID,
              invoice_number: 'INV-2026-0042',
              invoice_status: 'DRAFT',
              invoice_amount_due: '852.50'
            }
          ]
        })
      }
    ]);
    const svc = loadService(stub.query);
    const result = await svc.getVehicleMaintenanceHistory(VEHICLE_ID, { tenantId: TENANT_A, page: 1, pageSize: 25 });

    assert.deepStrictEqual(result.meta, {
      page: 1, pageSize: 25, total: 2, lifetime_spend: 1492.55
    });
    assert.strictEqual(result.data.length, 1);
    const row = result.data[0];
    assert.strictEqual(row.work_order_id, WO_ID);
    assert.strictEqual(row.work_order_number, 'WO-2026-0042');
    assert.strictEqual(row.shop_location_name, 'MCKINNEY YARD');
    assert.strictEqual(row.labor_total, 240);
    assert.strictEqual(row.parts_total, 612.5);
    assert.strictEqual(row.grand_total, 852.5);
    assert.deepStrictEqual(row.invoice, {
      id: INV_ID,
      number: 'INV-2026-0042',
      status: 'DRAFT',
      amount_due: 852.5,
      pdf_url: `/api/invoices/${INV_ID}/pdf`
    });

    // Tenant scoping appears in every join + leaf query.
    const tenantedQueries = stub.calls.filter((c) =>
      c.sql.includes('FROM all_vehicles')
      || c.sql.includes('FROM customer_vehicles')
      || c.sql.includes('SELECT COUNT(*)')
      || c.sql.includes('LEFT JOIN locations')
    );
    assert.ok(tenantedQueries.length >= 4, 'four tenant-scoped queries (vehicle, cv, agg, rows)');
    for (const call of tenantedQueries) {
      assert.ok(call.params.includes(TENANT_A), `expected tenant in params for: ${call.sql.slice(0, 60)}…`);
    }
  });

  it('omits the invoice field when includeInvoices=false', async () => {
    const stub = makeQueryStub([
      { match: (sql) => sql.includes("to_regclass('public.all_vehicles')"), respond: () => ({ rows: [{ rel: 'all_vehicles' }] }) },
      { match: (sql) => sql.includes('FROM all_vehicles WHERE id ='), respond: () => ({ rows: [{ vin: '1FUJA6CG12LK12345' }] }) },
      { match: (sql) => sql.includes('FROM customer_vehicles WHERE vin ='), respond: () => ({ rows: [{ vehicle_uuid: CV_UUID_1 }] }) },
      { match: (sql) => sql.includes('SELECT COUNT(*)'), respond: () => ({ rows: [{ total: '1', lifetime_spend: '500.00' }] }) },
      {
        match: (sql) => sql.includes('LEFT JOIN locations'),
        respond: () => ({
          rows: [{
            work_order_id: WO_ID,
            work_order_number: 'WO-X',
            type: 'REPAIR',
            status: 'COMPLETED',
            title: 'brake job',
            request_date: '2026-04-01',
            completion_date: '2026-04-02',
            shop_location_name: 'YARD',
            labor_total: '300.00',
            parts_total: '200.00',
            grand_total: '500.00',
            invoice_id: INV_ID,
            invoice_number: 'INV-X',
            invoice_status: 'DRAFT',
            invoice_amount_due: '500.00'
          }]
        })
      }
    ]);
    const svc = loadService(stub.query);
    const result = await svc.getVehicleMaintenanceHistory(VEHICLE_ID, {
      tenantId: TENANT_A,
      includeInvoices: false
    });
    assert.strictEqual(result.data.length, 1);
    assert.ok(!('invoice' in result.data[0]), 'invoice field is dropped when includeInvoices is false');
  });

  it('clamps pageSize at MAX_PAGE_SIZE and rejects non-positive values', async () => {
    const stub = makeQueryStub([
      { match: (sql) => sql.includes("to_regclass('public.all_vehicles')"), respond: () => ({ rows: [{ rel: 'all_vehicles' }] }) },
      { match: (sql) => sql.includes('FROM all_vehicles WHERE id ='), respond: () => ({ rows: [{ vin: 'V' }] }) },
      { match: (sql) => sql.includes('FROM customer_vehicles WHERE vin ='), respond: () => ({ rows: [{ vehicle_uuid: CV_UUID_1 }] }) },
      { match: (sql) => sql.includes('SELECT COUNT(*)'), respond: () => ({ rows: [{ total: '0', lifetime_spend: '0' }] }) },
      { match: (sql) => sql.includes('LEFT JOIN locations'), respond: () => ({ rows: [] }) }
    ]);
    const svc = loadService(stub.query);
    const tooBig = await svc.getVehicleMaintenanceHistory(VEHICLE_ID, { tenantId: TENANT_A, pageSize: 9999 });
    assert.strictEqual(tooBig.meta.pageSize, svc.MAX_PAGE_SIZE);

    const negative = await svc.getVehicleMaintenanceHistory(VEHICLE_ID, { tenantId: TENANT_A, pageSize: -5 });
    assert.strictEqual(negative.meta.pageSize, svc.DEFAULT_PAGE_SIZE);

    const zeroPage = await svc.getVehicleMaintenanceHistory(VEHICLE_ID, { tenantId: TENANT_A, page: 0 });
    assert.strictEqual(zeroPage.meta.page, 1);
  });
});
