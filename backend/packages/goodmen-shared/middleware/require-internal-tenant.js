'use strict';

/**
 * Guard that allows the request only when the caller's tenant has
 * `tenants.is_internal = true`. Returns 403 otherwise (false, NULL,
 * or unresolved tenant). Intended to fence FleetNeuron-internal
 * admin endpoints (e.g. FMCSA import control plane).
 *
 * Must run after `tenantContextMiddleware` so `req.context.tenantId`
 * is populated.
 */
function createRequireInternalTenant({ knexClient } = {}) {
  // Resolve knex lazily so tests can inject a fake without loading the real
  // DB config (which fails when no DB is configured).
  let resolvedKnex = knexClient || null;
  function getKnex() {
    if (!resolvedKnex) {
      resolvedKnex = require('../config/knex');
    }
    return resolvedKnex;
  }

  return async function requireInternalTenant(req, res, next) {
    try {
      const tenantId = req.context?.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Forbidden: tenant context missing' });
      }
      const row = await getKnex()('tenants')
        .where({ id: tenantId })
        .first('is_internal');
      if (!row || row.is_internal !== true) {
        return res.status(403).json({ error: 'Forbidden: not a FleetNeuron-internal tenant' });
      }
      return next();
    } catch (err) {
      console.error('[require-internal-tenant] lookup failed', err);
      return res.status(500).json({ error: 'Failed to verify tenant access' });
    }
  };
}

const requireInternalTenant = createRequireInternalTenant();

module.exports = requireInternalTenant;
module.exports.createRequireInternalTenant = createRequireInternalTenant;
