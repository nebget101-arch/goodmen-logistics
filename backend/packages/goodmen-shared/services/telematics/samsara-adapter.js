'use strict';

/**
 * SamsaraAdapter — FN-1661
 *
 * Signature scheme (mirrors Samsara's documented webhook signing, which follows
 * the Stripe convention):
 *
 *   X-Samsara-Signature: v1=<hex HMAC-SHA256>
 *   X-Samsara-Timestamp: <unix seconds>
 *
 *   signed payload = `v1:{timestamp}:{rawBody}`
 *   secret         = TELEMATICS_WEBHOOK_SECRET_SAMSARA
 *
 * REST polling uses the Vehicle Stats endpoint:
 *   GET https://api.samsara.com/fleet/vehicles/stats?types=gps&vehicleIds=<id>
 *   Authorization: Bearer <TELEMATICS_SAMSARA_API_TOKEN>
 *
 * NOTE: provider payload shapes are validated against fixtures by the QA subtask
 * (FN-1663). normalizePing is intentionally tolerant of the documented variants.
 */

const { TelematicsAdapter } = require('./telematics-adapter');

const SAMSARA_API_BASE =
  process.env.TELEMATICS_SAMSARA_API_BASE || 'https://api.samsara.com';
const SAMSARA_SIG_HEADER = 'x-samsara-signature';
const SAMSARA_TS_HEADER = 'x-samsara-timestamp';
// Reject events whose signing timestamp is older than this (replay guard).
const MAX_SIGNATURE_AGE_S = parseInt(
  process.env.TELEMATICS_SIGNATURE_MAX_AGE_S || '300',
  10
);

class SamsaraAdapter extends TelematicsAdapter {
  get provider() {
    return 'samsara';
  }

  get webhookSecretEnvVar() {
    return 'TELEMATICS_WEBHOOK_SECRET_SAMSARA';
  }

  get apiTokenEnvVar() {
    return 'TELEMATICS_SAMSARA_API_TOKEN';
  }

  verifyWebhookSignature(req) {
    const secret = this.webhookSecret;
    // Parity with inbound-email: no secret configured (dev) → accept + flag.
    if (!secret) return { ok: true, reason: 'no_secret_configured' };

    const headers = req?.headers || {};
    const sigHeader = (headers[SAMSARA_SIG_HEADER] || '').toString();
    const timestamp = (headers[SAMSARA_TS_HEADER] || '').toString();
    if (!sigHeader) return { ok: false, reason: 'missing_signature' };
    if (!timestamp) return { ok: false, reason: 'missing_timestamp' };

    // Replay guard: reject stale timestamps.
    const tsNum = Number(timestamp);
    if (Number.isFinite(tsNum) && MAX_SIGNATURE_AGE_S > 0) {
      const ageS = Math.abs(Date.now() / 1000 - tsNum);
      if (ageS > MAX_SIGNATURE_AGE_S) {
        return { ok: false, reason: 'timestamp_out_of_tolerance' };
      }
    }

    // Header is `v1=<hex>`; tolerate a bare hex digest too.
    const provided = sigHeader.includes('=')
      ? sigHeader.split('=').slice(1).join('=')
      : sigHeader;
    const signedPayload = `v1:${timestamp}:${this._rawBody(req).toString('utf8')}`;
    const expected = this._hmacSha256Hex(signedPayload);

    return this._safeEqual(provided, expected)
      ? { ok: true }
      : { ok: false, reason: 'bad_signature' };
  }

  parseEvent(body) {
    if (!body) return [];
    // Samsara may batch events under `events`, or send one event per request.
    if (Array.isArray(body)) return body;
    if (Array.isArray(body.events)) return body.events;
    return [body];
  }

  normalizePing(event) {
    if (!event || typeof event !== 'object') return null;
    const data = event.data || event;

    // Device id: prefer the vehicle, fall back to a device object.
    const externalDeviceId =
      (data.vehicle && (data.vehicle.id ?? data.vehicle.serial)) ??
      (data.device && (data.device.id ?? data.device.serial)) ??
      data.vehicleId ??
      data.deviceId ??
      null;
    if (externalDeviceId === null || externalDeviceId === undefined) return null;

    // Location can arrive as `gps`, `location`, or flat on data.
    const loc = data.gps || data.location || data;
    const lat = this._toNumber(loc.latitude ?? loc.lat);
    const lng = this._toNumber(loc.longitude ?? loc.lng ?? loc.lon);
    if (lat === null || lng === null) return null;

    const ts =
      this._toDate(loc.time ?? loc.timestamp ?? event.eventTime ?? event.time) ||
      this._toDate(Date.now());

    return {
      externalDeviceId: String(externalDeviceId),
      ts,
      lat,
      lng,
      speedMph: this._toNumber(
        loc.speedMilesPerHour ?? loc.speedMph ?? loc.speed
      ),
      headingDeg: this._toNumber(loc.headingDegrees ?? loc.heading ?? loc.bearing),
      sourceEventId:
        event.eventId != null ? String(event.eventId) : null,
      payload: event
    };
  }

  async fetchLatestPosition(device) {
    const token = this.apiToken;
    if (!token) throw new Error(`${this.apiTokenEnvVar} not configured`);
    const externalId = device?.external_device_id ?? device?.externalDeviceId;
    if (!externalId) throw new Error('device.external_device_id required');

    // Lazy-require: only the polling path needs an HTTP client; keeps the
    // webhook/parse/normalize path (and its unit tests) dependency-free.
    const axios = require('axios');
    const res = await axios.get(`${SAMSARA_API_BASE}/fleet/vehicles/stats`, {
      params: { types: 'gps', vehicleIds: String(externalId) },
      headers: { Authorization: `Bearer ${token}` },
      timeout: parseInt(process.env.TELEMATICS_POLL_TIMEOUT_MS || '10000', 10)
    });

    const rows = Array.isArray(res.data?.data) ? res.data.data : [];
    const pings = [];
    for (const row of rows) {
      const gps = row.gps || {};
      const lat = this._toNumber(gps.latitude);
      const lng = this._toNumber(gps.longitude);
      if (lat === null || lng === null) continue;
      pings.push({
        externalDeviceId: String(row.id ?? externalId),
        ts: this._toDate(gps.time) || this._toDate(Date.now()),
        lat,
        lng,
        speedMph: this._toNumber(gps.speedMilesPerHour),
        headingDeg: this._toNumber(gps.headingDegrees),
        sourceEventId: null,
        payload: { source: 'poll', provider: 'samsara', row }
      });
    }
    return pings;
  }
}

module.exports = { SamsaraAdapter };
