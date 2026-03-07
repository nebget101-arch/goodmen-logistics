'use strict';

/**
 * RBAC service: resolve user roles, permissions, and locations from DB.
 * Used by middleware and API. Requires setDatabase() to have been called.
 */

const db = require('../internal/db').knex;

const SUPER_ADMIN_ROLE_CODE = 'super_admin';

async function getRolesForUser(userId) {
  if (!db) return [];
  const rows = await db('user_roles as ur')
    .join('roles as r', 'ur.role_id', 'r.id')
    .where('ur.user_id', userId)
    .select('r.id', 'r.code', 'r.name');
  return rows;
}

async function getPermissionsForUser(userId) {
  if (!db) return new Set();
  const roles = await getRolesForUser(userId);
  const roleCodes = roles.map((r) => r.code);
  if (roleCodes.includes(SUPER_ADMIN_ROLE_CODE)) {
    const all = await db('permissions').select('code');
    return new Set(all.map((p) => p.code));
  }
  const roleIds = roles.map((r) => r.id);
  const rows = await db('role_permissions as rp')
    .join('permissions as p', 'rp.permission_id', 'p.id')
    .whereIn('rp.role_id', roleIds)
    .distinct('p.code')
    .select('p.code');
  return new Set(rows.map((r) => r.code));
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
  SUPER_ADMIN_ROLE_CODE
};
