'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

/**
 * FN-767: Tests for the user-preferences route.
 * Uses a fake `knex`-shaped stub injected via setDatabase() so we don't need
 * a real postgres. Covers auth, GET, PUT shallow-merge, size-limit, and
 * invalid body handling.
 */

class FakeUsersTable {
  constructor(state) {
    this.state = state;
    this.filters = {};
    this.selectCol = null;
  }
  where(conds) {
    this.filters = { ...this.filters, ...conds };
    return this;
  }
  async first(col) {
    this.selectCol = col;
    const row = this.state.rows.find(r => r.id === this.filters.id);
    if (!row) return undefined;
    if (col === 'preferences') return { preferences: row.preferences };
    return row;
  }
  async update(patch) {
    const row = this.state.rows.find(r => r.id === this.filters.id);
    if (!row) return 0;
    Object.assign(row, patch);
    return 1;
  }
}

function makeKnex(state) {
  return function knex(table) {
    if (table === 'users') return new FakeUsersTable(state);
    throw new Error(`unexpected table: ${table}`);
  };
}

function buildApp(state) {
  // Wire @goodmen/shared with a stub db before loading the route
  const shared = require('../index');
  shared.setDatabase({
    pool: null,
    query: async () => ({ rows: [] }),
    getClient: async () => null,
    knex: makeKnex(state)
  });

  const router = require('./user-preferences');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers['x-mock-user']) req.user = { id: req.headers['x-mock-user'] };
    next();
  });
  app.use('/api/user-preferences', router);
  return app;
}

function startServer(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, { method, path, body, headers }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('user-preferences route (FN-767)', () => {
  let state;
  let server;

  before(async () => {
    state = { rows: [{ id: 'user-1', preferences: {} }] };
    const app = buildApp(state);
    server = await startServer(app);
  });

  after(() => {
    if (server) server.close();
  });

  it('rejects unauthenticated GET with 401', async () => {
    const res = await request(server, { method: 'GET', path: '/api/user-preferences' });
    assert.strictEqual(res.status, 401);
  });

  it('returns empty object when preferences never set', async () => {
    const res = await request(server, {
      method: 'GET',
      path: '/api/user-preferences',
      headers: { 'x-mock-user': 'user-1' }
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.data, {});
  });

  it('PUT shallow-merges a patch into existing preferences', async () => {
    state.rows[0].preferences = { loadsDashboard: { columnVisibility: { status: false } } };
    const res = await request(server, {
      method: 'PUT',
      path: '/api/user-preferences',
      headers: { 'x-mock-user': 'user-1' },
      body: { loadsDashboard: { savedViews: [{ id: 'v1', name: 'Drafts', filters: {} }] } }
    });
    assert.strictEqual(res.status, 200);
    // Top-level shallow merge replaces loadsDashboard entirely.
    assert.deepStrictEqual(res.body.data, {
      loadsDashboard: { savedViews: [{ id: 'v1', name: 'Drafts', filters: {} }] }
    });
    // Persisted as JSON string.
    const persisted = state.rows[0].preferences;
    const parsed = typeof persisted === 'string' ? JSON.parse(persisted) : persisted;
    assert.deepStrictEqual(parsed, {
      loadsDashboard: { savedViews: [{ id: 'v1', name: 'Drafts', filters: {} }] }
    });
  });

  it('rejects non-object body with 400', async () => {
    const res = await request(server, {
      method: 'PUT',
      path: '/api/user-preferences',
      headers: { 'x-mock-user': 'user-1' },
      body: ['not', 'an', 'object']
    });
    assert.strictEqual(res.status, 400);
  });

  it('rejects payload exceeding size limit', async () => {
    const huge = { blob: 'x'.repeat(33 * 1024) };
    const res = await request(server, {
      method: 'PUT',
      path: '/api/user-preferences',
      headers: { 'x-mock-user': 'user-1' },
      body: huge
    });
    assert.strictEqual(res.status, 400);
  });
});
