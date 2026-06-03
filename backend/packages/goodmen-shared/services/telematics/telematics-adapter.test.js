'use strict';

/**
 * Unit tests for the telematics adapters (pure: signature, parse, normalize).
 * DB-touching ingestion/polling is covered by the integrations-service tests
 * and the QA contract tests (FN-1663).
 *
 * Run:
 *   cd backend/packages/goodmen-shared
 *   node --test services/telematics/telematics-adapter.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { SamsaraAdapter } = require('./samsara-adapter');
const { MotiveAdapter } = require('./motive-adapter');
const { getAdapter, SUPPORTED_PROVIDERS } = require('./index');
const { toDate, toNumber, hmacSha256Hex } = require('./telematics-adapter');

const SAMSARA_SECRET = 'samsara_test_secret';
const MOTIVE_SECRET = 'motive_test_secret';

function makeReq({ headers = {}, rawBody = '', body = undefined, query = {} } = {}) {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  return {
    headers,
    query,
    rawBody: buf,
    body: body !== undefined ? body : JSON.parse(buf.toString() || '{}')
  };
}

describe('getAdapter registry', () => {
  it('resolves samsara and motive case-insensitively', () => {
    assert.equal(getAdapter('samsara').provider, 'samsara');
    assert.equal(getAdapter('MOTIVE').provider, 'motive');
  });
  it('returns null for unknown providers', () => {
    assert.equal(getAdapter('geotab'), null);
    assert.equal(getAdapter(''), null);
    assert.equal(getAdapter(null), null);
  });
  it('lists supported providers', () => {
    assert.deepEqual([...SUPPORTED_PROVIDERS].sort(), ['motive', 'samsara']);
  });
});

describe('shared helpers', () => {
  it('toNumber coerces and falls back', () => {
    assert.equal(toNumber('42.5'), 42.5);
    assert.equal(toNumber('', 7), 7);
    assert.equal(toNumber('nope', null), null);
  });
  it('toDate handles epoch seconds, ms, and ISO', () => {
    assert.equal(toDate(1700000000).getTime(), 1700000000 * 1000);
    assert.equal(toDate(1700000000000).getTime(), 1700000000000);
    assert.equal(toDate('2024-01-02T03:04:05Z').toISOString(), '2024-01-02T03:04:05.000Z');
    assert.equal(toDate('garbage'), null);
  });
});

describe('SamsaraAdapter.verifyWebhookSignature', () => {
  beforeEach(() => {
    process.env.TELEMATICS_WEBHOOK_SECRET_SAMSARA = SAMSARA_SECRET;
  });

  it('accepts a valid v1 signature', () => {
    const adapter = new SamsaraAdapter();
    const rawBody = JSON.stringify({ eventId: 'e1' });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = hmacSha256Hex(SAMSARA_SECRET, `v1:${ts}:${rawBody}`);
    const req = makeReq({
      headers: { 'x-samsara-signature': `v1=${sig}`, 'x-samsara-timestamp': ts },
      rawBody
    });
    assert.deepEqual(adapter.verifyWebhookSignature(req), { ok: true });
  });

  it('rejects a tampered body', () => {
    const adapter = new SamsaraAdapter();
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = hmacSha256Hex(SAMSARA_SECRET, `v1:${ts}:${JSON.stringify({ a: 1 })}`);
    const req = makeReq({
      headers: { 'x-samsara-signature': `v1=${sig}`, 'x-samsara-timestamp': ts },
      rawBody: JSON.stringify({ a: 2 })
    });
    assert.equal(adapter.verifyWebhookSignature(req).ok, false);
  });

  it('rejects a stale timestamp (replay guard)', () => {
    const adapter = new SamsaraAdapter();
    const rawBody = JSON.stringify({ eventId: 'e1' });
    const ts = String(Math.floor(Date.now() / 1000) - 99999);
    const sig = hmacSha256Hex(SAMSARA_SECRET, `v1:${ts}:${rawBody}`);
    const req = makeReq({
      headers: { 'x-samsara-signature': `v1=${sig}`, 'x-samsara-timestamp': ts },
      rawBody
    });
    assert.equal(adapter.verifyWebhookSignature(req).reason, 'timestamp_out_of_tolerance');
  });

  it('reports missing signature/timestamp', () => {
    const adapter = new SamsaraAdapter();
    assert.equal(adapter.verifyWebhookSignature(makeReq({ rawBody: '{}' })).reason, 'missing_signature');
  });

  it('accepts when no secret configured (dev parity)', () => {
    delete process.env.TELEMATICS_WEBHOOK_SECRET_SAMSARA;
    const adapter = new SamsaraAdapter();
    assert.deepEqual(adapter.verifyWebhookSignature(makeReq({ rawBody: '{}' })), {
      ok: true,
      reason: 'no_secret_configured'
    });
  });
});

describe('SamsaraAdapter.parseEvent + normalizePing', () => {
  it('parses a batched events array', () => {
    const adapter = new SamsaraAdapter();
    const events = adapter.parseEvent({ events: [{ eventId: '1' }, { eventId: '2' }] });
    assert.equal(events.length, 2);
  });

  it('normalizes a gps event with vehicle id', () => {
    const adapter = new SamsaraAdapter();
    const ping = adapter.normalizePing({
      eventId: 'evt-9',
      eventTime: '2024-05-01T10:00:00Z',
      data: {
        vehicle: { id: '281474976710656', name: 'Truck 7' },
        gps: {
          time: '2024-05-01T10:00:01Z',
          latitude: 37.7749,
          longitude: -122.4194,
          headingDegrees: 90,
          speedMilesPerHour: 55.2
        }
      }
    });
    assert.equal(ping.externalDeviceId, '281474976710656');
    assert.equal(ping.lat, 37.7749);
    assert.equal(ping.lng, -122.4194);
    assert.equal(ping.speedMph, 55.2);
    assert.equal(ping.headingDeg, 90);
    assert.equal(ping.sourceEventId, 'evt-9');
    assert.equal(ping.ts.toISOString(), '2024-05-01T10:00:01.000Z');
  });

  it('returns null when coordinates are missing', () => {
    const adapter = new SamsaraAdapter();
    assert.equal(adapter.normalizePing({ data: { vehicle: { id: '1' } } }), null);
  });
});

describe('MotiveAdapter.verifyWebhookSignature', () => {
  beforeEach(() => {
    process.env.TELEMATICS_WEBHOOK_SECRET_MOTIVE = MOTIVE_SECRET;
  });

  it('accepts a valid hex signature (x-motive-signature)', () => {
    const adapter = new MotiveAdapter();
    const rawBody = JSON.stringify({ id: 'm1' });
    const sig = hmacSha256Hex(MOTIVE_SECRET, rawBody);
    const req = makeReq({ headers: { 'x-motive-signature': sig }, rawBody });
    assert.deepEqual(adapter.verifyWebhookSignature(req), { ok: true });
  });

  it('accepts the legacy keeptruckin header with sha256= prefix', () => {
    const adapter = new MotiveAdapter();
    const rawBody = JSON.stringify({ id: 'm1' });
    const sig = hmacSha256Hex(MOTIVE_SECRET, rawBody);
    const req = makeReq({ headers: { 'x-keeptruckin-signature': `sha256=${sig}` }, rawBody });
    assert.deepEqual(adapter.verifyWebhookSignature(req), { ok: true });
  });

  it('rejects a bad signature', () => {
    const adapter = new MotiveAdapter();
    const req = makeReq({ headers: { 'x-motive-signature': 'deadbeef' }, rawBody: '{"id":"m1"}' });
    assert.equal(adapter.verifyWebhookSignature(req).reason, 'bad_signature');
  });

  it('reports missing signature', () => {
    const adapter = new MotiveAdapter();
    assert.equal(adapter.verifyWebhookSignature(makeReq({ rawBody: '{}' })).reason, 'missing_signature');
  });
});

describe('MotiveAdapter.normalizePing', () => {
  it('normalizes a vehicle current_location event', () => {
    const adapter = new MotiveAdapter();
    const ping = adapter.normalizePing({
      id: 552,
      vehicle: {
        id: 99012,
        current_location: {
          lat: 41.8781,
          lon: -87.6298,
          located_at: '2024-05-01T12:00:00Z',
          speed: 47,
          bearing: 270
        }
      }
    });
    assert.equal(ping.externalDeviceId, '99012');
    assert.equal(ping.lat, 41.8781);
    assert.equal(ping.lng, -87.6298);
    assert.equal(ping.speedMph, 47);
    assert.equal(ping.headingDeg, 270);
    assert.equal(ping.sourceEventId, '552');
    assert.equal(ping.ts.toISOString(), '2024-05-01T12:00:00.000Z');
  });

  it('returns null without coordinates', () => {
    const adapter = new MotiveAdapter();
    assert.equal(adapter.normalizePing({ vehicle: { id: 1 } }), null);
  });
});

// Sanity: the signing helper is deterministic and matches Node crypto.
describe('hmacSha256Hex', () => {
  it('matches crypto.createHmac', () => {
    const expected = crypto.createHmac('sha256', 'k').update('msg').digest('hex');
    assert.equal(hmacSha256Hex('k', 'msg'), expected);
  });
});
