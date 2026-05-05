'use strict';

/**
 * FN-1172 (parent FN-1130) — dashboard-layout route tests.
 *
 * Uses an in-memory store + a fake `req.user` / `req.context` injector so
 * the route is exercised without bringing up Postgres. Mirrors the
 * conventions in `packages/goodmen-shared/routes/user-preferences.test.js`.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

const createDashboardLayoutRouter = require('./dashboard-layout');
const {
  getRoleDefault,
  normalizeRoleKey,
  ROLE_DEFAULTS
} = require('../services/layout-store');

function makeFakeStore(initialRows = {}) {
  const rows = { ...initialRows };
  return {
    rows,
    async getLayout({ userId, role }) {
      const row = rows[userId];
      if (!row) {
        return {
          layout: getRoleDefault(role),
          is_default: true,
          role: normalizeRoleKey(role),
          updated_at: null
        };
      }
      return {
        layout: row.layout_json,
        is_default: false,
        role: normalizeRoleKey(role),
        updated_at: row.updated_at
      };
    },
    async putLayout({ userId, tenantId, role, layout }) {
      const updated_at = new Date().toISOString();
      rows[userId] = { tenant_id: tenantId, layout_json: layout, updated_at };
      return {
        layout,
        is_default: false,
        role: normalizeRoleKey(role),
        updated_at
      };
    },
    async deleteLayout({ userId }) {
      const had = !!rows[userId];
      delete rows[userId];
      return had ? 1 : 0;
    }
  };
}

function buildApp({ store, identity }) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use((req, _res, next) => {
    if (identity.userId) req.user = { id: identity.userId, role: identity.role || null };
    if (identity.tenantId) req.context = { tenantId: identity.tenantId };
    next();
  });
  app.use('/api/users/me/dashboard-layout', createDashboardLayoutRouter({ store }));
  return app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, { method, path, body, headers }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(headers || {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (_) {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('dashboard-layout route (FN-1172)', () => {
  describe('GET /api/users/me/dashboard-layout', () => {
    let store;
    let server;
    const identity = { userId: 'user-1', role: 'safety', tenantId: 'tenant-1' };

    before(async () => {
      store = makeFakeStore();
      const app = buildApp({ store, identity });
      server = await startServer(app);
    });

    after(() => {
      if (server) server.close();
    });

    it('returns role default with is_default=true when no row exists', async () => {
      const res = await request(server, {
        method: 'GET',
        path: '/api/users/me/dashboard-layout'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.is_default, true);
      assert.strictEqual(res.body.data.role, 'safety');
      assert.deepStrictEqual(res.body.data.layout, ROLE_DEFAULTS.safety);
    });

    it('returns 401 when no req.user is present', async () => {
      // separate app with no identity
      const isolatedStore = makeFakeStore();
      const app = buildApp({ store: isolatedStore, identity: {} });
      const isolatedServer = await startServer(app);
      try {
        const res = await request(isolatedServer, {
          method: 'GET',
          path: '/api/users/me/dashboard-layout'
        });
        assert.strictEqual(res.status, 401);
      } finally {
        isolatedServer.close();
      }
    });
  });

  describe('GET role-default coverage', () => {
    it('maps every legacy role alias to a known default', async () => {
      const cases = [
        { role: 'dispatch', expected: 'dispatcher' },
        { role: 'dispatcher', expected: 'dispatcher' },
        { role: 'safety', expected: 'safety' },
        { role: 'safety_manager', expected: 'safety' },
        { role: 'maintenance', expected: 'maintenance' },
        { role: 'mechanic', expected: 'maintenance' },
        { role: 'technician', expected: 'maintenance' },
        { role: 'owner', expected: 'owner' },
        { role: 'admin', expected: 'owner' },
        { role: 'unknown-role', expected: 'dispatcher' },
        { role: null, expected: 'dispatcher' }
      ];
      for (const { role, expected } of cases) {
        assert.strictEqual(normalizeRoleKey(role), expected, `role=${role}`);
        assert.deepStrictEqual(getRoleDefault(role), ROLE_DEFAULTS[expected], `role=${role}`);
      }
    });
  });

  describe('PUT /api/users/me/dashboard-layout', () => {
    let store;
    let server;
    const identity = { userId: 'user-1', role: 'dispatcher', tenantId: 'tenant-1' };

    before(async () => {
      store = makeFakeStore();
      const app = buildApp({ store, identity });
      server = await startServer(app);
    });

    after(() => {
      if (server) server.close();
    });

    it('persists a layout and subsequent GET returns is_default=false', async () => {
      const layout = {
        cards: ['quick-actions', 'daily-briefing', 'action-queue', 'predictive-insights']
      };
      const putRes = await request(server, {
        method: 'PUT',
        path: '/api/users/me/dashboard-layout',
        body: layout
      });
      assert.strictEqual(putRes.status, 200);
      assert.strictEqual(putRes.body.data.is_default, false);
      assert.deepStrictEqual(putRes.body.data.layout, layout);
      assert.deepStrictEqual(store.rows['user-1'].layout_json, layout);
      assert.strictEqual(store.rows['user-1'].tenant_id, 'tenant-1');

      const getRes = await request(server, {
        method: 'GET',
        path: '/api/users/me/dashboard-layout'
      });
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.body.data.is_default, false);
      assert.deepStrictEqual(getRes.body.data.layout, layout);
    });

    it('rejects non-object body with 400', async () => {
      const res = await request(server, {
        method: 'PUT',
        path: '/api/users/me/dashboard-layout',
        body: ['not', 'an', 'object']
      });
      assert.strictEqual(res.status, 400);
    });

    it('rejects payload exceeding the size limit with 400', async () => {
      const huge = { blob: 'x'.repeat(17 * 1024) };
      const res = await request(server, {
        method: 'PUT',
        path: '/api/users/me/dashboard-layout',
        body: huge
      });
      assert.strictEqual(res.status, 400);
    });
  });

  describe('PUT without tenant context', () => {
    it('returns 403 when tenant context is missing', async () => {
      const isolatedStore = makeFakeStore();
      const app = buildApp({
        store: isolatedStore,
        identity: { userId: 'user-1', role: 'owner' } // no tenantId
      });
      const server = await startServer(app);
      try {
        const res = await request(server, {
          method: 'PUT',
          path: '/api/users/me/dashboard-layout',
          body: { cards: [] }
        });
        assert.strictEqual(res.status, 403);
      } finally {
        server.close();
      }
    });
  });

  describe('DELETE /api/users/me/dashboard-layout', () => {
    let store;
    let server;
    const identity = { userId: 'user-1', role: 'maintenance', tenantId: 'tenant-1' };

    before(async () => {
      store = makeFakeStore({
        'user-1': {
          tenant_id: 'tenant-1',
          layout_json: { cards: ['custom'] },
          updated_at: new Date().toISOString()
        }
      });
      const app = buildApp({ store, identity });
      server = await startServer(app);
    });

    after(() => {
      if (server) server.close();
    });

    it('removes the persisted row and returns the role default', async () => {
      const res = await request(server, {
        method: 'DELETE',
        path: '/api/users/me/dashboard-layout'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.is_default, true);
      assert.deepStrictEqual(res.body.data.layout, ROLE_DEFAULTS.maintenance);
      assert.strictEqual(store.rows['user-1'], undefined);
    });
  });
});
