'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

/**
 * FN-1752: Tests for the mock vehicle-telemetry route.
 *
 * The interesting logic is the DETERMINISTIC mock generator — same vehicle must
 * always render at the same place with the same fuel/faults so the UI is stable
 * across reloads. We unit-test `buildMockTelemetry` directly for shape,
 * determinism and value ranges, then do a thin route-wiring check that the
 * endpoints reject unauthenticated requests (the auth/tenant/subscription guard
 * is mounted per-route).
 */

const telemetry = require('./vehicle-telemetry');
const { buildMockTelemetry } = telemetry;

const FIXED_NOW = new Date('2026-06-12T12:00:00.000Z');
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);

function buildApp() {
  const app = express();
  app.use('/api', telemetry);
  return app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, { method, path }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ hostname: '127.0.0.1', port, path, method }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('buildMockTelemetry (FN-1752 deterministic mock generator)', () => {
  it('returns the full provider-agnostic contract shape', () => {
    const t = buildMockTelemetry({ id: 'veh-1', unit_number: 'T-100' }, FIXED_NOW);
    for (const key of [
      'vehicle_id', 'latitude', 'longitude', 'speed_mph', 'heading_deg',
      'fuel_level_pct', 'odometer', 'engine_status', 'last_moved_at',
      'fault_codes', 'updated_at', 'source'
    ]) {
      assert.ok(Object.prototype.hasOwnProperty.call(t, key), `missing key: ${key}`);
    }
    assert.strictEqual(t.vehicle_id, 'veh-1');
    assert.strictEqual(t.source, 'mock');
    assert.strictEqual(t.updated_at, FIXED_NOW.toISOString());
    assert.ok(Array.isArray(t.fault_codes));
  });

  it('is deterministic — identical position/fuel/faults for the same vehicle regardless of clock', () => {
    const row = { id: 'veh-abc', unit_number: 'T-777' };
    const a = buildMockTelemetry(row, new Date('2026-01-01T00:00:00Z'));
    const b = buildMockTelemetry(row, new Date('2026-12-31T23:59:59Z'));
    // Clock-independent fields must be byte-for-byte stable across reloads.
    assert.strictEqual(a.latitude, b.latitude);
    assert.strictEqual(a.longitude, b.longitude);
    assert.strictEqual(a.fuel_level_pct, b.fuel_level_pct);
    assert.strictEqual(a.odometer, b.odometer);
    assert.strictEqual(a.engine_status, b.engine_status);
    assert.strictEqual(a.heading_deg, b.heading_deg);
    assert.strictEqual(a.speed_mph, b.speed_mph);
    assert.deepStrictEqual(a.fault_codes, b.fault_codes);
  });

  it('seeds from unit_number when present, else the id', () => {
    // Same unit_number but different id => same seed => same values.
    const withUnit = buildMockTelemetry({ id: 'x', unit_number: 'UNIT-1' }, FIXED_NOW);
    const sameUnit = buildMockTelemetry({ id: 'y', unit_number: 'UNIT-1' }, FIXED_NOW);
    assert.strictEqual(withUnit.latitude, sameUnit.latitude);
    assert.strictEqual(withUnit.longitude, sameUnit.longitude);
  });

  it('keeps every numeric field within sane ranges', () => {
    for (let i = 0; i < 200; i++) {
      const t = buildMockTelemetry({ id: `veh-${i}` }, FIXED_NOW);
      assert.ok(t.latitude >= 31 && t.latitude <= 44, `lat out of range: ${t.latitude}`);
      assert.ok(t.longitude >= -118 && t.longitude <= -68, `lng out of range: ${t.longitude}`);
      assert.ok(t.fuel_level_pct >= 0 && t.fuel_level_pct <= 100, `fuel out of range: ${t.fuel_level_pct}`);
      assert.ok(t.heading_deg >= 0 && t.heading_deg < 360, `heading out of range: ${t.heading_deg}`);
      assert.ok(Number.isInteger(t.odometer) && t.odometer > 0, `bad odometer: ${t.odometer}`);
      assert.ok(['driving', 'idling', 'parked', 'off'].includes(t.engine_status));
      // Speed is only non-zero when driving.
      if (t.engine_status === 'driving') {
        assert.ok(t.speed_mph >= 45 && t.speed_mph <= 70, `driving speed out of range: ${t.speed_mph}`);
      } else {
        assert.strictEqual(t.speed_mph, 0);
      }
      // last_moved_at is always in the past relative to updated_at.
      assert.ok(new Date(t.last_moved_at).getTime() <= new Date(t.updated_at).getTime());
    }
  });

  it('produces well-formed fault codes with valid severities', () => {
    let sawFaults = false;
    for (let i = 0; i < 200; i++) {
      const t = buildMockTelemetry({ id: `fault-${i}` }, FIXED_NOW);
      assert.ok(t.fault_codes.length <= 2, 'no more than 2 fault codes');
      for (const f of t.fault_codes) {
        assert.ok(typeof f.code === 'string' && f.code.length > 0);
        assert.ok(typeof f.description === 'string' && f.description.length > 0);
        assert.ok(VALID_SEVERITIES.has(f.severity), `bad severity: ${f.severity}`);
        sawFaults = true;
      }
      // No duplicate codes within one vehicle.
      const codes = t.fault_codes.map((f) => f.code);
      assert.strictEqual(new Set(codes).size, codes.length);
    }
    assert.ok(sawFaults, 'expected at least some vehicles to have fault codes');
  });

  it('scatters vehicles to different positions (seed actually varies output)', () => {
    const positions = new Set();
    for (let i = 0; i < 50; i++) {
      const t = buildMockTelemetry({ id: `scatter-${i}` }, FIXED_NOW);
      positions.add(`${t.latitude},${t.longitude}`);
    }
    // Expect near-unique positions; allow a tiny margin for hash collisions.
    assert.ok(positions.size >= 45, `expected varied positions, got ${positions.size}`);
  });
});

describe('vehicle-telemetry route wiring (FN-1752)', () => {
  let server;
  before(async () => { server = await startServer(buildApp()); });
  after(() => { if (server) server.close(); });

  // The per-route guard chain is auth -> tenant context -> active subscription.
  // A request with no real user/tenant must never be served telemetry; it is
  // blocked somewhere in that chain (401 missing token in prod, or 403 when the
  // tenant context can't be resolved in dev, or 402 if past-due). We assert the
  // route is guarded (blocked, never 200) rather than pinning the exact layer.
  const GUARD_BLOCK = [401, 402, 403];

  it('blocks GET /vehicles/:id/telemetry without a valid auth/tenant context', async () => {
    const res = await request(server, { method: 'GET', path: '/api/vehicles/veh-1/telemetry' });
    assert.ok(GUARD_BLOCK.includes(res.status), `expected a guard block, got ${res.status}`);
  });

  it('blocks GET /fleet/telemetry without a valid auth/tenant context', async () => {
    const res = await request(server, { method: 'GET', path: '/api/fleet/telemetry?type=truck' });
    assert.ok(GUARD_BLOCK.includes(res.status), `expected a guard block, got ${res.status}`);
  });
});
