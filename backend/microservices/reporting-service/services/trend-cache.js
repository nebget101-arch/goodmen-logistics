'use strict';

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes per FN-1126 acceptance criteria

function buildTrendCache(deps = {}) {
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const now = deps.now ?? (() => Date.now());
  const store = new Map();

  function key(tenantId, range) {
    return `${tenantId}:${range}`;
  }

  function get(tenantId, range) {
    const k = key(tenantId, range);
    const entry = store.get(k);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      store.delete(k);
      return null;
    }
    return entry.value;
  }

  function set(tenantId, range, value) {
    store.set(key(tenantId, range), {
      value,
      expiresAt: now() + ttlMs
    });
  }

  function invalidate(tenantId, range) {
    store.delete(key(tenantId, range));
  }

  function clear() {
    store.clear();
  }

  return { get, set, invalidate, clear, _store: store, ttlMs };
}

module.exports = { buildTrendCache, DEFAULT_TTL_MS };
