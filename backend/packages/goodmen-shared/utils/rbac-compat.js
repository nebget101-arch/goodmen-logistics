'use strict';

/**
 * RBAC Compatibility Adapter for FleetNeuron.
 *
 * Background:
 *   Routes historically used `requireRole(['admin', 'fleet'])` checks against
 *   req.user.role (a single string from the JWT). The new RBAC system resolves
 *   permission codes from the roles + role_permissions tables (see rbac-service.js
 *   and rbac-middleware.js). Both systems coexist during migration.
 *
 * This module provides:
 *   - Role sets (SHOP_ROLES, MANAGER_ROLES, SHOP_READ_ROLES) for use in requireRole arrays.
 *   - requireShopClerkOrAbove()   — middleware: any shop role (including shop_clerk).
 *   - requireManagerRole()        — middleware: only manager-level roles (not shop_clerk).
 *   - requireFinalizeStatusGuard() — middleware: blocks shop_clerk from setting
 *                                    restricted statuses (posted, void, closed, approved).
 *   - legacyRoleHasShopAccess()   — helper for programmatic checks.
 *   - legacyRoleIsManager()       — helper for programmatic checks.
 *
 * Compatibility guarantee:
 *   - Routes that have NOT been updated continue to work exactly as before.
 *   - This module is only consumed by routes that are explicitly updated.
 *   - The existing requirePermission / loadUserRbac middleware (rbac-middleware.js) is
 *     unaffected and can still be used independently on any route.
 *
 * Usage example:
 *   const { requireShopClerkOrAbove, requireManagerRole, requireFinalizeStatusGuard } = require('../utils/rbac-compat');
 *
 *   router.post('/', authMiddleware, requireShopClerkOrAbove(), handler);
 *   router.patch('/:id/status', authMiddleware, requireShopClerkOrAbove(),
 *     requireFinalizeStatusGuard(['posted', 'void'], MANAGER_ROLES, (req) => req.body?.status),
 *     handler);
 */

/**
 * All roles that may perform CRUD operations in the shop module.
 * shop_clerk is the most-restricted; shop_manager is the broadest.
 */
const SHOP_ROLES = [
  'admin',
  'super_admin',
  'shop_manager',
  'service_writer',
  'service_advisor',  // legacy alias for service_writer
  'shop_clerk',
  'mechanic',
  'technician',
];

/**
 * Roles that may finalize records:
 *   post/void invoices, close/approve work orders, refund payments, approve discounts.
 *
 * shop_clerk is intentionally excluded.
 * accounting / carrier_accountant / company_accountant are included for invoice finalization.
 */
const MANAGER_ROLES = [
  'admin',
  'super_admin',
  'shop_manager',
  'carrier_accountant',
  'company_accountant',
  'accounting',
];

/**
 * Roles that may read (view) shop data: customers, vehicles, work orders, invoices.
 * Wider than SHOP_ROLES — also includes read-only auditor and dispatch roles.
 */
const SHOP_READ_ROLES = [
  ...SHOP_ROLES,
  'inventory_auditor',
  'parts_manager',
  'parts_clerk',
  'dispatch_manager',
  'dispatcher',
  'executive_read_only',
];

// De-duplicate in case of future overlap
const UNIQUE_SHOP_READ_ROLES = [...new Set(SHOP_READ_ROLES)];

/**
 * Returns true if the given legacy role string has shop-level (operational) access.
 * @param {string} role
 */
function legacyRoleHasShopAccess(role) {
  if (!role) return false;
  return SHOP_ROLES.includes(role.toString().trim().toLowerCase());
}

/**
 * Returns true if the given role may perform manager-only finalization actions.
 * @param {string} role
 */
function legacyRoleIsManager(role) {
  if (!role) return false;
  return MANAGER_ROLES.includes(role.toString().trim().toLowerCase());
}

/**
 * Express middleware factory: requires the user's role (req.user.role) to be in allowedRoles.
 * Drop-in equivalent of the inline requireRole() defined in each route file.
 * Checks the single-role JWT claim; does NOT load DB permissions.
 *
 * @param {string[]} allowedRoles
 */
function requireAnyRole(allowedRoles) {
  const allowed = allowedRoles.map((r) => r.toString().trim().toLowerCase());
  return (req, res, next) => {
    const role = (req.user?.role || '').toString().trim().toLowerCase();
    if (allowed.includes(role)) return next();
    return res.status(403).json({
      error: 'Forbidden: insufficient role',
      required: allowedRoles,
    });
  };
}

/**
 * Middleware: allows any role in SHOP_ROLES (includes shop_clerk and above).
 */
function requireShopClerkOrAbove() {
  return requireAnyRole(SHOP_ROLES);
}

/**
 * Middleware: allows only MANAGER_ROLES (excludes shop_clerk, mechanic, technician).
 * Use for invoice post/void, work order close/approve, payment refund, discount approval.
 */
function requireManagerRole() {
  return requireAnyRole(MANAGER_ROLES);
}

/**
 * Status-aware finalization guard.
 *
 * Inspects the target status from the request. If the target status is in
 * restrictedTargetStatuses, the user's role must be in managerRoles. Otherwise
 * the middleware passes through without restriction.
 *
 * This allows shop_clerk to transition to non-restricted statuses (e.g. open →
 * in_progress) while blocking them from finalizing (e.g. draft → posted).
 *
 * @param {string[]}           restrictedTargetStatuses  Status values that require manager
 * @param {string[]}           managerRoles              Roles allowed to set restricted statuses
 * @param {(req: object) => string} getTargetStatus      Extracts the target status from the request
 *
 * @example
 *   router.patch('/:id/status',
 *     authMiddleware,
 *     requireShopClerkOrAbove(),
 *     requireFinalizeStatusGuard(
 *       ['posted', 'void'],
 *       MANAGER_ROLES,
 *       (req) => req.body?.status
 *     ),
 *     handler
 *   );
 */
function requireFinalizeStatusGuard(restrictedTargetStatuses, managerRoles, getTargetStatus) {
  const restricted = restrictedTargetStatuses.map((s) => s.toString().trim().toLowerCase());
  const managers   = managerRoles.map((r) => r.toString().trim().toLowerCase());

  return (req, res, next) => {
    const targetStatus = (getTargetStatus(req) || '').toString().trim().toLowerCase();

    // Not a restricted status transition — let through
    if (!restricted.includes(targetStatus)) return next();

    const role = (req.user?.role || '').toString().trim().toLowerCase();
    if (managers.includes(role)) return next();

    return res.status(403).json({
      error: 'Forbidden: only managers may transition to this status',
      targetStatus,
      requiredRoles: managerRoles,
    });
  };
}

module.exports = {
  SHOP_ROLES,
  MANAGER_ROLES,
  SHOP_READ_ROLES: UNIQUE_SHOP_READ_ROLES,
  legacyRoleHasShopAccess,
  legacyRoleIsManager,
  requireAnyRole,
  requireShopClerkOrAbove,
  requireManagerRole,
  requireFinalizeStatusGuard,
};
