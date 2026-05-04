'use strict';

// FN-1303: regression coverage for the four upstream endpoints called by the
// Daily AI Briefing aggregator (FN-1141), plus the route-ordering bug where
// `/api/loads/throughput` matched `router.get('/:id')` and crashed the UUID
// cast. Built on the same in-process harness as `loads-ai-insights.test.js`.

const path = require('path');
const express = require('express');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createTenantContextMiddleware } = require('../middleware/tenant-context-middleware');

const sharedRoot = path.resolve(__dirname, '..');

function resolveShared(relativePath) {
  return path.resolve(sharedRoot, relativePath);
}

function recordingLogger() {
  const events = [];
  return {
    events,
    error(name, err, meta) { events.push({ level: 'error', name, message: err?.message, meta }); },
    warn(name, meta) { events.push({ level: 'warn', name, meta }); },
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

// DB stub: pattern-match the briefing SQL and return row shapes the route
// handler expects. Records every call so tests can assert tenant binding +
// inspect what queries actually fired.
function createBriefingDb({ throughputRow, exceptionsRow } = {}) {
  const calls = [];

  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (typeof sql === 'string' && sql.includes('AS load_count') && sql.includes('AS exception_count')) {
      return { rows: [throughputRow || {
        load_count: 0,
        delivered_count: 0,
        exception_count: 0,
        total_revenue: 0
      }] };
    }
    if (typeof sql === 'string' && sql.includes('AS overdue') && sql.includes('AS missing_docs')) {
      return { rows: [exceptionsRow || { overdue: 0, missing_docs: 0, drafts_ready: 0 }] };
    }
    // /:id detail path — should never be reached for static routes
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
  app.use(createTenantContextMiddleware({ knexClient: createTenantKnex(tenantState), logger: { error() {}, warn() {}, info() {} } }));
  const base = express.Router();
  base.use('/', router);
  app.use(base);
  return app;
}

function loadLoadsRouter(loggerOverride) {
  const logger = loggerOverride || recordingLogger();
  const { dbModule, calls } = createBriefingDb({
    throughputRow: { load_count: 7, delivered_count: 4, exception_count: 2, total_revenue: '1234.56' },
    exceptionsRow: { overdue: 1, missing_docs: 1, drafts_ready: 0 }
  });
  const loaded = loadModuleWithMocks('routes/loads.js', {
    'internal/db.js': dbModule,
    'utils/logger.js': logger,
    'middleware/auth-middleware.js': authModuleMock,
    'services/load-ai-extractor.js': { extractLoadFromPdf: async () => ({}) },
    'storage/r2-storage.js': {
      uploadBuffer: async () => ({ key: 'u' }),
      getSignedDownloadUrl: async () => null,
      deleteObject: async () => {}
    }
  });
  return { loaded, logger, calls };
}

describe('GET /api/loads/throughput (FN-1303)', () => {
  it('returns the briefing throughput shape', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, logger, calls } = loadLoadsRouter();
    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/throughput?date=2026-05-04', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.data.date, '2026-05-04');
        assert.strictEqual(typeof res.body.data.loadCount, 'number');
        assert.strictEqual(typeof res.body.data.deliveredCount, 'number');
        assert.strictEqual(typeof res.body.data.exceptionCount, 'number');
        assert.strictEqual(typeof res.body.data.totalRevenue, 'number');
        assert.strictEqual(res.body.data.loadCount, 7);
        assert.strictEqual(res.body.data.totalRevenue, 1234.56);

        // Regression guard: the /:id handler must NOT have logged its failure
        // path. If route order regresses, /throughput would land in /:id and
        // emit `loads_get_failed`.
        const getFailed = logger.events.filter((e) => e.name === 'loads_get_failed');
        assert.strictEqual(getFailed.length, 0, 'static throughput route must not log loads_get_failed');

        // Tenant + operating-entity must be bound on the throughput query.
        const throughputCalls = calls.filter((c) => typeof c.sql === 'string' && c.sql.includes('AS load_count'));
        assert.ok(throughputCalls.length > 0, 'throughput SQL should fire');
        for (const call of throughputCalls) {
          assert.strictEqual(call.params[0], '22222222-2222-4222-8222-222222222222');
          assert.strictEqual(call.params[1], '33333333-3333-4333-8333-333333333333');
          assert.strictEqual(call.params[2], '2026-05-04');
        }
      });
    } finally {
      loaded.restore();
    }
  });

  it('defaults missing date to today (UTC)', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadLoadsRouter();
    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/throughput', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.match(res.body.data.date, /^\d{4}-\d{2}-\d{2}$/);
      });
    } finally {
      loaded.restore();
    }
  });

  it('rejects non-ISO date with 400', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadLoadsRouter();
    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/throughput?date=not-a-date', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
      });
    } finally {
      loaded.restore();
    }
  });
});

describe('GET /api/loads/exceptions/count (FN-1303)', () => {
  it('returns the briefing exceptions shape', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded } = loadLoadsRouter();
    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/exceptions/count?date=2026-05-04', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.data.date, '2026-05-04');
        assert.strictEqual(typeof res.body.data.count, 'number');
        assert.strictEqual(res.body.data.count, 2); // overdue 1 + missing 1 + drafts 0
        assert.deepStrictEqual(Object.keys(res.body.data.breakdown).sort(), ['drafts_ready', 'missing_docs', 'overdue']);
      });
    } finally {
      loaded.restore();
    }
  });
});

describe('GET /api/loads/:id route ordering (FN-1303 regression)', () => {
  it('returns 404 (not 500) for non-UUID id and does not log loads_get_failed', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, logger } = loadLoadsRouter();
    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/not-a-uuid', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.body.success, false);

        const getFailed = logger.events.filter((e) => e.name === 'loads_get_failed');
        assert.strictEqual(getFailed.length, 0, 'malformed-id 404 must not log loads_get_failed');
      });
    } finally {
      loaded.restore();
    }
  });

  it('still serves the /throughput static route without falling into /:id', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { loaded, logger } = loadLoadsRouter();
    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'GET', '/throughput?date=2026-05-04', { headers: { 'x-role': 'admin' } });
        assert.strictEqual(res.status, 200);
        const getFailed = logger.events.filter((e) => e.name === 'loads_get_failed');
        assert.strictEqual(getFailed.length, 0);
      });
    } finally {
      loaded.restore();
    }
  });
});
