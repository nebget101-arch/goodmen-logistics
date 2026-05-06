'use strict';

// FN-1438 — POST /api/loads/:id/recommend-driver
//
// Verifies tenant scoping (load lookup is bound to req.context.tenantId), the
// pre-AI HOS filter (drivers with zero/negative HOS remaining are dropped),
// and the graceful AI-service-failure fallback (200 with empty candidates +
// "AI service unavailable" reasoning, so the dispatcher UI can fall through
// to manual assignment instead of erroring out).

const path = require('path');
const express = require('express');
const { describe, it, beforeEach, afterEach } = require('node:test');
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
    role: req.headers['x-role'] || 'dispatch',
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

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const OE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const LOAD_ID = '44444444-4444-4444-8444-444444444444';
const BROKER_ID = '55555555-5555-4555-8555-555555555555';

function tenantStateWithDefaultEntity() {
  return {
    userTenantMemberships: [
      { user_id: USER_ID, tenant_id: TENANT_ID, is_active: true, is_default: true, created_at: '2026-03-01' }
    ],
    userOperatingEntities: [
      { user_id: USER_ID, operating_entity_id: OE_ID, is_active: true, is_default: true, created_at: '2026-03-01' }
    ],
    users: [],
    tenants: [{ id: TENANT_ID, status: 'active', created_at: '2026-03-01' }],
    operatingEntities: [
      { id: OE_ID, tenant_id: TENANT_ID, is_active: true, created_at: '2026-03-01' }
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

// Build a configurable DB stub for the recommend-driver route. The route
// fires two queries (load lookup, then candidate aggregation); the helper
// recognises each by a unique substring and returns whatever the test set up.
function createRecommendDriverDb({ loadRow, candidateRows }) {
  const calls = [];
  async function query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('first_pickup AS') && sql.includes('FROM loads l')) {
      return { rows: loadRow ? [loadRow] : [] };
    }
    if (sql.includes('latest_hos AS') && sql.includes('FROM drivers d')) {
      return { rows: candidateRows || [] };
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

// Capture the real `fetch` once at module load — tests override `global.fetch`
// to stub the AI service, and requestJson must keep using the real client to
// reach the test server.
const REAL_FETCH = global.fetch;

async function requestJson(server, method, routePath, { headers = {} } = {}) {
  const response = await REAL_FETCH(`http://127.0.0.1:${server.address().port}${routePath}`, {
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

function loadRowFixture(overrides = {}) {
  return {
    id: LOAD_ID,
    broker_id: BROKER_ID,
    pickup_date: '2026-05-08',
    driver_id: null,
    ai_metadata: { equipmentClass: '53FT_DRY' },
    pickup_zip: '75201',
    pickup_stop_date: '2026-05-08',
    origin_lat: '32.7800',
    origin_lng: '-96.8000',
    ...overrides
  };
}

describe('POST /api/loads/:id/recommend-driver (FN-1438)', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('rejects non-uuid load ids with 400', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { dbModule } = createRecommendDriverDb({ loadRow: null, candidateRows: [] });
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
        const res = await requestJson(server, 'POST', '/not-a-uuid/recommend-driver', { headers: { 'x-role': 'dispatch' } });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.success, false);
      });
    } finally {
      loaded.restore();
    }
  });

  it('binds tenant + operating-entity to the load lookup', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    // No load row — exercise the 404 path while we inspect the bound params.
    const { dbModule, calls } = createRecommendDriverDb({ loadRow: null, candidateRows: [] });
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
        const res = await requestJson(server, 'POST', `/${LOAD_ID}/recommend-driver`, { headers: { 'x-role': 'dispatch' } });
        assert.strictEqual(res.status, 404);
        const loadCall = calls.find((c) => c.sql.includes('first_pickup AS'));
        assert.ok(loadCall, 'expected load lookup query to fire');
        assert.deepStrictEqual(loadCall.params, [LOAD_ID, TENANT_ID, OE_ID]);
      });
    } finally {
      loaded.restore();
    }
  });

  it('drops drivers with zero or negative HOS before calling the AI service', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const candidateRows = [
      // Capped driver — 11h driving, 14h on-duty — must be filtered out.
      { driver_id: 'd1', name: 'Spent Steve', lat: '32.5', lng: '-96.9',
        driving_hours: '11.00', on_duty_hours: '14.00', equipment_class: 'truck',
        last_with_broker_date: null },
      // Healthy driver — must be kept.
      { driver_id: 'd2', name: 'Fresh Fay', lat: '32.6', lng: '-96.7',
        driving_hours: '4.00', on_duty_hours: '5.00', equipment_class: 'truck',
        last_with_broker_date: null }
    ];
    const { dbModule } = createRecommendDriverDb({ loadRow: loadRowFixture(), candidateRows });
    const loaded = loadModuleWithMocks('routes/loads.js', {
      'internal/db.js': dbModule,
      'utils/logger.js': noopLogger(),
      'middleware/auth-middleware.js': authModuleMock,
      'services/load-ai-extractor.js': { extractLoadFromPdf: async () => ({}) },
      'storage/r2-storage.js': { uploadBuffer: async () => ({ key: 'u' }), getSignedDownloadUrl: async () => null, deleteObject: async () => {} }
    });

    let aiBodySeen = null;
    global.fetch = async (_url, init) => {
      aiBodySeen = JSON.parse(init.body);
      return {
        ok: true,
        async json() {
          return {
            candidates: aiBodySeen.candidateDrivers.map((c) => ({
              driverId: c.driverId,
              score: 0.9,
              rationale: 'mock',
              hosRemaining: c.hosRemainingHours,
              distanceMiles: 50,
              equipmentMatch: true,
              lastLoadWithCustomer: c.lastLoadWithCustomer
            })),
            reasoning: 'mock'
          };
        },
        async text() { return ''; }
      };
    };

    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'POST', `/${LOAD_ID}/recommend-driver`, { headers: { 'x-role': 'dispatch' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.ok(aiBodySeen, 'AI service should have been called');
        const ids = aiBodySeen.candidateDrivers.map((c) => c.driverId);
        assert.deepStrictEqual(ids, ['d2'], 'spent driver d1 must not reach the AI service');
      });
    } finally {
      loaded.restore();
    }
  });

  it('returns 200 + empty candidates with "AI service unavailable" when AI fetch throws', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const candidateRows = [
      { driver_id: 'd2', name: 'Fresh Fay', lat: '32.6', lng: '-96.7',
        driving_hours: '4.00', on_duty_hours: '5.00', equipment_class: 'truck',
        last_with_broker_date: null }
    ];
    const { dbModule } = createRecommendDriverDb({ loadRow: loadRowFixture(), candidateRows });
    const loaded = loadModuleWithMocks('routes/loads.js', {
      'internal/db.js': dbModule,
      'utils/logger.js': noopLogger(),
      'middleware/auth-middleware.js': authModuleMock,
      'services/load-ai-extractor.js': { extractLoadFromPdf: async () => ({}) },
      'storage/r2-storage.js': { uploadBuffer: async () => ({ key: 'u' }), getSignedDownloadUrl: async () => null, deleteObject: async () => {} }
    });

    global.fetch = async () => { throw new Error('connect ECONNREFUSED'); };

    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'POST', `/${LOAD_ID}/recommend-driver`, { headers: { 'x-role': 'dispatch' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.deepStrictEqual(res.body.candidates, []);
        assert.strictEqual(res.body.reasoning, 'AI service unavailable');
      });
    } finally {
      loaded.restore();
    }
  });

  it('returns 200 + empty candidates when AI service replies with non-2xx', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const candidateRows = [
      { driver_id: 'd2', name: 'Fresh Fay', lat: '32.6', lng: '-96.7',
        driving_hours: '4.00', on_duty_hours: '5.00', equipment_class: 'truck',
        last_with_broker_date: null }
    ];
    const { dbModule } = createRecommendDriverDb({ loadRow: loadRowFixture(), candidateRows });
    const loaded = loadModuleWithMocks('routes/loads.js', {
      'internal/db.js': dbModule,
      'utils/logger.js': noopLogger(),
      'middleware/auth-middleware.js': authModuleMock,
      'services/load-ai-extractor.js': { extractLoadFromPdf: async () => ({}) },
      'storage/r2-storage.js': { uploadBuffer: async () => ({ key: 'u' }), getSignedDownloadUrl: async () => null, deleteObject: async () => {} }
    });

    global.fetch = async () => ({
      ok: false,
      status: 503,
      async json() { return {}; },
      async text() { return 'upstream down'; }
    });

    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'POST', `/${LOAD_ID}/recommend-driver`, { headers: { 'x-role': 'dispatch' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.success, true);
        assert.deepStrictEqual(res.body.candidates, []);
        assert.strictEqual(res.body.reasoning, 'AI service unavailable');
      });
    } finally {
      loaded.restore();
    }
  });

  it('caps candidate pool at 25 closest drivers by haversine before calling AI', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    // 30 drivers spread across an east-west line; only the 25 nearest to the
    // load origin (lng=-96.8) should reach the AI service.
    const candidateRows = [];
    for (let i = 0; i < 30; i += 1) {
      candidateRows.push({
        driver_id: `d${i}`,
        name: `Driver ${i}`,
        lat: '32.78',
        // step away from origin in 0.5deg increments — d0 closest, d29 furthest
        lng: String(-96.8 - i * 0.5),
        driving_hours: '0.00',
        on_duty_hours: '0.00',
        equipment_class: 'truck',
        last_with_broker_date: null
      });
    }
    const { dbModule } = createRecommendDriverDb({ loadRow: loadRowFixture(), candidateRows });
    const loaded = loadModuleWithMocks('routes/loads.js', {
      'internal/db.js': dbModule,
      'utils/logger.js': noopLogger(),
      'middleware/auth-middleware.js': authModuleMock,
      'services/load-ai-extractor.js': { extractLoadFromPdf: async () => ({}) },
      'storage/r2-storage.js': { uploadBuffer: async () => ({ key: 'u' }), getSignedDownloadUrl: async () => null, deleteObject: async () => {} }
    });

    let aiBodySeen = null;
    global.fetch = async (_url, init) => {
      aiBodySeen = JSON.parse(init.body);
      return {
        ok: true,
        async json() { return { candidates: [], reasoning: '' }; },
        async text() { return ''; }
      };
    };

    try {
      const app = mountLoadsRouter(loaded.module, tenantState);
      await withServer(app, async (server) => {
        const res = await requestJson(server, 'POST', `/${LOAD_ID}/recommend-driver`, { headers: { 'x-role': 'dispatch' } });
        assert.strictEqual(res.status, 200);
        assert.ok(aiBodySeen, 'AI service should have been called');
        assert.strictEqual(aiBodySeen.candidateDrivers.length, 25, 'pool must be capped at 25');
        // Pool must be the 25 closest — d0..d24, in ascending-distance order.
        const ids = aiBodySeen.candidateDrivers.map((c) => c.driverId);
        for (let i = 0; i < 25; i += 1) assert.strictEqual(ids[i], `d${i}`);
      });
    } finally {
      loaded.restore();
    }
  });

  it('forbids drivers (role gate)', async () => {
    const tenantState = tenantStateWithDefaultEntity();
    const { dbModule } = createRecommendDriverDb({ loadRow: loadRowFixture(), candidateRows: [] });
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
        const res = await requestJson(server, 'POST', `/${LOAD_ID}/recommend-driver`, {
          headers: { 'x-role': 'driver', 'x-driver-id': 'driver-1' }
        });
        assert.strictEqual(res.status, 403);
      });
    } finally {
      loaded.restore();
    }
  });
});
