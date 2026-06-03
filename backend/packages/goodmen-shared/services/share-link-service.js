'use strict';

/**
 * FN-1675 (Story E — Share-link generation + management) — Share-link service.
 *
 * Owns the security-sensitive primitives for per-load public tracking links:
 *   - token minting (32 random bytes, base64url) and SHA-256 hashing,
 *   - default-expiry computation (7 days post-delivery — intake decision),
 *   - reveal-options normalization (which fields the public page may show),
 *   - the view-audit helper that records a hit in `load_share_link_views` and
 *     keeps the denormalized `view_count` / `last_viewed_at` columns current.
 *
 * The raw token is shown to the broker exactly once and never persisted; only
 * its hash is stored, so a DB leak can't be replayed against the public page.
 * The view-audit helper is exported for reuse by the public read endpoint added
 * in Story F (FN-1658), which is the only consumer that records views.
 */

const crypto = require('crypto');
const { query } = require('../internal/db');

const TOKEN_BYTES = 32;
const DEFAULT_EXPIRY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Optional reveal toggles. Location + ETA + timeline are always shown on the
// public page and are intentionally NOT toggleable, so they are not stored here.
const REVEAL_TOGGLE_KEYS = ['driverName', 'vehicleNumber', 'breadcrumbs', 'routeLine'];

/** Mint a fresh 32-byte token, URL-safe base64. Shown to the broker once. */
function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hex digest of a token — what we store and look up by. */
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

/**
 * SHA-256 hex digest of an arbitrary value (viewer IP, user-agent). Returns
 * null for empty input so audit rows store NULL rather than a hash of ''.
 */
function hashValue(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!str) return null;
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Normalize the four optional reveal toggles to booleans. Anything not
 * explicitly enabled defaults to OFF (driver name / vehicle # / breadcrumbs /
 * route line are private unless the broker opts in).
 */
function normalizeRevealOptions(input) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const key of REVEAL_TOGGLE_KEYS) {
    out[key] = source[key] === true;
  }
  return out;
}

/**
 * Compute the default expiry: 7 days after the load's delivery date (intake
 * decision). When the load has no delivery date yet, fall back to 7 days from
 * `now`. `deliveryDate` may be a Date, an ISO/date string, or null.
 */
function defaultExpiry(deliveryDate, now = new Date()) {
  let base = now;
  if (deliveryDate) {
    const parsed = deliveryDate instanceof Date ? deliveryDate : new Date(deliveryDate);
    if (!Number.isNaN(parsed.getTime())) {
      base = parsed;
    }
  }
  return new Date(base.getTime() + DEFAULT_EXPIRY_DAYS * DAY_MS);
}

/**
 * Resolve the expires_at to persist on create.
 *   - explicit `expiresAt` (ISO string / Date) from the UI selector wins,
 *   - otherwise default to 7 days post-delivery.
 * Returns a Date, or null when an explicit value was provided but unparseable
 * (caller treats null-from-explicit as a validation error).
 */
function resolveExpiry({ expiresAt, deliveryDate }, now = new Date()) {
  if (expiresAt !== undefined && expiresAt !== null && String(expiresAt).trim() !== '') {
    const parsed = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }
  return defaultExpiry(deliveryDate, now);
}

/**
 * Record a single public-page view: insert one `load_share_link_views` row and
 * bump the denormalized counters on `load_share_links`. Best-effort — callers
 * (the public read endpoint) should not fail the read if auditing throws.
 *
 * @param {string} shareLinkId  load_share_links.id
 * @param {{ ip?: string, userAgent?: string }} [viewer]
 */
async function recordShareLinkView(shareLinkId, viewer = {}) {
  const ipHash = hashValue(viewer.ip);
  const userAgentHash = hashValue(viewer.userAgent);

  await query(
    `INSERT INTO load_share_link_views (share_link_id, ip_hash, user_agent_hash)
     VALUES ($1, $2, $3)`,
    [shareLinkId, ipHash, userAgentHash]
  );

  await query(
    `UPDATE load_share_links
        SET view_count = view_count + 1,
            last_viewed_at = now()
      WHERE id = $1`,
    [shareLinkId]
  );
}

module.exports = {
  TOKEN_BYTES,
  DEFAULT_EXPIRY_DAYS,
  REVEAL_TOGGLE_KEYS,
  generateToken,
  hashToken,
  hashValue,
  normalizeRevealOptions,
  defaultExpiry,
  resolveExpiry,
  recordShareLinkView
};
