'use strict';

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes per FN-1126 acceptance criteria

function buildTrendCache(deps = {}) {
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const now = deps.now ?? (() => Date.now());
  const store = new Map();

  function key(tenantId, range, date) {
    return `${tenantId}:${range}:${date}`;
  }

  function get(tenantId, range, date) {
    const k = key(tenantId, range, date);
    const entry = store.get(k);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      store.delete(k);
      return null;
    }
    return entry.value;
  }

  function set(tenantId, range, date, value) {
    store.set(key(tenantId, range, date), {
      value,
      expiresAt: now() + ttlMs
    });
  }

  function invalidate(tenantId, range, date) {
    store.delete(key(tenantId, range, date));
  }

  function clear() {
    store.clear();
  }

  return { get, set, invalidate, clear, _store: store, ttlMs };
}

module.exports = { buildTrendCache, DEFAULT_TTL_MS };
