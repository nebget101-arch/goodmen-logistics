'use strict';

/**
 * FN-1176: In-memory rationale store for AI explainability tokens.
 *
 * Each AI-derived value (briefing claim, severity decision, predictive trend)
 * mints a token here that the frontend explanation panel resolves via
 * `GET /api/ai/explain/:token`. Tokens expire after 30 days; entries are
 * purged lazily on read and eagerly via `purgeExpired`.
 *
 * In-memory only (Map-backed) — matches existing ai-service caching pattern
 * (see src/cache/briefing-cache.js). Restarts drop tokens; the frontend
 * gracefully renders "rationale unavailable" for 404s.
 */

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_PREFIX = 'expl_';
const TOKEN_HEX_LENGTH = 32; // 16 random bytes -> 32 hex chars
const TOKEN_REGEX = new RegExp(`^${TOKEN_PREFIX}[a-f0-9]{${TOKEN_HEX_LENGTH}}$`);

const store = new Map();

function generateToken() {
  return TOKEN_PREFIX + crypto.randomBytes(TOKEN_HEX_LENGTH / 2).toString('hex');
}

function isValidTokenFormat(token) {
  return typeof token === 'string' && TOKEN_REGEX.test(token);
}

function mint(rationale, options = {}) {
  if (!rationale || typeof rationale !== 'object' || Array.isArray(rationale)) {
    throw new TypeError('rationale must be a non-array object');
  }
  const now = options.now || Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS;
  const token = generateToken();
  store.set(token, {
    rationale,
    createdAt: now,
    expiresAt: now + ttlMs
  });
  return token;
}

function get(token, now = Date.now()) {
  if (!isValidTokenFormat(token)) return null;
  const entry = store.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    store.delete(token);
    return null;
  }
  return {
    rationale: entry.rationale,
    createdAt: new Date(entry.createdAt).toISOString(),
    expiresAt: new Date(entry.expiresAt).toISOString()
  };
}

function purgeExpired(now = Date.now()) {
  let removed = 0;
  for (const [token, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(token);
      removed += 1;
    }
  }
  return removed;
}

function size() {
  return store.size;
}

function clearAll() {
  store.clear();
}

module.exports = {
  mint,
  get,
  size,
  clearAll,
  purgeExpired,
  isValidTokenFormat,
  DEFAULT_TTL_MS,
  TOKEN_PREFIX
};
