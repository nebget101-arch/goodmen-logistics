'use strict';

/**
 * FN-1139: In-memory tenant+date cache for the Daily AI Briefing.
 *
 * Briefings are deterministic per (tenantId, date) so we cache for the rest
 * of the calendar day. The backend aggregator can pass `forceRefresh` to bypass.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const store = new Map();

function buildKey(tenantId, date) {
  return `${tenantId}::${date}`;
}

function get(tenantId, date, now = Date.now()) {
  const key = buildKey(tenantId, date);
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(tenantId, date, value, ttlMs = DEFAULT_TTL_MS, now = Date.now()) {
  const key = buildKey(tenantId, date);
  store.set(key, {
    value,
    expiresAt: now + ttlMs
  });
}

function invalidate(tenantId, date) {
  store.delete(buildKey(tenantId, date));
}

function clearAll() {
  store.clear();
}

function size() {
  return store.size;
}

module.exports = {
  get,
  set,
  invalidate,
  clearAll,
  size,
  DEFAULT_TTL_MS
};
