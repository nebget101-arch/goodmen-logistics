'use strict';

// FN-1309: regression coverage for the four upstream endpoints called by the
// Smart Alerts aggregator (FN-1161). All four were missing and surfaced as
// `upstreamErrors` on every Control Center dashboard load (FN-1308 root
// cause). Built on the same in-process harness as `risk-top.test.js` and
// `loads-throughput.test.js`.

const path = require('path');
const express = require('express');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createTenantContextMiddleware } = require('../middleware/tenant-context-middleware');

const sharedRoot = path.resolve(__dirname, '..');

function resolveShared(relativePath) {
  return path.resolve(sharedRoot, relativePath);
}

function noopLogger() {
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

function authFromHeaders(req, _res, next) {
  req.user = {
    id: req.headers['x-user-id'] || '11111111-1111-4111-8111-111111111111',
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

function tenantContextModuleMock() {
  // Some routers (drivers.js) call `router.use(tenantContextMiddleware)`. The
  // outer app already populates req.context via the real middleware, so mock
  // the inner middleware as a passthrough.
  function passthrough(_req, _res, next) { next(); }
  passthrough.createTenantContextMiddleware = createTenantContextMiddleware;
  return passthrough;
}

function rbacModuleMock() {
  return {
    loadUserRbac: (_req, _res, next) => next(),
    requireAnyPermission: () => (_req, _res, next) => next()
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

function tenantStateWithDefaultEntity() {
  return {
    userTenantMemberships: [
      { user_id: '11111111-1111-4111-8111-111111111111', tenant_id: '22222222-2222-4222-8222-222222222222', is_active: true, is_default: true, created_at: '2026-03-01' }
    ],
    userOperatingEntities: [
      { user_id: '11111111-1111-4111-8111-111111111111', operating_entity_id: '33333333-3333-4333-8333-333333333333', is_active: true, is_default: true, created_at: '2026-03-01' }
    ],
    users: [],
    tenants: [{ id: '22222222-2222-4222-8222-222222222222', status: 'active', created_at: '2026-03-01' }],
    operatingEntities: [
      { id: '33333333-3333-4333-8333-333333333333', tenant_id: '22222222-2222-4222-8222-222222222222', is_active: true, created_at: '2026-03-01' }
    ]
  };
}

class FakeTenantQuery {
  constructor(tableSpec, state) {
    this.table = String(tableSpec).split(/\s+as\s+/i)[0].trim();
    this.state = state;
    this.filters = [];
    this.firstOnly = false;
  }
  join() { return this; }
  where(arg1, arg2) {
    if (typeof arg1 === 'object' && arg1 !== null) {
      for (const [key, value] of Object.entries(arg1)) this.filters.push({ column: key, value });
      return this;
    }
    this.filters.push({ column: arg1, value: arg2 });
    return this;
  }
  andWhere(arg1, arg2) { return this.where(arg1, arg2); }
  orderBy() { return this; }
  select() { return this; }
  modify(callback) { callback(this); return this; }
  first() { this.firstOnly = true; return this; }
  then(resolve, reject) { Promise.resolve(this.execute()).then(resolve, reject); }

  async execute() {
    let rows = [];
    if (this.table === 'user_tenant_memberships') rows = [...(this.state.userTenantMemberships || [])];
    else if (this.table === 'users') rows = [...(this.state.users || [])];
    else if (this.table === 'tenants') rows = [...(this.state.tenants || [])];
    else if (this.table === 'operating_entities') rows = [...(this.state.operatingEntities || [])];
    else if (this.table === 'user_operating_entities') {
      rows = (this.state.userOperatingEntities || []).map((row) => {
        const entity = (this.state.operatingEntities || []).find((c) => c.id === row.operating_entity_id) || {};
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
      rows = rows.filter((row) => {
        const col = String(filter.column).split('.').pop();
        if (col === 'user_id' && this.table === 'user_operating_entities') return row.user_id === filter.value;
        return row[col] === filter.value;
      });
    }
    return this.firstOnly ? (rows[0] || undefined) : rows;
  }
}

function createTenantKnex(state) {
  function fakeKnex(tableSpec) {
    return new FakeTenantQuery(tableSpec, state);
  }
  fakeKnex.schema = {
    async hasTable(name) {
      return ['user_tenant_memberships', 'users', 'tenants', 'operating_entities', 'user_operating_entities'].includes(name);
    }
  };
  return fakeKnex;
}

async function requestJson(server, method, routePath, { headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${routePath}`, {
    method,
    headers
  });
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch (_err) { parsed = text; }
  return { status: response.status, body: parsed };
}

async function withServer(app, callback) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try { return await callback(server); }
  finally { await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))); }
}

function mountRouter(router, tenantState) {
  const app = express();
  app.use(express.json());
  app.use(authFromHeaders);
  app.use(createTenantContextMiddleware({ knexClient: createTenantKnex(tenantState), logger: { error() {}, warn() {}, info() {} } }));
  const base = express.Router();
  base.use('/', router);
  app.use(base);
  return app;
}

// ── /api/hos/violations/imminent (FN-1309) ─────────────────────────────────

function createHosDb({ rows = [], throwTableMissing = false } = {}) {
  const calls = [];
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (throwTableMissing && typeof sql === 'string' && sql.includes('hos_records')) {
      const err = new Error('relation "hos_records" does not exist');
      err.code = '42P01';
      throw err;
    }
    if (typeof sql === 'string' && sql.includes('FROM hos_records hr') && sql.includes('latest')) {
      return { rows };
    }
    return { rows: [] };
  }
  return {
    calls,
    dbModule: {
      query,
      async getClient() { return { query, release() {} }; }
    }
  };
}

function loadHosRouter(opts = {}) {
  const { dbModule, calls } = createHosDb(opts);
  const loaded = loadModuleWithMocks('routes/hos.js', {
    'internal/db.js': dbModule,
    'utils/logger.js': noopLogger(),
    'routes/auth-middleware.js': authModuleMock,
    'routes/safety-risk-engine.js': { triggerRecalculation: async () => {} }
  });
  return { loaded, calls };
}

describe('GET /api/hos/violations/imminent (FN-1309)', () => {
  it('returns the Smart Alerts shape and ranks by minutes_remaining ASC', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadHosRouter({
      rows: [
        {
          driver_id: 'd1111111-1111-4111-8111-111111111111',
          first_name: 'Alice',
          last_name: 'Driver',
          drive_minutes_remaining: 30,
          duty_minutes_remaining: 90,
          window_type: '11_hour_drive',
          minutes_remaining: 30
        }
      ]
    });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/violations/imminent', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body), 'response must be a JSON array');
        assert.strictEqual(res.body.length, 1);
        const row = res.body[0];
        assert.strictEqual(row.driverId, 'd1111111-1111-4111-8111-111111111111');
        assert.strictEqual(row.driverName, 'Alice Driver');
        assert.strictEqual(row.minutesRemaining, 30);
        assert.strictEqual(row.windowType, '11_hour_drive');
        assert.match(row.windowEndsAt, /^\d{4}-\d{2}-\d{2}T/);

        // Default limit must be 20.
        const sqlCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('FROM hos_records hr'));
        assert.ok(sqlCalls.length > 0);
        const lastCall = sqlCalls[sqlCalls.length - 1];
        assert.strictEqual(lastCall.params[lastCall.params.length - 1], 20, 'default limit must be 20');
      });
    } finally {
      loaded.restore();
    }
  });

  it('clamps ?limit above 100 down to 100', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadHosRouter({ rows: [] });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/violations/imminent?limit=999', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        const sqlCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('FROM hos_records hr'));
        const lastCall = sqlCalls[sqlCalls.length - 1];
        assert.strictEqual(lastCall.params[lastCall.params.length - 1], 100, 'limit must clamp to 100');
      });
    } finally {
      loaded.restore();
    }
  });

  it('rejects non-numeric ?limit with 400', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadHosRouter({ rows: [] });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/violations/imminent?limit=abc', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 400);
      });
    } finally {
      loaded.restore();
    }
  });

  it('returns [] (200) when hos_records table is missing', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadHosRouter({ throwTableMissing: true });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/violations/imminent', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.body, []);
      });
    } finally {
      loaded.restore();
    }
  });
});

// ── /api/drivers/fatigue/top (FN-1309) ──────────────────────────────────────

function createDriversDb({ rows = [], throwTableMissing = false } = {}) {
  const calls = [];
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (throwTableMissing && typeof sql === 'string' && sql.includes('hos_records')) {
      const err = new Error('relation "hos_records" does not exist');
      err.code = '42P01';
      throw err;
    }
    if (typeof sql === 'string' && sql.includes('FROM hos_records hr') && sql.includes('fatigue_score')) {
      return { rows };
    }
    return { rows: [] };
  }
  return {
    calls,
    dbModule: {
      query,
      async getClient() { return { query, release() {} }; }
    }
  };
}

function loadDriversRouter(opts = {}) {
  const { dbModule, calls } = createDriversDb(opts);
  const loaded = loadModuleWithMocks('routes/drivers.js', {
    'internal/db.js': dbModule,
    'utils/logger.js': noopLogger(),
    'middleware/auth-middleware.js': authModuleMock,
    'middleware/rbac-middleware.js': rbacModuleMock(),
    'middleware/tenant-context-middleware.js': tenantContextModuleMock(),
    'services/toll-device-driver-sync.js': { syncTollDeviceDrivers: async () => {} },
    'services/driver-compensation-profile-sync.js': {
      hasDriverCompensationUpdate: () => false,
      pickLatestEquipmentOwnerPercentage: () => null,
      resolveCompensationProfileEffectiveStartDate: () => null
    }
  });
  return { loaded, calls };
}

describe('GET /api/drivers/fatigue/top (FN-1309)', () => {
  it('returns the Smart Alerts fatigue shape with default limit of 20', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadDriversRouter({
      rows: [{
        driver_id: 'd2222222-2222-4222-8222-222222222222',
        first_name: 'Bob',
        last_name: 'Operator',
        on_duty_hours: '12.5',
        driving_hours: '10.0',
        fatigue_score: 90
      }]
    });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/fatigue/top', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body), 'response must be a JSON array');
        assert.strictEqual(res.body.length, 1);
        const row = res.body[0];
        assert.strictEqual(row.driverId, 'd2222222-2222-4222-8222-222222222222');
        assert.strictEqual(row.driverName, 'Bob Operator');
        assert.strictEqual(row.fatigueScore, 90);
        assert.strictEqual(row.consecutiveDutyHours, 12.5);

        const sqlCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('fatigue_score'));
        assert.ok(sqlCalls.length > 0);
        assert.strictEqual(sqlCalls[0].params[1], 20, 'default limit must be 20');
      });
    } finally {
      loaded.restore();
    }
  });

  it('clamps ?limit above 100 down to 100', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadDriversRouter({ rows: [] });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/fatigue/top?limit=999', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        const sqlCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('fatigue_score'));
        assert.strictEqual(sqlCalls[0].params[1], 100, 'limit must clamp to 100');
      });
    } finally {
      loaded.restore();
    }
  });

  it('rejects non-numeric ?limit with 400', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadDriversRouter({ rows: [] });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/fatigue/top?limit=abc', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
      });
    } finally {
      loaded.restore();
    }
  });

  it('returns [] when hos_records table is missing', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadDriversRouter({ throwTableMissing: true });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/fatigue/top', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.body, []);
      });
    } finally {
      loaded.restore();
    }
  });
});

// ── /api/vehicles/inspections/overdue (FN-1309) ────────────────────────────

function createVehiclesDb({ rows = [], hasVehicles = true, hasInspectionExpiry = true } = {}) {
  const calls = [];
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (typeof sql === 'string' && sql.includes("to_regclass('public.all_vehicles')")) {
      return { rows: [{ rel: hasVehicles ? 'all_vehicles' : null }] };
    }
    if (typeof sql === 'string' && sql.includes("to_regclass('public.vehicles')")) {
      return { rows: [{ rel: hasVehicles ? 'vehicles' : null }] };
    }
    if (typeof sql === 'string' && sql.includes('information_schema.columns')) {
      const cols = [];
      if (hasInspectionExpiry) cols.push({ column_name: 'inspection_expiry' });
      cols.push({ column_name: 'tenant_id' });
      cols.push({ column_name: 'unit_number' });
      return { rows: cols };
    }
    if (typeof sql === 'string' && sql.includes('inspection_expiry') && sql.includes('days_overdue')) {
      return { rows };
    }
    return { rows: [] };
  }
  return {
    calls,
    dbModule: {
      query,
      async getClient() { return { query, release() {} }; }
    }
  };
}

function loadVehiclesRouter(opts) {
  const { dbModule, calls } = createVehiclesDb(opts);
  const loaded = loadModuleWithMocks('routes/vehicles.js', {
    'internal/db.js': dbModule,
    'utils/logger.js': noopLogger(),
    'routes/auth-middleware.js': authModuleMock,
    'storage/r2-storage.js': {
      uploadBuffer: async () => ({ key: 'u' }),
      getSignedDownloadUrl: async () => null,
      deleteObject: async () => {}
    }
  });
  return { loaded, calls };
}

describe('GET /api/vehicles/inspections/overdue (FN-1309)', () => {
  it('returns the Smart Alerts inspection-overdue shape with default limit of 20', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadVehiclesRouter({
      rows: [{
        vehicle_id: 'v1111111-1111-4111-8111-111111111111',
        unit_number: 'T-101',
        inspection_expiry: '2026-04-15',
        days_overdue: 19
      }]
    });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/inspections/overdue', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body));
        assert.strictEqual(res.body.length, 1);
        const row = res.body[0];
        assert.strictEqual(row.vehicleId, 'v1111111-1111-4111-8111-111111111111');
        assert.strictEqual(row.unit, 'T-101');
        assert.strictEqual(row.daysOverdue, 19);
        assert.strictEqual(row.inspectionType, 'annual');

        const sqlCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('days_overdue'));
        assert.ok(sqlCalls.length > 0);
        const lastCall = sqlCalls[sqlCalls.length - 1];
        assert.strictEqual(lastCall.params[lastCall.params.length - 1], 20, 'default limit must be 20');
      });
    } finally {
      loaded.restore();
    }
  });

  it('clamps ?limit above 100 down to 100', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadVehiclesRouter({ rows: [] });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/inspections/overdue?limit=999', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        const sqlCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('days_overdue'));
        const lastCall = sqlCalls[sqlCalls.length - 1];
        assert.strictEqual(lastCall.params[lastCall.params.length - 1], 100, 'limit must clamp to 100');
      });
    } finally {
      loaded.restore();
    }
  });

  it('rejects non-numeric ?limit with 400', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadVehiclesRouter({ rows: [] });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/inspections/overdue?limit=abc', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 400);
      });
    } finally {
      loaded.restore();
    }
  });

  it('returns [] when no inspection_expiry column exists', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadVehiclesRouter({ rows: [], hasInspectionExpiry: false });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/inspections/overdue', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.body, []);
      });
    } finally {
      loaded.restore();
    }
  });
});

// ── /api/loads/late-risk (FN-1309) ──────────────────────────────────────────

function createLoadsDb({ rows = [], throwTableMissing = false } = {}) {
  const calls = [];
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (throwTableMissing && typeof sql === 'string' && sql.includes('last_delivery')) {
      const err = new Error('relation "load_stops" does not exist');
      err.code = '42P01';
      throw err;
    }
    if (typeof sql === 'string' && sql.includes('last_delivery') && sql.includes('eta_delta_minutes')) {
      return { rows };
    }
    return { rows: [] };
  }
  return {
    calls,
    dbModule: {
      query,
      async getClient() { return { query, release() {} }; }
    }
  };
}

function loadLoadsRouter(opts = {}) {
  const { dbModule, calls } = createLoadsDb(opts);
  const loaded = loadModuleWithMocks('routes/loads.js', {
    'internal/db.js': dbModule,
    'utils/logger.js': noopLogger(),
    'middleware/auth-middleware.js': authModuleMock,
    'services/load-ai-extractor.js': { extractLoadFromPdf: async () => ({}) },
    'storage/r2-storage.js': {
      uploadBuffer: async () => ({ key: 'u' }),
      getSignedDownloadUrl: async () => null,
      deleteObject: async () => {}
    }
  });
  return { loaded, calls };
}

describe('GET /api/loads/late-risk (FN-1309)', () => {
  it('returns the Smart Alerts late-risk shape with default limit of 20', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadLoadsRouter({
      rows: [{
        load_id: 'L1111111-1111-4111-8111-111111111111',
        load_number: 'L-12345',
        delivery_stop_date: '2026-05-04T12:00:00Z',
        delivery_city: 'Dallas',
        delivery_state: 'TX',
        eta_delta_minutes: 90
      }]
    });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/late-risk', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body));
        assert.strictEqual(res.body.length, 1);
        const row = res.body[0];
        assert.strictEqual(row.loadId, 'L1111111-1111-4111-8111-111111111111');
        assert.strictEqual(row.loadNumber, 'L-12345');
        assert.strictEqual(row.etaDelta, 90);
        assert.strictEqual(row.destination, 'Dallas, TX');

        // Tenant + operating-entity binding + default limit.
        const sqlCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('eta_delta_minutes'));
        assert.ok(sqlCalls.length > 0);
        const call = sqlCalls[sqlCalls.length - 1];
        assert.strictEqual(call.params[0], '22222222-2222-4222-8222-222222222222');
        assert.strictEqual(call.params[1], '33333333-3333-4333-8333-333333333333');
        assert.strictEqual(call.params[3], 20, 'default limit must be 20');
      });
    } finally {
      loaded.restore();
    }
  });

  it('clamps ?limit above 100 down to 100', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadLoadsRouter({ rows: [] });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/late-risk?limit=999', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        const sqlCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('eta_delta_minutes'));
        const call = sqlCalls[sqlCalls.length - 1];
        assert.strictEqual(call.params[3], 100, 'limit must clamp to 100');
      });
    } finally {
      loaded.restore();
    }
  });

  it('rejects non-numeric ?limit with 400', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadLoadsRouter({ rows: [] });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/late-risk?limit=abc', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
      });
    } finally {
      loaded.restore();
    }
  });

  it('returns [] when load_stops table is missing', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadLoadsRouter({ throwTableMissing: true });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/late-risk', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.body, []);
      });
    } finally {
      loaded.restore();
    }
  });

  it('does NOT fall through to /:id when path is /late-risk', async () => {
    // Regression: the new /late-risk static route must register before /:id.
    // Otherwise /late-risk gets cast as a UUID and crashes loads_get_failed.
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadLoadsRouter({ rows: [] });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/late-risk', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body), 'must hit static route, not /:id');
      });
    } finally {
      loaded.restore();
    }
  });
});
