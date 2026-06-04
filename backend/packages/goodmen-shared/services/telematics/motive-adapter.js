'use strict';

/**
 * MotiveAdapter — FN-1661
 *
 * Signature scheme (Motive / formerly KeepTruckin): a hex HMAC-SHA256 of the
 * raw request body, no timestamp prefix:
 *
 *   X-Motive-Signature: <hex HMAC-SHA256>      (legacy: X-Keeptruckin-Signature)
 *   signed payload = rawBody
 *   secret         = TELEMATICS_WEBHOOK_SECRET_MOTIVE
 *
 * REST polling uses the Vehicle Locations endpoint:
 *   GET https://api.gomotive.com/v1/vehicle_locations?vehicle_ids=<id>
 *   X-Api-Key: <TELEMATICS_MOTIVE_API_TOKEN>
 *
 * NOTE: provider payload shapes are validated against fixtures by the QA subtask
 * (FN-1663). normalizePing is intentionally tolerant of the documented variants.
 */

const { TelematicsAdapter } = require('./telematics-adapter');

const MOTIVE_API_BASE =
  process.env.TELEMATICS_MOTIVE_API_BASE || 'https://api.gomotive.com';
const MOTIVE_SIG_HEADERS = ['x-motive-signature', 'x-keeptruckin-signature'];

class MotiveAdapter extends TelematicsAdapter {
  get provider() {
    return 'motive';
  }

  get webhookSecretEnvVar() {
    return 'TELEMATICS_WEBHOOK_SECRET_MOTIVE';
  }

  get apiTokenEnvVar() {
    return 'TELEMATICS_MOTIVE_API_TOKEN';
  }

  verifyWebhookSignature(req) {
    const secret = this.webhookSecret;
    if (!secret) return { ok: true, reason: 'no_secret_configured' };

    const headers = req?.headers || {};
    let provided = '';
    for (const name of MOTIVE_SIG_HEADERS) {
      if (headers[name]) {
        provided = headers[name].toString();
        break;
      }
    }
    if (!provided) return { ok: false, reason: 'missing_signature' };
    // Tolerate a `sha256=` prefix.
    if (provided.includes('=')) {
      provided = provided.split('=').slice(1).join('=');
    }

    const expected = this._hmacSha256Hex(this._rawBody(req));
    return this._safeEqual(provided, expected)
      ? { ok: true }
      : { ok: false, reason: 'bad_signature' };
  }

  parseEvent(body) {
    if (!body) return [];
    if (Array.isArray(body)) return body;
    // Motive may batch under `vehicles` (REST-style) or send one event.
    if (Array.isArray(body.vehicles)) return body.vehicles;
    return [body];
  }

  normalizePing(event) {
    if (!event || typeof event !== 'object') return null;

    // Motive nests the vehicle under `vehicle`; REST list rows do too.
    const vehicle = event.vehicle || event;
    const externalDeviceId =
      vehicle.id ?? vehicle.vehicle_id ?? event.vehicle_id ?? null;
    if (externalDeviceId === null || externalDeviceId === undefined) return null;

    const loc =
      vehicle.current_location ||
      event.current_location ||
      event.location ||
      event;
    const lat = this._toNumber(loc.lat ?? loc.latitude);
    const lng = this._toNumber(loc.lon ?? loc.lng ?? loc.longitude);
    if (lat === null || lng === null) return null;

    const ts =
      this._toDate(loc.located_at ?? loc.time ?? event.located_at) ||
      this._toDate(Date.now());

    return {
      externalDeviceId: String(externalDeviceId),
      ts,
      lat,
      lng,
      speedMph: this._toNumber(loc.speed),
      headingDeg: this._toNumber(loc.bearing ?? loc.heading),
      sourceEventId:
        event.id != null ? String(event.id) : null,
      payload: event
    };
  }

  async fetchLatestPosition(device) {
    const token = this.apiToken;
    if (!token) throw new Error(`${this.apiTokenEnvVar} not configured`);
    const externalId = device?.external_device_id ?? device?.externalDeviceId;
    if (!externalId) throw new Error('device.external_device_id required');

    // Lazy-require: only the polling path needs an HTTP client.
    const axios = require('axios');
    const res = await axios.get(`${MOTIVE_API_BASE}/v1/vehicle_locations`, {
      params: { vehicle_ids: String(externalId) },
      headers: { 'X-Api-Key': token },
      timeout: parseInt(process.env.TELEMATICS_POLL_TIMEOUT_MS || '10000', 10)
    });

    const rows = Array.isArray(res.data?.vehicles) ? res.data.vehicles : [];
    const pings = [];
    for (const row of rows) {
      const ping = this.normalizePing(row);
      if (ping) {
        ping.sourceEventId = null;
        ping.payload = { source: 'poll', provider: 'motive', row };
        pings.push(ping);
      }
    }
    return pings;
  }
}

module.exports = { MotiveAdapter };
