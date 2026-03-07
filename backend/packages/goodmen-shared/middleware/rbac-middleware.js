'use strict';

/**
 * RBAC middleware: load user access and enforce permission / location checks.
 * Use after authMiddleware so req.user.id is set.
 */

const rbacService = require('../services/rbac-service');

/**
 * Attach roles, permission codes, and location IDs to req.user.rbac.
 * Call this after authMiddleware on routes that need permission or location checks.
 */
function loadUserRbac(req, res, next) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  rbacService
    .loadUserAccess(userId)
    .then((access) => {
      req.user.rbac = {
        roles: access.roles,
        permissionCodes: Array.from(access.permissions),
        locationIds: access.locationIds
      };
      next();
    })
    .catch((err) => {
      console.error('[rbac] loadUserRbac error', err);
      res.status(500).json({ error: 'Failed to load user access' });
    });
}

/**
 * Require one or more permission codes. Use after loadUserRbac (or ensure rbac is loaded).
 */
function requirePermission(permissionCode) {
  return (req, res, next) => {
    const rbac = req.user?.rbac;
    if (!rbac) {
      return res.status(403).json({ error: 'Forbidden: access not resolved' });
    }
    const codes = rbac.permissionCodes || [];
    const hasSuperAdmin = (rbac.roles || []).some((r) => r.code === rbacService.SUPER_ADMIN_ROLE_CODE);
    if (hasSuperAdmin || codes.includes(permissionCode)) {
      return next();
    }
    res.status(403).json({ error: 'Forbidden: insufficient permission', required: permissionCode });
  };
}

/**
 * Require at least one of the given permission codes.
 */
function requireAnyPermission(permissionCodes) {
  return (req, res, next) => {
    const rbac = req.user?.rbac;
    if (!rbac) {
      return res.status(403).json({ error: 'Forbidden: access not resolved' });
    }
    const codes = rbac.permissionCodes || [];
    const hasSuperAdmin = (rbac.roles || []).some((r) => r.code === rbacService.SUPER_ADMIN_ROLE_CODE);
    if (hasSuperAdmin) return next();
    const hasAny = permissionCodes.some((c) => codes.includes(c));
    if (hasAny) return next();
    res.status(403).json({ error: 'Forbidden: insufficient permission', requiredOneOf: permissionCodes });
  };
}

/**
 * Require that the user has access to the given location (or is super_admin).
 * resourceLocationId can be req.params.locationId, req.body.location_id, or from a loaded resource.
 */
function requireLocationAccess(getLocationId) {
  const fn = typeof getLocationId === 'function' ? getLocationId : () => getLocationId;
  return (req, res, next) => {
    const rbac = req.user?.rbac;
    if (!rbac) {
      return res.status(403).json({ error: 'Forbidden: access not resolved' });
    }
    const hasSuperAdmin = (rbac.roles || []).some((r) => r.code === rbacService.SUPER_ADMIN_ROLE_CODE);
    if (hasSuperAdmin) return next();
    const locationId = fn(req);
    if (!locationId) return next();
    const locationIds = rbac.locationIds || [];
    if (locationIds.includes(locationId)) return next();
    res.status(403).json({ error: 'Forbidden: no access to this location' });
  };
}

/**
 * Combined: require permission and optionally location. Use after loadUserRbac.
 * authorizeResource({ permission: 'work_orders.edit', getLocationId: (req) => req.body.location_id })
 */
function authorizeResource({ permission, getLocationId }) {
  const stack = [requirePermission(permission)];
  if (getLocationId) {
    stack.push(requireLocationAccess(getLocationId));
  }
  return (req, res, next) => {
    let i = 0;
    function run() {
      if (i >= stack.length) return next();
      stack[i](req, res, (err) => {
        if (err) return next(err);
        i++;
        run();
      });
    }
    run();
  };
}

module.exports = {
  loadUserRbac,
  requirePermission,
  requireAnyPermission,
  requireLocationAccess,
  authorizeResource
};
