'use strict';

/**
 * RBAC service: resolve user roles, permissions, and locations from DB.
 * Used by middleware and API. Requires setDatabase() to have been called.
 */

const db = require('../internal/db').knex;

const SUPER_ADMIN_ROLE_CODE = 'super_admin';
const TENANT_ADMIN_ROLE_CODES = new Set(['admin', 'company_admin']);
const TENANT_ADMIN_FALLBACK_PERMISSIONS = ['users.view', 'users.manage', 'roles.view'];

/** Roles that own the Safety module (claims, incidents, reports). Must match safety router / product policy. */
const SAFETY_ROLE_CODES = new Set(['safety_manager', 'safety']);

/**
 * Default permission codes for safety roles when DB role_permissions is empty or user only has
 * legacy users.role (no user_roles row → no role_id → no role_permissions join). Without this,
 * loadUserRbac yields an empty set and GET /api/safety/overview returns 403 (FN-132).
 * Keep in sync with `routes/safety.js` SAFETY_ANY_PERMISSION.
 */
const SAFETY_DEFAULT_PERMISSION_CODES = [
  'safety.incidents.view',
  'safety.incidents.create',
  'safety.incidents.edit',
  'safety.incidents.close',
  'safety.claims.view',
  'safety.claims.create',
  'safety.claims.edit',
  'safety.claims.financials.view',
  'safety.claims.financials.edit',
  'safety.documents.upload',
  'safety.reports.view',
];

/**
 * Merge baseline Safety permissions when the user has a safety role.
 * Exported for unit tests.
 * @param {string[]} roleCodes
 * @param {Set<string>} permissionSet
 */
function mergeSafetyBaselineIfApplicable(roleCodes, permissionSet) {
  if (!roleCodes?.length || !permissionSet) return;
  if (!roleCodes.some((code) => SAFETY_ROLE_CODES.has(code))) return;
  SAFETY_DEFAULT_PERMISSION_CODES.forEach((code) => permissionSet.add(code));
}

/**
 * Safety assigns trucks/trailers to drivers and maintains unit records + documents (product 2026).
 * Merged when DB role_permissions is incomplete (legacy users.role fallback).
 */
const SAFETY_FLEET_UNIT_BASELINE_CODES = [
  'vehicles.create',
  'vehicles.edit',
  'trailers.view',
  'trailers.create',
  'trailers.edit',
  'documents.view',
  'documents.upload',
];

function mergeSafetyFleetUnitBaselineIfApplicable(roleCodes, permissionSet) {
  if (!roleCodes?.length || !permissionSet) return;
  if (!roleCodes.some((code) => SAFETY_ROLE_CODES.has(code))) return;
  SAFETY_FLEET_UNIT_BASELINE_CODES.forEach((code) => permissionSet.add(code));
}

/**
 * Maps legacy users.role string values to canonical RBAC role codes.
 *
 * Used only as a fallback when a user has NO rows in user_roles (i.e. migration
 * hasn't backfilled them yet). Once user_roles is populated for a user this
 * mapping is irrelevant for that user.
 *
 * Rules:
 *  - Keep all existing mappings unchanged (backward compat).
 *  - New role codes that match their JWT claim directly are listed explicitly so
 *    that legacy users whose users.role column already contains the new code also
 *    resolve correctly.
 */
const LEGACY_TO_ROLE_CODE = {
  // Pre-existing legacy mappings — do NOT change these
  // NOTE: 'admin' now maps to 'admin' (tenant admin) not 'super_admin' (platform admin)
  // Trial users created with role='admin' should NOT be elevated to super_admin
  admin: 'admin',
  safety: 'safety_manager',
  /** JWT / users.role may already store the canonical RBAC code */
  safety_manager: 'safety_manager',
  fleet: 'dispatcher',
  dispatch: 'dispatcher',
  driver: 'driver',

  // Shop roles: users.role column may already contain the canonical code.
  // Listed here so getLegacyRoleCodeForUser() returns them correctly.
  shop_manager:      'shop_manager',
  shop_clerk:        'shop_clerk',
  service_writer:    'service_writer',
  service_advisor:   'service_writer',  // old alias → service_writer role
  mechanic:          'mechanic',
  technician:        'technician',
  parts_manager:     'parts_manager',
  parts_clerk:       'parts_clerk',
  inventory_auditor: 'inventory_auditor',

  // Accounting variants
  accounting:        'carrier_accountant',  // old alias
  carrier_accountant: 'carrier_accountant',
  company_accountant: 'company_accountant',

  // Other
  executive_read_only: 'executive_read_only',
  customer:            'customer',
};

async function getLegacyRoleCodeForUser(userId) {
  if (!db) return null;
  const hasUsersTable = await db.schema.hasTable('users');
  if (!hasUsersTable) return null;

  const row = await db('users').where('id', userId).first('role');
  const legacyRole = (row?.role || '').toString().trim().toLowerCase();
  return LEGACY_TO_ROLE_CODE[legacyRole] || null;
}

async function getRolesForUser(userId) {
  if (!db) return [];
  const hasUserRoles = await db.schema.hasTable('user_roles');
  const hasRoles = await db.schema.hasTable('roles');

  if (hasUserRoles && hasRoles) {
    const rows = await db('user_roles as ur')
      .join('roles as r', 'ur.role_id', 'r.id')
      .where('ur.user_id', userId)
      .select('r.id', 'r.code', 'r.name');

    if (rows.length > 0) return rows;
  }

  // Legacy fallback: map users.role to an RBAC role code when no role assignment exists yet.
  const fallbackCode = await getLegacyRoleCodeForUser(userId);
  if (!fallbackCode) return [];

  return [{ id: null, code: fallbackCode, name: `Legacy ${fallbackCode}` }];
}

async function getPermissionsForUser(userId) {
  if (!db) return new Set();
  const roles = await getRolesForUser(userId);
  const roleCodes = roles.map((r) => r.code);
  if (roleCodes.includes(SUPER_ADMIN_ROLE_CODE)) {
    const all = await db('permissions').select('code');
    return new Set(all.map((p) => p.code));
  }

  const permissionSet = new Set();

  // Legacy-safe baseline: tenant admins must be able to manage users even when
  // their access is resolved from users.role fallback (no user_roles rows yet).
  if (roleCodes.some((code) => TENANT_ADMIN_ROLE_CODES.has(code))) {
    TENANT_ADMIN_FALLBACK_PERMISSIONS.forEach((code) => permissionSet.add(code));
  }

  const roleIds = roles.map((r) => r.id).filter(Boolean);
  if (roleIds.length > 0) {
    const rows = await db('role_permissions as rp')
      .join('permissions as p', 'rp.permission_id', 'p.id')
      .whereIn('rp.role_id', roleIds)
      .distinct('p.code')
      .select('p.code');
    rows.forEach((row) => permissionSet.add(row.code));
  }

  mergeSafetyBaselineIfApplicable(roleCodes, permissionSet);
  mergeSafetyFleetUnitBaselineIfApplicable(roleCodes, permissionSet);

  return permissionSet;
}

async function getLocationIdsForUser(userId) {
  if (!db) return [];
  const rows = await db('user_locations').where('user_id', userId).select('location_id');
  return rows.map((r) => r.location_id);
}

async function hasPermission(userId, permissionCode) {
  const perms = await getPermissionsForUser(userId);
  return perms.has(permissionCode);
}

async function hasAnyPermission(userId, permissionCodes) {
  if (!permissionCodes || permissionCodes.length === 0) return false;
  const perms = await getPermissionsForUser(userId);
  return permissionCodes.some((c) => perms.has(c));
}

async function hasLocationAccess(userId, locationId) {
  if (!locationId) return true;
  const roles = await getRolesForUser(userId);
  if (roles.some((r) => r.code === SUPER_ADMIN_ROLE_CODE)) return true;
  const locationIds = await getLocationIdsForUser(userId);
  return locationIds.includes(locationId);
}

async function loadUserAccess(userId) {
  const [roles, permissions, locationIds] = await Promise.all([
    getRolesForUser(userId),
    getPermissionsForUser(userId),
    getLocationIdsForUser(userId)
  ]);
  return {
    roles,
    permissions: permissions,
    locationIds
  };
}

module.exports = {
  getRolesForUser,
  getPermissionsForUser,
  getLocationIdsForUser,
  hasPermission,
  hasAnyPermission,
  hasLocationAccess,
  loadUserAccess,
  SUPER_ADMIN_ROLE_CODE,
  mergeSafetyBaselineIfApplicable,
  mergeSafetyFleetUnitBaselineIfApplicable,
  SAFETY_ROLE_CODES,
  SAFETY_DEFAULT_PERMISSION_CODES,
  SAFETY_FLEET_UNIT_BASELINE_CODES,
};
