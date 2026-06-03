'use strict';

const path = require('path');
const express = require('express');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createTenantContextMiddleware } = require('../middleware/tenant-context-middleware');

const sharedRoot = path.resolve(__dirname, '..');

function resolveShared(relativePath) {
  return path.resolve(sharedRoot, relativePath);
}

function createNoopLogger() {
  return {
    error() {},
    warn() {},
    info() {},
    trackDatabase() {},
    trackRequest() {},
    sendMetric() {},
    trackEvent() {}
  };
}

function normalizeColumn(column) {
  return String(column).split('.').pop();
}

function getRowValue(row, column) {
  if (column === 'uoe.user_id') return row.user_id;
  if (column === 'uoe.is_active') return row.uoe_is_active;
  if (column === 'oe.is_active') return row.oe_is_active;
  if (column === 'oe.tenant_id') return row.oe_tenant_id;
  return row[normalizeColumn(column)];
}

class FakeTenantQuery {
  constructor(tableSpec, state) {
    this.table = String(tableSpec).split(/\s+as\s+/i)[0].trim();
    this.state = state;
    this.filters = [];
    this.firstOnly = false;
  }

  join() {
    return this;
  }

  where(arg1, arg2) {
    if (typeof arg1 === 'object' && arg1 !== null) {
      for (const [key, value] of Object.entries(arg1)) {
        this.filters.push({ column: key, value });
      }
      return this;
    }

    this.filters.push({ column: arg1, value: arg2 });
    return this;
  }

  andWhere(arg1, arg2) {
    return this.where(arg1, arg2);
  }

  orderBy() {
    return this;
  }

  select() {
    return this;
  }

  modify(callback) {
    callback(this);
    return this;
  }

  first() {
    this.firstOnly = true;
    return this;
  }

  then(resolve, reject) {
    Promise.resolve(this.execute()).then(resolve, reject);
  }

  async execute() {
    let rows = [];

    if (this.table === 'user_tenant_memberships') {
      rows = [...(this.state.userTenantMemberships || [])];
    } else if (this.table === 'users') {
      rows = [...(this.state.users || [])];
    } else if (this.table === 'tenants') {
      rows = [...(this.state.tenants || [])];
    } else if (this.table === 'operating_entities') {
      rows = [...(this.state.operatingEntities || [])];
    } else if (this.table === 'user_operating_entities') {
      rows = (this.state.userOperatingEntities || []).map((row) => {
        const entity = (this.state.operatingEntities || []).find((candidate) => candidate.id === row.operating_entity_id) || {};
        return {
          ...row,
          oe_tenant_id: entity.tenant_id,
          oe_is_active: entity.is_active,
          uoe_is_active: row.is_active,
          id: row.id || `${row.user_id}-${row.operating_entity_id}`
        };
      });
    }

    for (const filter of this.filters) {
      rows = rows.filter((row) => getRowValue(row, filter.column) === filter.value);
    }

    return this.firstOnly ? (rows[0] || undefined) : rows;
  }
}

function createTenantKnex(state) {
  return function fakeKnex(tableSpec) {
    return new FakeTenantQuery(tableSpec, state);
  };
}

function authFromHeaders(req, _res, next) {
  req.user = {
    id: req.headers['x-user-id'] || 'u1',
    role: req.headers['x-role'] || 'admin',
    driver_id: req.headers['x-driver-id'] || null
  };
  next();
}

function authModuleMock(arg1, arg2, arg3) {
  if (Array.isArray(arg1)) {
    return (req, res, next) => authFromHeaders(req, res, next);
  }

  return authFromHeaders(arg1, arg2, arg3);
}

function createJsonApp(router, tenantState, options = {}) {
  const app = express();
  app.use(express.json());
  if (!options.skipAppAuth) {
    app.use(authFromHeaders);
  }
  if (!options.skipAppTenantContext) {
    app.use(createTenantContextMiddleware({ knexClient: createTenantKnex(tenantState), logger: createNoopLogger() }));
  }
  app.use(routerBase(router));
  return app;
}

function routerBase(router) {
  const app = express.Router();
  app.use('/', router);
  return app;
}

async function withServer(app, callback) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    return await callback(server);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function requestJson(server, method, routePath, { headers = {}, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${routePath}`, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (_error) {
    parsed = text;
  }

  return {
    status: response.status,
    body: parsed
  };
}

function loadModuleWithMocks(targetRelativePath, mockModules) {
  const targetPath = resolveShared(targetRelativePath);
  const backups = [];

  delete require.cache[targetPath];

  for (const [mockRelativePath, exportsValue] of Object.entries(mockModules)) {
    const mockPath = resolveShared(mockRelativePath);
    backups.push({ path: mockPath, prior: require.cache[mockPath] });
    require.cache[mockPath] = {
      id: mockPath,
      filename: mockPath,
      loaded: true,
      exports: exportsValue
    };
  }

  const loaded = require(targetPath);

  return {
    module: loaded,
    restore() {
      delete require.cache[targetPath];
      for (const backup of backups) {
        if (backup.prior) {
          require.cache[backup.path] = backup.prior;
        } else {
          delete require.cache[backup.path];
        }
      }
    }
  };
}

function createTenantState() {
  return {
    userTenantMemberships: [
      { user_id: 'u1', tenant_id: 'tenant-1', is_active: true, is_default: true, created_at: '2026-03-01' }
    ],
    userOperatingEntities: [
      { user_id: 'u1', operating_entity_id: 'entity-1', is_active: true, is_default: true, created_at: '2026-03-01' },
      { user_id: 'u1', operating_entity_id: 'entity-2', is_active: true, is_default: false, created_at: '2026-03-02' }
    ],
    users: [
      { id: 'legacy-user', tenant_id: 'tenant-legacy' }
    ],
    tenants: [
      { id: 'tenant-1', status: 'active', created_at: '2026-03-01' },
      { id: 'tenant-legacy', status: 'active', created_at: '2026-03-02' }
    ],
    operatingEntities: [
      { id: 'entity-1', tenant_id: 'tenant-1', is_active: true, created_at: '2026-03-01' },
      { id: 'entity-2', tenant_id: 'tenant-1', is_active: true, created_at: '2026-03-02' },
      { id: 'legacy-entity', tenant_id: 'tenant-legacy', is_active: true, created_at: '2026-03-03' }
    ]
  };
}

function createLoadsDb() {
  const state = {
    loads: [
      { id: 'load-1', tenant_id: 'tenant-1', operating_entity_id: 'entity-1', load_number: 'L-1', status: 'NEW', billing_status: 'PENDING', created_at: '2026-03-01', rate: 1000 },
      { id: 'load-2', tenant_id: 'tenant-1', operating_entity_id: 'entity-2', load_number: 'L-2', status: 'NEW', billing_status: 'PENDING', created_at: '2026-03-02', rate: 1200 }
    ],
    loadStops: []
  };

  function filterLoadsByScope(loads, tenantId, operatingEntityId) {
    return loads.filter((load) => load.tenant_id === tenantId && (!operatingEntityId || load.operating_entity_id === operatingEntityId));
  }

  async function query(sql, params = []) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] };
    }

    if (sql.includes('SELECT COUNT(*) as total')) {
      const tenantId = params[0];
      const entityId = params[1];
      return { rows: [{ total: String(filterLoadsByScope(state.loads, tenantId, entityId).length) }] };
    }

    if (sql.includes('SELECT\n        l.id,') || sql.includes('SELECT\r\n        l.id,')) {
      const tenantId = params[0];
      const entityId = params[1];
      const rows = filterLoadsByScope(state.loads, tenantId, entityId).map((load) => ({
        id: load.id,
        driver_id: null,
        load_number: load.load_number,
        status: load.status,
        billing_status: load.billing_status,
        rate: load.rate,
        completed_date: null,
        pickup_date: null,
        delivery_date: null,
        attachment_count: 0,
        attachment_types: []
      }));
      return { rows };
    }

    if (sql.startsWith('INSERT INTO loads')) {
      const created = {
        id: `load-${state.loads.length + 1}`,
        tenant_id: params[0],
        operating_entity_id: params[1],
        load_number: params[2],
        status: params[3],
        billing_status: params[4],
        dispatcher_user_id: params[5],
        driver_id: params[6],
        truck_id: params[7],
        trailer_id: params[8],
        broker_id: params[9],
        broker_name: params[10],
        po_number: params[11],
        rate: params[12],
        notes: params[13],
        completed_date: params[14],
        pickup_location: params[15],
        delivery_location: params[16],
        pickup_date: params[17],
        delivery_date: params[18],
        created_at: '2026-03-10'
      };
      state.loads.push(created);
      return { rows: [created] };
    }

    if (sql.startsWith('INSERT INTO load_stops')) {
      state.loadStops.push({ load_id: params[0], stop_type: params[1] });
      return { rows: [] };
    }

    if (sql.includes('SELECT id, status FROM loads WHERE id = $1 AND tenant_id = $2 AND operating_entity_id = $3')) {
      const row = state.loads.find((load) => load.id === params[0] && load.tenant_id === params[1] && load.operating_entity_id === params[2]);
      return { rows: row ? [{ id: row.id, status: row.status }] : [] };
    }

    if (sql.startsWith('DELETE FROM loads WHERE id = $1 AND tenant_id = $2 AND operating_entity_id = $3')) {
      const index = state.loads.findIndex((load) => load.id === params[0] && load.tenant_id === params[1] && load.operating_entity_id === params[2]);
      if (index >= 0) state.loads.splice(index, 1);
      return { rows: [] };
    }

    if (sql.includes('FROM loads l') && sql.includes('WHERE l.id = $1')) {
      const [id, tenantId, entityId] = params;
      const row = state.loads.find((load) => load.id === id && (!tenantId || load.tenant_id === tenantId) && (!entityId || load.operating_entity_id === entityId));
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith('SELECT * FROM load_stops')) {
      return { rows: [] };
    }

    if (sql.startsWith('SELECT * FROM load_attachments')) {
      return { rows: [] };
    }

    throw new Error(`Unhandled loads SQL: ${sql.slice(0, 120)}`);
  }

  const client = {
    query,
    release() {}
  };

  return {
    state,
    dbModule: {
      query,
      async getClient() {
        return client;
      }
    }
  };
}

function createDriversDb() {
  const state = {
    drivers: [
      { id: 'driver-1', tenant_id: 'tenant-1', first_name: 'Alice', last_name: 'One', status: 'active', created_at: '2026-03-01' },
      { id: 'driver-2', tenant_id: 'tenant-2', first_name: 'Bob', last_name: 'Two', status: 'active', created_at: '2026-03-02' }
    ]
  };

  async function query(sql, params = []) {
    if (sql.startsWith('SELECT * FROM drivers WHERE tenant_id = $1')) {
      return { rows: state.drivers.filter((driver) => driver.tenant_id === params[0]) };
    }

    if (sql.startsWith('SELECT * FROM drivers WHERE id = $1 AND tenant_id = $2')) {
      const row = state.drivers.find((driver) => driver.id === params[0] && driver.tenant_id === params[1]);
      return { rows: row ? [row] : [] };
    }

    if (sql.includes('FROM driver_licenses') || sql.includes('FROM driver_compliance') || sql.includes('FROM expense_responsibility_profiles') || sql.includes('FROM driver_payee_assignments')) {
      return { rows: [] };
    }

    if (sql.startsWith('INSERT INTO drivers')) {
      const created = {
        id: `driver-${state.drivers.length + 1}`,
        tenant_id: params[0],
        first_name: params[1],
        last_name: params[2],
        email: params[3],
        phone: params[4],
        cdl_number: params[5],
        cdl_state: params[6],
        status: 'active'
      };
      state.drivers.push(created);
      return { rows: [created] };
    }

    if (sql.startsWith('UPDATE drivers SET') && sql.includes('WHERE id = $') && sql.includes('AND tenant_id = $')) {
      const id = params[params.length - 2];
      const tenantId = params[params.length - 1];
      const row = state.drivers.find((driver) => driver.id === id && driver.tenant_id === tenantId);
      return { rows: row ? [{ ...row, first_name: 'Updated' }] : [] };
    }

    if (sql.startsWith('DELETE FROM drivers WHERE id = $1 AND tenant_id = $2 RETURNING *')) {
      const index = state.drivers.findIndex((driver) => driver.id === params[0] && driver.tenant_id === params[1]);
      if (index === -1) return { rows: [] };
      const [deleted] = state.drivers.splice(index, 1);
      return { rows: [deleted] };
    }

    if (sql.includes('FROM driver_licenses') && sql.includes('driver_id <>')) {
      return { rows: [] };
    }

    return { rows: [] };
  }

  return {
    state,
    dbModule: {
      query,
      async getClient() {
        return {
          query,
          release() {}
        };
      }
    }
  };
}

function createReportsKnex() {
  const inventoryRows = [
    { location_name: 'Main', tenant_id: 'tenant-1', location_id: 'loc-1', sku: 'A', part_name: 'Part A' },
    { location_name: 'Main', tenant_id: 'tenant-2', location_id: 'loc-2', sku: 'B', part_name: 'Part B' }
  ];

  class Builder {
    constructor(rows) {
      this.rows = rows;
      this.tenantId = null;
      this.locationId = null;
    }

    join() { return this; }
    select() { return this; }
    where(column, value) {
      const normalized = normalizeColumn(column);
      if (normalized === 'tenant_id') this.tenantId = value;
      if (normalized === 'location_id') this.locationId = value;
      return this;
    }
    andWhere(column, value) { return this.where(column, value); }
    whereRaw() { return this; }
    andWhereRaw() { return this; }
    modify(callback) { callback(this); return this; }
    orderBy() { return this; }
    limit() { return this; }
    offset() { return this; }
    then(resolve, reject) {
      let rows = [...this.rows];
      if (this.tenantId) rows = rows.filter((row) => row.tenant_id === this.tenantId);
      if (this.locationId) rows = rows.filter((row) => row.location_id === this.locationId);
      Promise.resolve(rows).then(resolve, reject);
    }
  }

  function knex(tableName) {
    if (tableName === 'inventory') {
      return new Builder(inventoryRows);
    }
    throw new Error(`Unhandled reports table: ${tableName}`);
  }

  knex.raw = () => ({ rows: [] });
  return knex;
}

function createDashboardDb() {
  const state = {
    drivers: [
      { id: 'd1', tenant_id: 'tenant-1', status: 'active', medical_cert_expiry: '2026-04-01', cdl_expiry: '2026-04-01', clearinghouse_status: 'eligible', dqf_completeness: 90 },
      { id: 'd2', tenant_id: 'tenant-2', status: 'active', medical_cert_expiry: '2026-04-01', cdl_expiry: '2026-04-01', clearinghouse_status: 'eligible', dqf_completeness: 80 }
    ],
    loads: [
      { id: 'l1', tenant_id: 'tenant-1', operating_entity_id: 'entity-1', status: 'NEW', billing_status: 'PENDING' },
      { id: 'l1b', tenant_id: 'tenant-1', operating_entity_id: 'entity-1', status: 'NEW', billing_status: 'PENDING' },
      { id: 'l2', tenant_id: 'tenant-1', operating_entity_id: 'entity-2', status: 'NEW', billing_status: 'PENDING' },
      { id: 'l3', tenant_id: 'tenant-2', operating_entity_id: 'entity-9', status: 'NEW', billing_status: 'PENDING' }
    ]
  };

  async function query(_sql, params = []) {
    const [tenantId, entityId] = params;
    const scopedLoads = state.loads.filter((load) => load.tenant_id === tenantId && (!entityId || load.operating_entity_id === entityId));
    const scopedDrivers = state.drivers.filter((driver) => driver.tenant_id === tenantId);
    return {
      rows: [{
        activeDrivers: String(scopedDrivers.filter((driver) => driver.status === 'active').length),
        totalDrivers: String(scopedDrivers.length),
        activeVehicles: '0',
        totalVehicles: '0',
        oosVehicles: '0',
        activeLoads: '0',
        pendingLoads: String(scopedLoads.length),
        completedLoadsToday: '0',
        loadsDispatched: '0',
        loadsInTransit: '0',
        loadsDelivered: '0',
        loadsCanceled: '0',
        billingPending: String(scopedLoads.length),
        billingCanceled: '0',
        billingInvoiced: '0',
        billingFunded: '0',
        billingPaid: '0',
        hosViolations: '0',
        hosWarnings: '0',
        dqfComplianceRate: '90',
        vehiclesNeedingMaintenance: '0',
        expiredMedCerts: '0',
        upcomingMedCerts: '0',
        expiredCDLs: '0',
        clearinghouseIssues: '0'
      }]
    };
  }

  const knex = function fakeKnex() {
    return {
      select() { return this; },
      where() { return this; },
      modify() { return this; },
      then(resolve) { resolve([]); }
    };
  };
  knex.raw = async () => ({ rows: [] });

  return { dbModule: { query, knex } };
}

describe('Phase 3 protected route smoke tests', () => {
  it('smoke-tests loads routes with default entity, header switch, invalid header, stamping, and scoped delete', async () => {
    const tenantState = createTenantState();
    const { dbModule, state } = createLoadsDb();
    const loaded = loadModuleWithMocks('routes/loads.js', {
      'internal/db.js': dbModule,
      'utils/logger.js': createNoopLogger(),
      'middleware/auth-middleware.js': authModuleMock,
      'services/load-ai-extractor.js': { extractLoadFromPdf: async () => ({}) },
      'storage/r2-storage.js': { uploadBuffer: async () => ({ key: 'unused' }), getSignedDownloadUrl: async () => null, deleteObject: async () => {} }
    });

    try {
      const app = createJsonApp(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const defaultList = await requestJson(server, 'GET', '/');
        assert.strictEqual(defaultList.status, 200);
        assert.strictEqual(defaultList.body.data.length, 1);
        assert.strictEqual(defaultList.body.data[0].id, 'load-1');

        const switchedList = await requestJson(server, 'GET', '/', {
          headers: { 'x-operating-entity-id': 'entity-2' }
        });
        assert.strictEqual(switchedList.status, 200);
        assert.strictEqual(switchedList.body.data.length, 1);
        assert.strictEqual(switchedList.body.data[0].id, 'load-2');

        const invalidHeader = await requestJson(server, 'GET', '/', {
          headers: { 'x-operating-entity-id': 'entity-denied' }
        });
        assert.strictEqual(invalidHeader.status, 403);

        const beforeInvalidCreate = state.loads.length;
        const blockedCreate = await requestJson(server, 'POST', '/', {
          headers: { 'x-role': 'dispatch', 'x-operating-entity-id': 'entity-denied' },
          body: {
            loadNumber: 'DENIED-LOAD',
            stops: [
              { stopType: 'PICKUP', city: 'A', state: 'TX', zip: '75001', sequence: 1 },
              { stopType: 'DELIVERY', city: 'B', state: 'TX', zip: '75002', sequence: 2 }
            ]
          }
        });
        assert.strictEqual(blockedCreate.status, 403);
        assert.strictEqual(state.loads.length, beforeInvalidCreate);
        assert.strictEqual(state.loads.some((load) => load.load_number === 'DENIED-LOAD'), false);

        const created = await requestJson(server, 'POST', '/', {
          headers: { 'x-role': 'dispatch' },
          body: {
            loadNumber: 'NEW-LOAD',
            stops: [
              { stopType: 'PICKUP', city: 'A', state: 'TX', zip: '75001', sequence: 1 },
              { stopType: 'DELIVERY', city: 'B', state: 'TX', zip: '75002', sequence: 2 }
            ]
          }
        });
        assert.strictEqual(created.status, 201);
        const createdLoad = state.loads.find((load) => load.load_number === 'NEW-LOAD');
        assert.strictEqual(createdLoad.tenant_id, 'tenant-1');
        assert.strictEqual(createdLoad.operating_entity_id, 'entity-1');

        const blockedDelete = await requestJson(server, 'DELETE', '/load-2', {
          headers: { 'x-role': 'dispatch' }
        });
        assert.strictEqual(blockedDelete.status, 404);
        assert.strictEqual(state.loads.some((load) => load.id === 'load-2'), true);
      });
    } finally {
      loaded.restore();
    }
  });

  it('smoke-tests invoices routes for default entity, header switch, invalid header, and context-stamped create/update', async () => {
    const tenantState = createTenantState();
    const serviceCalls = [];
    const invoicesService = {
      async createManualInvoice(body, userId, context) {
        serviceCalls.push({ method: 'create', body, userId, context });
        return { id: 'inv-1', tenant_id: context.tenantId, operating_entity_id: context.operatingEntityId };
      },
      async listInvoices(_query, context) {
        serviceCalls.push({ method: 'list', context });
        return { data: [{ id: `invoice-${context.operatingEntityId}` }], total: 1 };
      },
      async getInvoiceById(id, context) {
        serviceCalls.push({ method: 'get', id, context });
        return { invoice: { id } };
      },
      async updateInvoiceDraft(id, body, userId, context) {
        serviceCalls.push({ method: 'update', id, body, userId, context });
        if (id === 'forbidden' && context.operatingEntityId !== 'entity-2') {
          throw new Error('Invoice not found in active entity');
        }
        return { id, operating_entity_id: context.operatingEntityId };
      },
      async setInvoiceStatus() { return {}; },
      async addLineItem() { return {}; },
      async updateLineItem() { return {}; },
      async deleteLineItem() { return {}; },
      async addPayment() { return {}; },
      async deletePayment() { return {}; },
      async createInvoiceFromWorkOrder() { return {}; }
    };
    const loaded = loadModuleWithMocks('routes/invoices.js', {
      'middleware/auth-middleware.js': authModuleMock,
      'utils/logger.js': createNoopLogger(),
      'internal/db.js': { knex: () => ({ where() { return this; }, modify() { return this; }, first() { return Promise.resolve(null); } }) },
      'services/invoices.service.js': invoicesService,
      'utils/invoice-pdf.js': { buildInvoicePdf: async () => Buffer.from('pdf') },
      'storage/r2-storage.js': { uploadBuffer: async () => ({ key: 'doc' }), getSignedDownloadUrl: async () => 'url' }
    });

    try {
      const app = createJsonApp(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const defaultList = await requestJson(server, 'GET', '/');
        assert.strictEqual(defaultList.status, 200);
        assert.strictEqual(defaultList.body.data[0].id, 'invoice-entity-1');

        const switchedList = await requestJson(server, 'GET', '/', { headers: { 'x-operating-entity-id': 'entity-2' } });
        assert.strictEqual(switchedList.status, 200);
        assert.strictEqual(switchedList.body.data[0].id, 'invoice-entity-2');

        const invalidHeader = await requestJson(server, 'GET', '/', { headers: { 'x-operating-entity-id': 'entity-denied' } });
        assert.strictEqual(invalidHeader.status, 403);

        const createCallsBeforeInvalid = serviceCalls.filter((call) => call.method === 'create').length;
        const blockedCreate = await requestJson(server, 'POST', '/', {
          headers: { 'x-operating-entity-id': 'entity-denied' },
          body: { invoiceNumber: 'INV-DENIED' }
        });
        assert.strictEqual(blockedCreate.status, 403);
        assert.strictEqual(serviceCalls.filter((call) => call.method === 'create').length, createCallsBeforeInvalid);

        const created = await requestJson(server, 'POST', '/', {
          body: { invoiceNumber: 'INV-1' }
        });
        assert.strictEqual(created.status, 201);
        assert.strictEqual(serviceCalls.find((call) => call.method === 'create').context.operatingEntityId, 'entity-1');

        const updated = await requestJson(server, 'PUT', '/forbidden', {
          headers: { 'x-operating-entity-id': 'entity-2' },
          body: { notes: 'ok' }
        });
        assert.strictEqual(updated.status, 200);
        assert.strictEqual(serviceCalls.find((call) => call.method === 'update').context.operatingEntityId, 'entity-2');
      });
    } finally {
      loaded.restore();
    }
  });

  it('smoke-tests settlements routes for default entity, header switch, invalid header, and scoped draft/list behavior', async () => {
    const tenantState = createTenantState();
    const settlementCalls = [];
    const settlementService = {
      async getEligibleLoads(_knex, _client, _driverId, _periodStart, _periodEnd, _dateBasis, context) {
        settlementCalls.push({ method: 'eligible', context });
        return [{ id: `eligible-${context.operatingEntityId}` }];
      },
      async listSettlements(_knex, _filters, context) {
        settlementCalls.push({ method: 'list', context });
        return [{ id: `settlement-${context.operatingEntityId}` }];
      },
      async createDraftSettlement(_periodId, _driverId, _dateBasis, _userId, _knex, context) {
        settlementCalls.push({ method: 'draft', context });
        return { id: 'draft-1', tenant_id: context.tenantId, operating_entity_id: context.operatingEntityId };
      },
      async recalcAndUpdateSettlement() {},
      async addLoadToSettlement() {},
      async removeLoadFromSettlement() {},
      async addAdjustment() {},
      async removeAdjustment() {},
      async restoreScheduledAdjustment() {},
      async approveSettlement() {},
      async voidSettlement() {},
      async getActiveCompensationProfile() {},
      async ensureActiveCompensationProfile() {},
      async getActivePayeeAssignment() {},
      async getRecurringDeductionsForPeriod() { return []; }
    };
    const loaded = loadModuleWithMocks('routes/settlements.js', {
      'middleware/auth-middleware.js': authModuleMock,
      'config/knex.js': () => ({ where() { return this; }, first() { return Promise.resolve(null); }, join() { return this; }, leftJoin() { return this; }, select() { return this; }, orderBy() { return this; }, raw() { return ''; } }),
      'storage/r2-storage.js': { uploadBuffer: async () => ({ key: 'unused' }), getSignedDownloadUrl: async () => 'url' },
      'services/settlement-pdf.service.js': {
        buildSettlementPdf: async () => Buffer.from('pdf'),
        getSettlementDisplayNumber: () => 'STL-TEST',
        getSettlementPdfFileName: () => 'STL-TEST.pdf'
      },
      'services/settlement-service.js': settlementService,
      'internal/db.js': { async getClient() { return { release() {} }; } }
    });

    try {
      const app = createJsonApp(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const eligible = await requestJson(server, 'GET', '/eligible-loads?driver_id=d1&period_start=2026-03-01&period_end=2026-03-07');
        assert.strictEqual(eligible.status, 200);
        assert.strictEqual(eligible.body[0].id, 'eligible-entity-1');

        const switchedEligible = await requestJson(server, 'GET', '/eligible-loads?driver_id=d1&period_start=2026-03-01&period_end=2026-03-07', {
          headers: { 'x-operating-entity-id': 'entity-2' }
        });
        assert.strictEqual(switchedEligible.status, 200);
        assert.strictEqual(switchedEligible.body[0].id, 'eligible-entity-2');

        const invalidHeader = await requestJson(server, 'GET', '/settlements', {
          headers: { 'x-operating-entity-id': 'entity-denied' }
        });
        assert.strictEqual(invalidHeader.status, 403);

        const draft = await requestJson(server, 'POST', '/draft', {
          body: { payroll_period_id: 'pp1', driver_id: 'd1' }
        });
        assert.strictEqual(draft.status, 201);
        assert.strictEqual(settlementCalls.find((call) => call.method === 'draft').context.operatingEntityId, 'entity-1');

        const settlementPdf = await requestJson(server, 'GET', '/settlements/entity-1/pdf');
        assert.strictEqual(settlementPdf.status, 404);
        assert.strictEqual(settlementPdf.body.error, 'Settlement not found');
      });
    } finally {
      loaded.restore();
    }
  });

  it('smoke-tests reports and dashboard reads for scoped default entity, header switch, and invalid header rejection', async () => {
    const tenantState = createTenantState();
    const reportsLoaded = loadModuleWithMocks('routes/reports.js', {
      'middleware/auth-middleware.js': authModuleMock,
      'utils/logger.js': createNoopLogger(),
      'internal/db.js': { knex: createReportsKnex() }
    });
    const dashboardLoaded = loadModuleWithMocks('routes/dashboard.js', {
      'routes/auth-middleware.js': authModuleMock,
      'utils/logger.js': createNoopLogger(),
      'internal/db.js': createDashboardDb().dbModule
    });

    try {
      const app = express();
      app.use(express.json());
      app.use(authFromHeaders);
      app.use(createTenantContextMiddleware({ knexClient: createTenantKnex(tenantState), logger: createNoopLogger() }));
      app.use('/reports', reportsLoaded.module);
      app.use('/dashboard', dashboardLoaded.module);

      await withServer(app, async (server) => {
        const inventory = await requestJson(server, 'GET', '/reports/inventory-status');
        assert.strictEqual(inventory.status, 200);
        assert.strictEqual(inventory.body.data.length, 1);
        assert.strictEqual(inventory.body.data[0].tenant_id, 'tenant-1');

        const dashboardDefault = await requestJson(server, 'GET', '/dashboard/stats');
        assert.strictEqual(dashboardDefault.status, 200);
        assert.strictEqual(dashboardDefault.body.pendingLoads, '2');

        const dashboardSwitched = await requestJson(server, 'GET', '/dashboard/stats', {
          headers: { 'x-operating-entity-id': 'entity-2' }
        });
        assert.strictEqual(dashboardSwitched.status, 200);
        assert.strictEqual(dashboardSwitched.body.pendingLoads, '1');

        const invalidHeader = await requestJson(server, 'GET', '/dashboard/stats', {
          headers: { 'x-operating-entity-id': 'entity-denied' }
        });
        assert.strictEqual(invalidHeader.status, 403);
      });
    } finally {
      reportsLoaded.restore();
      dashboardLoaded.restore();
    }
  });

  it('smoke-tests work orders routes for default entity, header switch, invalid header, and scoped update behavior', async () => {
    const tenantState = createTenantState();
    const calls = [];
    const workOrdersService = {
      async listWorkOrders(_query, context) {
        calls.push({ method: 'list', context });
        return { data: [{ id: `wo-${context.operatingEntityId}` }], total: 1 };
      },
      async createWorkOrder(_body, _userId, context) {
        calls.push({ method: 'create', context });
        return { id: 'wo-new', tenant_id: context.tenantId, operating_entity_id: context.operatingEntityId };
      },
      async getWorkOrderById(id, context) {
        calls.push({ method: 'get', id, context });
        return { id, invoices: [] };
      },
      async updateWorkOrder(id, _body, _userId, context) {
        calls.push({ method: 'update', id, context });
        if (id === 'wo-entity-2' && context.operatingEntityId !== 'entity-2') {
          throw new Error('Work order not found in active entity');
        }
        return { id, operating_entity_id: context.operatingEntityId };
      },
      async updateWorkOrderStatus() { return {}; },
      async addLaborLine() { return {}; },
      async updateLaborLine() { return {}; },
      async deleteLaborLine() { return {}; },
      async reservePart() { return {}; },
      async reservePartsFromBarcodes() { return {}; },
      async issuePart() { return {}; },
      async returnPart() { return {}; },
      async updateCharges() { return {}; },
      async generateInvoiceForWorkOrder() { return {}; }
    };
    const loaded = loadModuleWithMocks('routes/work-orders-hub.js', {
      'middleware/auth-middleware.js': authModuleMock,
      'utils/logger.js': createNoopLogger(),
      'services/work-orders.service.js': workOrdersService,
      'internal/db.js': { knex: () => ({ where() { return this; }, first() { return Promise.resolve(null); } }) },
      'storage/r2-storage.js': { uploadBuffer: async () => ({ key: 'unused' }), getSignedDownloadUrl: async () => 'url' }
    });

    try {
      const app = createJsonApp(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const list = await requestJson(server, 'GET', '/');
        assert.strictEqual(list.status, 200);
        assert.strictEqual(list.body.data[0].id, 'wo-entity-1');

        const create = await requestJson(server, 'POST', '/', { body: { title: 'WO' } });
        assert.strictEqual(create.status, 201);
        assert.strictEqual(calls.find((call) => call.method === 'create').context.operatingEntityId, 'entity-1');

        const switchedUpdate = await requestJson(server, 'PUT', '/wo-entity-2', {
          headers: { 'x-operating-entity-id': 'entity-2' },
          body: { title: 'Updated' }
        });
        assert.strictEqual(switchedUpdate.status, 200);

        // Cross-entity update attempt without switching entity must fail safely.
        const blockedCrossEntityUpdate = await requestJson(server, 'PUT', '/wo-entity-2', {
          body: { title: 'Should not update' }
        });
        assert.strictEqual([400, 404, 403].includes(blockedCrossEntityUpdate.status), true);

        const invalidHeader = await requestJson(server, 'GET', '/', { headers: { 'x-operating-entity-id': 'entity-denied' } });
        assert.strictEqual(invalidHeader.status, 403);

        const createCallsBeforeInvalid = calls.filter((call) => call.method === 'create').length;
        const blockedCreate = await requestJson(server, 'POST', '/', {
          headers: { 'x-operating-entity-id': 'entity-denied' },
          body: { title: 'Denied' }
        });
        assert.strictEqual(blockedCreate.status, 403);
        assert.strictEqual(calls.filter((call) => call.method === 'create').length, createCallsBeforeInvalid);
      });
    } finally {
      loaded.restore();
    }
  });

  it('smoke-tests drivers routes for tenant read isolation, tenant stamping on create, scoped update, and scoped delete', async () => {
    const tenantState = createTenantState();
    const { dbModule, state } = createDriversDb();
    const tenantMiddleware = createTenantContextMiddleware({ knexClient: createTenantKnex(tenantState), logger: createNoopLogger() });
    const loaded = loadModuleWithMocks('routes/drivers.js', {
      'internal/db.js': dbModule,
      'utils/logger.js': createNoopLogger(),
      'middleware/auth-middleware.js': authModuleMock,
      'middleware/tenant-context-middleware.js': tenantMiddleware
    });

    try {
      const app = createJsonApp(loaded.module, tenantState, { skipAppAuth: true, skipAppTenantContext: true });
      await withServer(app, async (server) => {
        const list = await requestJson(server, 'GET', '/');
        assert.strictEqual(list.status, 200);
        assert.strictEqual(list.body.length, 1);
        assert.strictEqual(list.body[0].id, 'driver-1');

        const created = await requestJson(server, 'POST', '/', {
          body: {
            firstName: 'New',
            lastName: 'Driver',
            email: 'new@example.com',
            phone: '555-1111',
            cdlNumber: '1234567',
            cdlState: 'TX'
          }
        });
        assert.strictEqual(created.status, 201);
        const createdDriver = state.drivers.find((driver) => driver.email === 'new@example.com');
        assert.strictEqual(createdDriver.tenant_id, 'tenant-1');

        const blockedUpdate = await requestJson(server, 'PUT', '/driver-2', {
          body: { firstName: 'Hack' }
        });
        assert.strictEqual(blockedUpdate.status, 404);
        const driver2AfterBlockedUpdate = state.drivers.find((driver) => driver.id === 'driver-2');
        assert.strictEqual(driver2AfterBlockedUpdate.first_name, 'Bob');

        const blockedDelete = await requestJson(server, 'DELETE', '/driver-2');
        assert.strictEqual(blockedDelete.status, 404);
        const driver2AfterBlockedDelete = state.drivers.find((driver) => driver.id === 'driver-2');
        assert.strictEqual(!!driver2AfterBlockedDelete, true);
      });
    } finally {
      loaded.restore();
    }
  });
});