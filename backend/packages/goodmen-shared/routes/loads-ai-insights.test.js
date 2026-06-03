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

// DB stub that returns empty rowsets with the expected shape for each
// ai-insights sub-query, so the route handler can run end-to-end.
function createInsightsDb() {
  const calls = [];

  async function query(sql, params = []) {
    calls.push({ sql, params });
    // Metrics aggregate: single row with 6 numeric totals.
    if (sql.includes('AS gross') && sql.includes('AS gross_prev')) {
      return {
        rows: [{
          gross: '0',
          gross_prev: '0',
          delivered: '0',
          delivered_prev: '0',
          in_transit: '0',
          in_transit_prev: '0'
        }]
      };
    }
    // Margin aggregate: single row, two counts.
    if (sql.includes('low_margin_count') && sql.includes('high_margin_count')) {
      return { rows: [{ low_margin_count: 0, high_margin_count: 0 }] };
    }
    // Every other insight sub-query: `SELECT COUNT(*)::int AS count ...`
    if (sql.includes('AS count')) {
      return { rows: [{ count: 0 }] };
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

function mountLoadsRouter(router, tenantState) {
  const app = express();
  app.use(express.json());
  app.use(authFromHeaders);
  app.use(createTenantContextMiddleware({ knexClient: createTenantKnex(tenantState), logger: noopLogger() }));
  const base = express.Router();
  base.use('/', router);
  app.use(base);
  return app;
}

describe('GET /api/loads/ai-insights (FN-793)', () => {
  it('rejects invalid period with 400', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { dbModule } = createInsightsDb();
    const loaded = loadModuleWithMocks('routes/loads.js', {
      'internal/db.js': dbModule,
      'utils/logger.js': noopLogger(),
      'middleware/auth-middleware.js': authModuleMock,
      'services/load-ai-extractor.js': { extractLoadFromPdf: async () => ({}) },
      'storage/r2-storage.js': { uploadBuffer: async () => ({ key: 'u' }), getSignedDownloadUrl: async () => null, deleteObject: async () => {} }
    });
    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/ai-insights?period=year', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
      });
    } finally {
      loaded.restore();
    }
  });

  it('returns metrics + empty insights for each valid period when DB is empty', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { dbModule, calls } = createInsightsDb();
    const loaded = loadModuleWithMocks('routes/loads.js', {
      'internal/db.js': dbModule,
      'utils/logger.js': noopLogger(),
      'middleware/auth-middleware.js': authModuleMock,
      'services/load-ai-extractor.js': { extractLoadFromPdf: async () => ({}) },
      'storage/r2-storage.js': { uploadBuffer: async () => ({ key: 'u' }), getSignedDownloadUrl: async () => null, deleteObject: async () => {} }
    });
    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        for (const period of ['today', 'week', 'month', 'all']) {
          const res = await requestJson(server, 'GET', `/ai-insights?period=${period}`, { headers: { 'x-role': 'admin' } });
          assert.strictEqual(res.status, 200, `period=${period} should 200`);
          assert.strictEqual(res.body.success, true);
          assert.strictEqual(res.body.period, period);
          assert.ok(res.body.metrics, `period=${period} metrics missing`);
          for (const key of ['gross', 'delivered', 'in_transit', 'needs_attention']) {
            assert.ok(Object.prototype.hasOwnProperty.call(res.body.metrics, key), `metrics.${key} missing`);
            assert.strictEqual(typeof res.body.metrics[key].value, 'number');
          }
          assert.ok(Array.isArray(res.body.insights));
          assert.strictEqual(res.body.insights.length, 0);
        }
        // Every scoped query must have tenant + entity bound as the first two positional args.
        const scoped = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('l.tenant_id = $1'));
        assert.ok(scoped.length > 0, 'expected scoped queries to fire');
        for (const call of scoped) {
          assert.strictEqual(call.params[0], '22222222-2222-4222-8222-222222222222', 'tenant param must be bound');
          assert.strictEqual(call.params[1], '33333333-3333-4333-8333-333333333333', 'operating-entity param must be bound');
        }
      });
    } finally {
      loaded.restore();
    }
  });

  it('forbids drivers (role gate)', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { dbModule } = createInsightsDb();
    const loaded = loadModuleWithMocks('routes/loads.js', {
      'internal/db.js': dbModule,
      'utils/logger.js': noopLogger(),
      'middleware/auth-middleware.js': authModuleMock,
      'services/load-ai-extractor.js': { extractLoadFromPdf: async () => ({}) },
      'storage/r2-storage.js': { uploadBuffer: async () => ({ key: 'u' }), getSignedDownloadUrl: async () => null, deleteObject: async () => {} }
    });
    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/ai-insights?period=week', {
          headers: { 'x-role': 'driver', 'x-driver-id': 'driver-1' }
        });
        assert.strictEqual(res.status, 403);
      });
    } finally {
      loaded.restore();
    }
  });
});
