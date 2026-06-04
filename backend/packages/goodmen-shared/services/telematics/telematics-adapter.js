'use strict';

/**
 * TelematicsAdapter — FN-1661
 *
 * Provider-agnostic interface for telematics ingestion. Concrete adapters
 * (Samsara, Motive) implement the three webhook hooks plus a REST polling
 * fallback:
 *
 *   verifyWebhookSignature(req)  → { ok, reason }   — HMAC over the raw body
 *   parseEvent(body)             → RawEvent[]        — split a payload into events
 *   normalizePing(event)         → NormalizedPing|null — map one event to our schema
 *   fetchLatestPosition(device)  → NormalizedPing[]  — REST pull for the polling cron
 *
 * A `NormalizedPing` is the provider-neutral shape the ingest service persists
 * into `vehicle_position_pings` (after resolving the device → vehicle):
 *
 *   {
 *     externalDeviceId: string,   // maps to telematics_devices.external_device_id
 *     ts:               Date,     // event timestamp (provider clock)
 *     lat:              number,
 *     lng:              number,
 *     speedMph:         number|null,
 *     headingDeg:       number|null,
 *     sourceEventId:    string|null,  // provider event id (dedup key)
 *     payload:          object         // raw provider event, stored as jsonb
 *   }
 *
 * Signature verification is timing-safe and fails open ONLY when no secret is
 * configured for the provider (parity with the inbound-email webhook in dev).
 */

const crypto = require('crypto');

/**
 * Constant-time comparison of two hex/ascii strings. Returns false on any
 * length mismatch or malformed input rather than throwing.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (_err) {
    return false;
  }
}

/**
 * Compute a hex HMAC-SHA256 digest of `payload` using `secret`.
 * `payload` may be a Buffer or string.
 */
function hmacSha256Hex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Coerce an arbitrary value to a finite number or return `fallback`.
 */
function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Coerce an arbitrary timestamp (ISO string, epoch ms, epoch s, Date) to a
 * Date, or return null when unparseable.
 */
function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    // Heuristic: treat 10-digit values as epoch seconds, 13-digit as ms.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Base class. Concrete adapters override `provider`, the secret/token env var
 * names, and the four hook methods. The base provides shared crypto + coercion
 * helpers and sensible "not implemented" guards.
 */
class TelematicsAdapter {
  /** Stable provider code, also the `telematics_providers.code` value. */
  get provider() {
    throw new Error('TelematicsAdapter.provider must be overridden');
  }

  /** Env var holding the shared webhook signing secret for this provider. */
  get webhookSecretEnvVar() {
    throw new Error('TelematicsAdapter.webhookSecretEnvVar must be overridden');
  }

  /** Env var holding the REST API token used by the polling fallback. */
  get apiTokenEnvVar() {
    throw new Error('TelematicsAdapter.apiTokenEnvVar must be overridden');
  }

  get webhookSecret() {
    return process.env[this.webhookSecretEnvVar] || null;
  }

  get apiToken() {
    return process.env[this.apiTokenEnvVar] || null;
  }

  /**
   * Verify the provider's webhook signature against the raw request body.
   * Must be overridden. The default returns "not implemented" so a misconfigured
   * adapter rejects rather than silently accepting.
   *
   * @param {object} req Express request (expects `req.rawBody` Buffer + headers)
   * @returns {{ ok: boolean, reason?: string }}
   */
  // eslint-disable-next-line no-unused-vars
  verifyWebhookSignature(req) {
    return { ok: false, reason: 'not_implemented' };
  }

  /**
   * Split a parsed webhook body into an array of raw provider events.
   * Default: wrap a single object in an array.
   */
  parseEvent(body) {
    if (body === null || body === undefined) return [];
    return Array.isArray(body) ? body : [body];
  }

  /**
   * Map one raw provider event to a NormalizedPing, or null when the event is
   * not a position update (or is missing coordinates).
   */
  // eslint-disable-next-line no-unused-vars
  normalizePing(event) {
    throw new Error('TelematicsAdapter.normalizePing must be overridden');
  }

  /**
   * Pull the latest known position(s) for a device via the provider REST API.
   * Used by the polling-fallback cron. Returns an array of NormalizedPing.
   */
  // eslint-disable-next-line no-unused-vars
  async fetchLatestPosition(device) {
    throw new Error('TelematicsAdapter.fetchLatestPosition must be overridden');
  }

  // --- shared helpers exposed to subclasses ---------------------------------
  _safeEqual(a, b) {
    return safeEqual(a, b);
  }

  _hmacSha256Hex(payload) {
    return hmacSha256Hex(this.webhookSecret, payload);
  }

  _toNumber(value, fallback = null) {
    return toNumber(value, fallback);
  }

  _toDate(value) {
    return toDate(value);
  }

  /**
   * Return the raw request body as a Buffer for HMAC. Prefers `req.rawBody`
   * (captured by the body-parser `verify` hook); falls back to re-serializing
   * the parsed body (lossy — only used when rawBody is unavailable).
   */
  _rawBody(req) {
    if (req && Buffer.isBuffer(req.rawBody)) return req.rawBody;
    if (req && typeof req.rawBody === 'string') return Buffer.from(req.rawBody);
    if (req && req.body !== undefined) return Buffer.from(JSON.stringify(req.body));
    return Buffer.alloc(0);
  }
}

module.exports = {
  TelematicsAdapter,
  safeEqual,
  hmacSha256Hex,
  toNumber,
  toDate
};
