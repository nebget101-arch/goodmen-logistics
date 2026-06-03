'use strict';

/**
 * FN-1161: Smart Alerts dismissals store.
 *
 * Tracks per-(tenant, user) dismissed alert IDs with a TTL so the panel
 * does not re-surface dismissed items for 24h (FN-1128 AC).
 *
 * The default `MemoryDismissalsStore` is process-local. A Postgres-backed
 * implementation that persists to the `user_alert_dismissals` table will
 * land alongside the FN-1165 migration; this module exposes the same
 * `{ isDismissed, dismiss }` interface so the swap is mechanical.
 */

const DEFAULT_DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

function key(tenantId, userId, alertId) {
  return `${tenantId}::${userId}::${alertId}`;
}

class MemoryDismissalsStore {
  constructor({ ttlMs = DEFAULT_DISMISS_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
  }

  async isDismissed({ tenantId, userId, alertId }) {
    if (!tenantId || !userId || !alertId) return false;
    const k = key(tenantId, userId, alertId);
    const entry = this.entries.get(k);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(k);
      return false;
    }
    return true;
  }

  async dismiss({ tenantId, userId, alertId }) {
    if (!tenantId || !userId || !alertId) {
      const err = new Error('dismissals-store: tenantId, userId, alertId required');
      err.code = 'MISSING_ARGS';
      throw err;
    }
    const expiresAt = this.now() + this.ttlMs;
    this.entries.set(key(tenantId, userId, alertId), { expiresAt });
    return { tenantId, userId, alertId, expiresAt };
  }

  // Test/maintenance helper — drops expired entries.
  prune() {
    const now = this.now();
    for (const [k, v] of this.entries.entries()) {
      if (v.expiresAt <= now) this.entries.delete(k);
    }
  }

  size() {
    return this.entries.size;
  }
}

module.exports = {
  MemoryDismissalsStore,
  DEFAULT_DISMISS_TTL_MS
};
