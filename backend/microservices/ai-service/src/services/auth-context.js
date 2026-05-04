'use strict';

/**
 * FN-1134: Lightweight auth context for ai-service routes that need RBAC.
 *
 * The gateway has already verified the bearer JWT before proxying to us, so
 * here we trust-decode (without re-verifying the signature) just enough to
 * surface the role/permissions to handlers like reports-anomalies-handler.
 * Permissions for the role are looked up against a static map mirrored from
 * `backend/packages/goodmen-database/seeds/01_rbac_seed.js`. The map only
 * needs to cover roles that may legitimately read reports.
 *
 * This is intentionally narrow: it's not a replacement for the full RBAC
 * service (loadUserAccess + role_permissions table). It exists so the AI
 * service can return a fast 403 for clearly-unauthorised callers without
 * adding a DB round-trip per request. For finer-grained permission edits
 * (custom role overrides), the gateway should populate
 * `x-user-permissions: <csv>` and we will prefer that over the static map.
 */

const ROLE_PERMISSIONS = Object.freeze({
  super_admin: null, // wildcard — every permission
  admin: ['reports.view', 'reports.export', 'reports.shop'],
  company_admin: ['reports.view', 'reports.export', 'reports.shop'],
  executive_read_only: ['reports.view'],
  dispatch_manager: ['reports.view', 'reports.export'],
  driver_supervisor: ['reports.view'],
  carrier_accountant: ['reports.view', 'reports.export'],
  inventory_auditor: ['reports.view'],
  company_accountant: ['reports.view', 'reports.export'],
  // FN-1137: reports.shop is the escalated permission for the shop reporting
  // surface (revenue/margin chat). Mirrors `06_shop_clerk_seed.js`.
  shop_manager: ['reports.shop'],
  parts_manager: ['reports.shop']
});

function decodeJwtPayload(authHeader) {
  if (typeof authHeader !== 'string') return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64 + '='.repeat((4 - payloadB64.length % 4) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch (_err) {
    return null;
  }
}

function permissionsForRole(role) {
  if (!role || typeof role !== 'string') return [];
  const entry = ROLE_PERMISSIONS[role];
  if (entry === null) return null; // wildcard
  return Array.isArray(entry) ? entry.slice() : [];
}

function parseHeaderPermissions(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Express middleware that surfaces { id, role, tenantId, permissions } onto
 * req.user. Never rejects — handlers do their own RBAC check so the same
 * middleware can be reused by routes with different permission requirements.
 */
function loadAuthContext(req, _res, next) {
  if (req.user && (Array.isArray(req.user.permissions) || req.user.role === 'super_admin')) {
    return next();
  }

  const headerPerms = parseHeaderPermissions(req.headers['x-user-permissions']);
  const payload = decodeJwtPayload(req.headers.authorization);

  if (!payload && !headerPerms) {
    req.user = req.user || null;
    return next();
  }

  const role = payload && typeof payload.role === 'string' ? payload.role : null;
  const id = payload ? (payload.id || payload.sub || null) : null;
  const tenantId = payload ? (payload.tenant_id || payload.tenantId || null) : null;
  const rolePerms = role ? permissionsForRole(role) : [];
  const permissions = headerPerms || rolePerms; // null sentinel handled by hasReportsView super_admin path

  req.user = {
    id,
    role,
    tenantId,
    permissions: Array.isArray(permissions) ? permissions : []
  };
  next();
}

module.exports = {
  loadAuthContext,
  decodeJwtPayload,
  permissionsForRole,
  parseHeaderPermissions,
  ROLE_PERMISSIONS
};
