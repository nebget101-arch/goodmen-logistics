'use strict';

// Must be set before the route (→ auth-middleware) is required, since
// auth-middleware captures JWT_SECRET into a const at module load.
process.env.JWT_SECRET = 'test_secret_fn1675';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');

/**
 * FN-1675: Tests for the share-link API (create / list / revoke).
 *
 * Uses a fake `query`-shaped stub injected via setDatabase() (in-memory loads +
 * share_links) so no real postgres is needed. Real auth-middleware runs: we
 * sign JWTs with JWT_SECRET so role enforcement is exercised. req.context
 * (tenant/operating-entity) is injected by a small middleware ahead of the
 * router, mirroring what tenantContextMiddleware provides in production.
 */

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const LOAD_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function makeQuery(state) {
  return async (sql, params) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT id, delivery_date FROM loads')) {
      const [id, tenantId, oe] = params;
      const row = state.loads.find(
        (l) =>
          l.id === id &&
          l.tenant_id === tenantId &&
          (oe === undefined || l.operating_entity_id === oe)
      );
      return { rows: row ? [{ id: row.id, delivery_date: row.delivery_date }] : [] };
    }

    if (s.startsWith('INSERT INTO load_share_links')) {
      const [load_id, token_hash, created_by, expires_at, reveal_options] = params;
      const row = {
        id: `dddddddd-dddd-dddd-dddd-${String(state.shareLinks.length + 1).padStart(12, '0')}`,
        load_id,
        token_hash,
        created_by,
        created_at: new Date('2026-06-03T00:00:00Z').toISOString(),
        expires_at: expires_at instanceof Date ? expires_at.toISOString() : expires_at,
        revoked_at: null,
        view_count: 0,
        last_viewed_at: null,
        reveal_options: JSON.parse(reveal_options)
      };
      state.shareLinks.push(row);
      return { rows: [{ ...row }] };
    }

    if (s.includes('FROM load_share_links') && s.includes('WHERE load_id')) {
      const [load_id] = params;
      const rows = state.shareLinks
        .filter((r) => r.load_id === load_id)
        .map((r) => ({ ...r }));
      return { rows };
    }

    if (s.includes('FROM load_share_links sl JOIN loads l')) {
      const [id, tenantId, oe] = params;
      const sl = state.shareLinks.find((r) => r.id === id);
      if (!sl) return { rows: [] };
      const load = state.loads.find(
        (l) =>
          l.id === sl.load_id &&
          l.tenant_id === tenantId &&
          (oe === undefined || l.operating_entity_id === oe)
      );
      return { rows: load ? [{ ...sl }] : [] };
    }

    if (s.startsWith('UPDATE load_share_links SET revoked_at')) {
      const [id] = params;
      const sl = state.shareLinks.find((r) => r.id === id);
      sl.revoked_at = new Date('2026-06-04T00:00:00Z').toISOString();
      return { rows: [{ ...sl }] };
    }

    throw new Error(`unexpected query: ${s}`);
  };
}

function buildApp(state, context) {
  const shared = require('../index');
  shared.setDatabase({
    pool: null,
    query: makeQuery(state),
    getClient: async () => null,
    knex: null
  });

  // Require AFTER setDatabase so the route binds to our stubbed query.
  const router = require('./load-share-links');
  const app = express();
  app.use(express.json());
  // Inject tenant context like tenantContextMiddleware would, post-auth.
  app.use((req, res, next) => {
    req.context = context;
    next();
  });
  app.use('/api', router);
  return app;
}

function token(role) {
  return jwt.sign({ id: USER_ID, role }, process.env.JWT_SECRET);
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, { method, path, body, headers }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const payload = body ? JSON.stringify(body) : null;
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
        res.on('data', (c) => (data += c));
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

function authHeaders(role) {
  return { Authorization: `Bearer ${token(role)}` };
}

describe('load-share-links route (FN-1675)', () => {
  let state;
  let server;

  before(async () => {
    state = {
      loads: [
        {
          id: LOAD_A,
          tenant_id: TENANT_A,
          operating_entity_id: null,
          delivery_date: '2026-06-10'
        }
      ],
      shareLinks: []
    };
    const app = buildApp(state, { tenantId: TENANT_A, operatingEntityId: null });
    server = await startServer(app);
  });

  after(() => {
    if (server) server.close();
  });

  it('rejects unauthenticated create with 401', async () => {
    const res = await request(server, {
      method: 'POST',
      path: `/api/loads/${LOAD_A}/share-links`,
      body: {}
    });
    assert.strictEqual(res.status, 401);
  });

  it('rejects a disallowed role (driver) with 403', async () => {
    const res = await request(server, {
      method: 'POST',
      path: `/api/loads/${LOAD_A}/share-links`,
      headers: authHeaders('driver'),
      body: {}
    });
    assert.strictEqual(res.status, 403);
  });

  it('creates a link: returns raw token + url once, never the hash, default expiry = delivery + 7d', async () => {
    const res = await request(server, {
      method: 'POST',
      path: `/api/loads/${LOAD_A}/share-links`,
      headers: authHeaders('dispatch'),
      body: {}
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.token, 'raw token returned');
    assert.ok(res.body.url.endsWith(`/track/${res.body.token}`), 'share url uses /track/<token>');
    assert.strictEqual(res.body.token_hash, undefined, 'hash never leaked');
    assert.strictEqual(res.body.status, 'active');
    // Default expiry = delivery_date (2026-06-10) + 7 days = 2026-06-17.
    assert.strictEqual(new Date(res.body.expires_at).toISOString().slice(0, 10), '2026-06-17');
    // Reveal toggles default OFF.
    assert.deepStrictEqual(res.body.reveal_options, {
      driverName: false,
      vehicleNumber: false,
      breadcrumbs: false,
      routeLine: false
    });
    // Stored row keeps only the hash, not the raw token.
    assert.strictEqual(state.shareLinks.length, 1);
    assert.ok(state.shareLinks[0].token_hash);
    assert.notStrictEqual(state.shareLinks[0].token_hash, res.body.token);
  });

  it('persists explicit reveal toggles', async () => {
    const res = await request(server, {
      method: 'POST',
      path: `/api/loads/${LOAD_A}/share-links`,
      headers: authHeaders('admin'),
      body: { revealOptions: { driverName: true, breadcrumbs: true, bogus: true } }
    });
    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.body.reveal_options, {
      driverName: true,
      vehicleNumber: false,
      breadcrumbs: true,
      routeLine: false
    });
  });

  it('rejects an invalid explicit expiresAt with 400', async () => {
    const res = await request(server, {
      method: 'POST',
      path: `/api/loads/${LOAD_A}/share-links`,
      headers: authHeaders('admin'),
      body: { expiresAt: 'not-a-date' }
    });
    assert.strictEqual(res.status, 400);
  });

  it('404s when the load is not in the caller tenant', async () => {
    const otherApp = buildApp(state, { tenantId: TENANT_B, operatingEntityId: null });
    const otherServer = await startServer(otherApp);
    try {
      const res = await request(otherServer, {
        method: 'POST',
        path: `/api/loads/${LOAD_A}/share-links`,
        headers: authHeaders('admin'),
        body: {}
      });
      assert.strictEqual(res.status, 404);
    } finally {
      otherServer.close();
    }
  });

  it('404s on a malformed load id', async () => {
    const res = await request(server, {
      method: 'GET',
      path: '/api/loads/not-a-uuid/share-links',
      headers: authHeaders('admin')
    });
    assert.strictEqual(res.status, 404);
  });

  it('lists a load links without leaking token hashes', async () => {
    const res = await request(server, {
      method: 'GET',
      path: `/api/loads/${LOAD_A}/share-links`,
      headers: authHeaders('dispatch')
    });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 2);
    for (const link of res.body.data) {
      assert.strictEqual(link.token_hash, undefined);
      assert.ok('view_count' in link);
      assert.ok('last_viewed_at' in link);
    }
  });

  it('revokes a link (sets revoked_at) and is idempotent', async () => {
    const id = state.shareLinks[0].id;
    const res = await request(server, {
      method: 'DELETE',
      path: `/api/share-links/${id}`,
      headers: authHeaders('admin')
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.revoked_at, 'revoked_at set');
    assert.strictEqual(res.body.status, 'revoked');

    // Second revoke is idempotent — still 200, still revoked.
    const again = await request(server, {
      method: 'DELETE',
      path: `/api/share-links/${id}`,
      headers: authHeaders('admin')
    });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.status, 'revoked');
  });

  it('404s revoking a link belonging to another tenant', async () => {
    const id = state.shareLinks[1].id;
    const otherApp = buildApp(state, { tenantId: TENANT_B, operatingEntityId: null });
    const otherServer = await startServer(otherApp);
    try {
      const res = await request(otherServer, {
        method: 'DELETE',
        path: `/api/share-links/${id}`,
        headers: authHeaders('admin')
      });
      assert.strictEqual(res.status, 404);
    } finally {
      otherServer.close();
    }
  });
});
