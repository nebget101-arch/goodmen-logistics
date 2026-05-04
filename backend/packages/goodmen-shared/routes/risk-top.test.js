'use strict';

// FN-1303: regression coverage for `/api/drivers/risk/top` and
// `/api/vehicles/risk/top`. The Daily AI Briefing aggregator (FN-1141) hits
// both with `?limit=1` on every dashboard load, so any silent shape change
// would surface as `upstreamErrors` on the briefing card.

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
  // drivers.js calls `router.use(tenantContextMiddleware)`. The outer app
  // already populates req.context via the real createTenantContextMiddleware,
  // so mock the inner middleware as a passthrough.
  function passthrough(_req, _res, next) { next(); }
  passthrough.createTenantContextMiddleware = createTenantContextMiddleware;
  return passthrough;
}

function rbacModuleMock() {
  // Bypass RBAC: tests validate route shape, not permissions.
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

// ── /api/drivers/risk/top ──────────────────────────────────────────────────

function createDriversDb({ rows = [] } = {}) {
  const calls = [];
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (typeof sql === 'string' && sql.includes('FROM driver_risk_scores')) {
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

function loadDriversRouter(rows) {
  const { dbModule, calls } = createDriversDb({ rows });
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

describe('GET /api/drivers/risk/top (FN-1303)', () => {
  it('returns the briefing risk-top shape with a default limit of 1', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadDriversRouter([
      {
        driver_id: 'd1111111-1111-4111-8111-111111111111',
        score: '88.5',
        category_scores: JSON.stringify({ mvr_violations: 60, hos_violations: 20, training_gaps: 5 }),
        first_name: 'Alice',
        last_name: 'Driver'
      }
    ]);
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/risk/top', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.ok(Array.isArray(res.body.data));
        assert.strictEqual(res.body.data.length, 1);
        const row = res.body.data[0];
        assert.strictEqual(row.driverId, 'd1111111-1111-4111-8111-111111111111');
        assert.strictEqual(row.name, 'Alice Driver');
        assert.strictEqual(typeof row.riskScore, 'number');
        assert.strictEqual(row.riskScore, 88.5);
        assert.strictEqual(row.topFactor, 'mvr_violations');

        // LIMIT param defaults to 1 when ?limit is omitted.
        const driverCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('FROM driver_risk_scores'));
        assert.ok(driverCalls.length > 0);
        assert.strictEqual(driverCalls[0].params[1], 1, 'default limit must be 1');
      });
    } finally {
      loaded.restore();
    }
  });

  it('clamps ?limit above 25 down to 25', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadDriversRouter([]);
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/risk/top?limit=999', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        const driverCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('FROM driver_risk_scores'));
        assert.ok(driverCalls.length > 0);
        assert.strictEqual(driverCalls[0].params[1], 25, 'limit must clamp to 25');
      });
    } finally {
      loaded.restore();
    }
  });

  it('rejects non-numeric ?limit with 400', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadDriversRouter([]);
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/risk/top?limit=abc', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
      });
    } finally {
      loaded.restore();
    }
  });

  it('returns empty data (not 500) when driver_risk_scores table is missing', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { dbModule } = (() => {
      const calls = [];
      async function query(sql, params = []) {
        calls.push({ sql, params });
        if (typeof sql === 'string' && sql.includes('FROM driver_risk_scores')) {
          const err = new Error('relation "driver_risk_scores" does not exist');
          err.code = '42P01';
          throw err;
        }
        return { rows: [] };
      }
      return { calls, dbModule: { query, async getClient() { return { query, release() {} }; } } };
    })();
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
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/risk/top?limit=1', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.deepStrictEqual(res.body.data, []);
      });
    } finally {
      loaded.restore();
    }
  });
});

// ── /api/vehicles/risk/top ─────────────────────────────────────────────────

function createVehiclesDb({ rows = [], hasVehicles = true, hasMaintenance = true } = {}) {
  const calls = [];
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (typeof sql === 'string' && sql.includes("to_regclass('public.all_vehicles')")) {
      return { rows: [{ rel: hasVehicles ? 'all_vehicles' : null }] };
    }
    if (typeof sql === 'string' && sql.includes("to_regclass('public.vehicles')")) {
      return { rows: [{ rel: hasVehicles ? 'vehicles' : null }] };
    }
    if (typeof sql === 'string' && sql.includes("to_regclass('public.maintenance_records')")) {
      return { rows: [{ rel: hasMaintenance ? 'maintenance_records' : null }] };
    }
    if (typeof sql === 'string' && sql.includes('information_schema.columns')) {
      // Pretend the vehicle source has tenant_id and unit_number columns.
      return { rows: [{ column_name: 'tenant_id' }, { column_name: 'unit_number' }] };
    }
    if (typeof sql === 'string' && sql.includes('FROM all_vehicles') && sql.includes('maint')) {
      return { rows };
    }
    if (typeof sql === 'string' && sql.includes('FROM vehicles') && sql.includes('maint')) {
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

describe('GET /api/vehicles/risk/top (FN-1303)', () => {
  it('returns the briefing risk-top shape with a default limit of 1', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadVehiclesRouter({
      rows: [{
        vehicle_id: 'v1111111-1111-4111-8111-111111111111',
        unit_number: 'T-101',
        pending_count: 2,
        overdue_count: 1,
        breakdown_count: 0
      }]
    });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/risk/top', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.data.length, 1);
        const row = res.body.data[0];
        assert.strictEqual(row.vehicleId, 'v1111111-1111-4111-8111-111111111111');
        assert.strictEqual(row.unitNumber, 'T-101');
        assert.strictEqual(typeof row.riskScore, 'number');
        assert.ok(row.riskScore > 0 && row.riskScore <= 100);
        assert.ok(['overdue_maintenance', 'pending_maintenance', 'recent_breakdowns'].includes(row.topFactor));

        const riskCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('LIMIT $'));
        assert.ok(riskCalls.length > 0);
        // Last positional param is the LIMIT.
        const lastCall = riskCalls[riskCalls.length - 1];
        assert.strictEqual(lastCall.params[lastCall.params.length - 1], 1, 'default limit must be 1');
      });
    } finally {
      loaded.restore();
    }
  });

  it('clamps ?limit above 25 down to 25', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, calls } = loadVehiclesRouter({ rows: [] });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/risk/top?limit=999', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        const riskCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('LIMIT'));
        assert.ok(riskCalls.length > 0);
        const lastCall = riskCalls[riskCalls.length - 1];
        assert.strictEqual(lastCall.params[lastCall.params.length - 1], 25, 'limit must clamp to 25');
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
        const res = await requestJson(server, 'GET', '/risk/top?limit=abc', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
      });
    } finally {
      loaded.restore();
    }
  });

  it('returns empty data when no maintenance_records table exists', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadVehiclesRouter({ rows: [], hasMaintenance: false });
    try {
      const app = mountRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/risk/top?limit=1', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.deepStrictEqual(res.body.data, []);
      });
    } finally {
      loaded.restore();
    }
  });
});
