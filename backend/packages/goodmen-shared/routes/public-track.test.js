'use strict';

/**
 * FN-1679: Tests for the public token-resolve read API (GET /api/track/:token).
 *
 * Drives the REAL route + real share-link-service (so token hashing and the
 * view-audit helper are exercised) against an in-memory `query` stub injected
 * via setDatabase(). No auth/tenant middleware is mounted — the endpoint is
 * unauthenticated by design — so any token must resolve purely from its hash.
 *
 * Coverage: malformed → 404, unknown → 404, revoked → 410, expired → 410,
 * active → 200 with reveal-gated fields off by default and on when enabled,
 * the view-audit row + counter bump, and the no-info-leak error bodies.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

// Install the DB bridge BEFORE requiring anything that captures `query` at
// import time. internal/db exposes `query` as a getter and consumers
// destructure it once (`const { query } = require('../internal/db')`), so the
// value must be a real function the moment those modules load. We install an
// indirection (`dispatch`) now and point it at the per-test stub in before().
const shared = require('../index');
let dispatch = () => {
  throw new Error('query dispatch not configured');
};
shared.setDatabase({
  pool: null,
  query: (sql, params) => dispatch(sql, params),
  getClient: async () => null,
  knex: null
});

// Now safe to require — these capture the indirection above.
const shareLinkService = require('../services/share-link-service');
const publicTrackRouter = require('./public-track');

const LOAD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VEHICLE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SHARE_LINK_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// Well-formed raw tokens (match TOKEN_RE: [A-Za-z0-9_-]{16,256}).
const ACTIVE_TOKEN = 'active_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const REVOKED_TOKEN = 'revoked_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const EXPIRED_TOKEN = 'expired_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const REVEAL_TOKEN = 'reveal_DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
const UNKNOWN_TOKEN = 'unknown_EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';

const H = (raw) => shareLinkService.hashToken(raw);

function baseLink(overrides) {
  return {
    share_link_id: SHARE_LINK_ID,
    expires_at: '2999-01-01T00:00:00.000Z',
    revoked_at: null,
    reveal_options: {},
    load_id: LOAD_ID,
    load_number: 'L-1001',
    status: 'IN_TRANSIT',
    updated_at: '2026-06-03T12:00:00.000Z',
    pickup_date: '2026-06-01',
    delivery_date: '2026-06-05',
    pickup_location: 'Dallas, TX',
    delivery_location: 'Atlanta, GA',
    completed_date: null,
    driver_position_city: 'Birmingham',
    driver_position_state: 'AL',
    driver_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    truck_id: VEHICLE_ID,
    driver_name: 'Jordan Rivers',
    vehicle_unit_number: 'UNIT-204',
    ...overrides
  };
}

function makeState() {
  return {
    // token_hash -> resolved link+load row (or absent = unknown)
    links: {
      [H(ACTIVE_TOKEN)]: baseLink({ reveal_options: {} }),
      [H(REVOKED_TOKEN)]: baseLink({ revoked_at: '2026-06-02T00:00:00.000Z' }),
      [H(EXPIRED_TOKEN)]: baseLink({ expires_at: '2020-01-01T00:00:00.000Z' }),
      [H(REVEAL_TOKEN)]: baseLink({
        reveal_options: {
          driverName: true,
          vehicleNumber: true,
          breadcrumbs: true,
          routeLine: true
        }
      })
    },
    stops: [
      { stop_type: 'PICKUP', stop_date: '2026-06-01', city: 'Dallas', state: 'TX', sequence: 1, zip: '75201' },
      { stop_type: 'DELIVERY', stop_date: '2026-06-05', city: 'Atlanta', state: 'GA', sequence: 2, zip: '30303' }
    ],
    pings: [
      { lat: 33.52, lng: -86.81, ts: '2026-06-03T13:30:00.000Z', speed_mph: 62, heading_deg: 95 },
      { lat: 33.10, lng: -87.00, ts: '2026-06-03T13:00:00.000Z', speed_mph: 58, heading_deg: 90 }
    ],
    zip: { 75201: { latitude: 32.78, longitude: -96.8 }, 30303: { latitude: 33.75, longitude: -84.39 } },
    views: [],
    counterBumps: 0
  };
}

function makeQuery(state) {
  return async (sql, params) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    // 1. Main resolve: share link + load join, keyed by token_hash.
    if (s.includes('FROM load_share_links sl JOIN loads l')) {
      const [tokenHash] = params;
      const row = state.links[tokenHash];
      return { rows: row ? [{ ...row }] : [] };
    }

    // 2. Stops (+ coords via zip_codes) — feeds milestones, waypoints, route.
    if (s.includes('FROM load_stops s') && s.includes('zip_codes')) {
      return {
        rows: state.stops.map((st) => ({
          stop_type: st.stop_type,
          sequence: st.sequence,
          stop_date: st.stop_date,
          city: st.city,
          state: st.state,
          lat: state.zip[st.zip]?.latitude ?? null,
          lng: state.zip[st.zip]?.longitude ?? null
        }))
      };
    }

    // 4. Breadcrumb trail (windowed + limited).
    if (s.includes('FROM vehicle_position_pings') && s.includes('interval')) {
      return { rows: state.pings.map((p) => ({ lat: p.lat, lng: p.lng, ts: p.ts })) };
    }

    // 5. Latest position (single row).
    if (s.includes('FROM vehicle_position_pings')) {
      const p = state.pings[0];
      return { rows: [{ lat: p.lat, lng: p.lng, ts: p.ts, speed_mph: p.speed_mph, heading_deg: p.heading_deg }] };
    }

    // 6. View audit insert.
    if (s.startsWith('INSERT INTO load_share_link_views')) {
      const [share_link_id, ip_hash, user_agent_hash] = params;
      state.views.push({ share_link_id, ip_hash, user_agent_hash });
      return { rows: [] };
    }

    // 7. View counter bump.
    if (s.startsWith('UPDATE load_share_links SET view_count')) {
      state.counterBumps += 1;
      return { rows: [] };
    }

    throw new Error(`unexpected query: ${s}`);
  };
}

function buildApp(state) {
  // Point the pre-installed indirection at this test's stub.
  dispatch = makeQuery(state);
  const app = express();
  app.use(express.json());
  app.use('/api/track', publicTrackRouter);
  return app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function get(server, path, headers) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers: headers || {} },
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
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('public-track route (FN-1679)', () => {
  let state;
  let server;

  before(async () => {
    state = makeState();
    server = await startServer(buildApp(state));
  });

  after(() => {
    if (server) server.close();
  });

  it('404s a malformed token without hitting the DB', async () => {
    const res = await get(server, '/api/track/bad!token');
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.success, false);
    assert.strictEqual(res.body.error, 'Tracking link not found');
  });

  it('404s an unknown but well-formed token', async () => {
    const res = await get(server, `/api/track/${UNKNOWN_TOKEN}`);
    assert.strictEqual(res.status, 404);
    // No info leak: body carries no load id / internal detail.
    assert.ok(!JSON.stringify(res.body).includes(LOAD_ID));
    assert.strictEqual(res.body.data, undefined);
  });

  it('410s a revoked token (generic body)', async () => {
    const res = await get(server, `/api/track/${REVOKED_TOKEN}`);
    assert.strictEqual(res.status, 410);
    assert.strictEqual(res.body.error, 'This tracking link is no longer available');
    assert.ok(!JSON.stringify(res.body).includes(LOAD_ID));
  });

  it('410s an expired token (generic body)', async () => {
    const res = await get(server, `/api/track/${EXPIRED_TOKEN}`);
    assert.strictEqual(res.status, 410);
    assert.strictEqual(res.body.error, 'This tracking link is no longer available');
  });

  it('200s an active token in the frontend envelope with reveal fields OFF', async () => {
    const res = await get(server, `/api/track/${ACTIVE_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const d = res.body.data;
    assert.strictEqual(d.loadNumber, 'L-1001');
    assert.strictEqual(d.status, 'in_transit');
    assert.strictEqual(d.statusLabel, 'In transit');
    assert.ok(d.lastUpdatedAt, 'lastUpdatedAt present');
    // ETA reserved (not modeled).
    assert.strictEqual(d.eta, null);
    // Live position surfaced (always-on), as { lat, lon }.
    assert.deepStrictEqual(d.currentPosition, { lat: 33.52, lon: -86.81 });
    // Waypoints carry coarse labels + coords resolved from zip_codes.
    assert.strictEqual(d.origin.label, 'Dallas, TX');
    assert.strictEqual(d.destination.label, 'Atlanta, GA');
    assert.strictEqual(d.origin.lat, 32.78);
    // Milestone timeline: pickup complete, in_transit current, delivered upcoming.
    const byKey = Object.fromEntries(d.milestones.map((m) => [m.key, m]));
    assert.strictEqual(byKey.pickup.state, 'complete');
    assert.strictEqual(byKey.in_transit.state, 'current');
    assert.strictEqual(byKey.delivered.state, 'upcoming');
    // Reveal-gated fields absent.
    assert.strictEqual(d.driverName, undefined, 'driver hidden');
    assert.strictEqual(d.vehicleNumber, undefined, 'vehicle hidden');
    assert.strictEqual(d.breadcrumbs, undefined, 'breadcrumbs hidden');
    assert.strictEqual(d.routeLine, undefined, 'route hidden');
    // Never leak the load id.
    assert.ok(!JSON.stringify(res.body).includes(LOAD_ID));
    // No-store so shared caches don't cross-serve viewers.
    assert.strictEqual(res.headers['cache-control'], 'no-store');
  });

  it('exposes reveal-gated fields when the link enables them', async () => {
    const res = await get(server, `/api/track/${REVEAL_TOKEN}`);
    assert.strictEqual(res.status, 200);
    const d = res.body.data;
    assert.strictEqual(d.driverName, 'Jordan Rivers');
    assert.strictEqual(d.vehicleNumber, 'UNIT-204');
    assert.ok(Array.isArray(d.breadcrumbs) && d.breadcrumbs.length === 2);
    assert.deepStrictEqual(Object.keys(d.breadcrumbs[0]).sort(), ['at', 'lat', 'lon']);
    // routeLine as [lat, lon] pairs in stop order.
    assert.ok(Array.isArray(d.routeLine) && d.routeLine.length === 2);
    assert.deepStrictEqual(d.routeLine[0], [32.78, -96.8]);
  });

  it('writes a hashed view-audit row and bumps the counter on a successful read', async () => {
    const before = state.views.length;
    const beforeBumps = state.counterBumps;
    await get(server, `/api/track/${ACTIVE_TOKEN}`, {
      'user-agent': 'Mozilla/5.0 (test)',
      'x-forwarded-for': '203.0.113.7, 10.0.0.1'
    });
    assert.strictEqual(state.views.length, before + 1);
    assert.strictEqual(state.counterBumps, beforeBumps + 1);
    const v = state.views[state.views.length - 1];
    assert.strictEqual(v.share_link_id, SHARE_LINK_ID);
    // IP + UA stored hashed (SHA-256 hex = 64 chars), never in the clear.
    assert.match(v.ip_hash, /^[0-9a-f]{64}$/);
    assert.match(v.user_agent_hash, /^[0-9a-f]{64}$/);
    assert.notStrictEqual(v.ip_hash, '203.0.113.7');
  });
});
