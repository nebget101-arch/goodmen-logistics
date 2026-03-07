'use strict';

/**
 * Backfill user_roles from existing users.role (legacy column).
 * Mapping: admin -> super_admin, safety -> safety_manager, fleet -> dispatcher, dispatch -> dispatcher, driver -> driver.
 * Does NOT remove users.role column (backward compatibility).
 * TODO: Deprecate users.role once all consumers use RBAC; then remove column in a future migration.
 */

const LEGACY_TO_ROLE_CODE = {
  admin: 'super_admin',
  safety: 'safety_manager',
  fleet: 'dispatcher',
  dispatch: 'dispatcher',
  driver: 'driver'
};

exports.up = async function (knex) {
  const hasUserRoles = await knex.schema.hasTable('user_roles');
  const hasRoles = await knex.schema.hasTable('roles');
  const hasRoleColumn = await knex.schema.hasColumn('users', 'role');
  if (!hasUserRoles || !hasRoles || !hasRoleColumn) return;

  const roleRows = await knex('roles').select('id', 'code');
  const roleByCode = new Map(roleRows.map((r) => [r.code, r.id]));

  const users = await knex('users').select('id', 'role');
  for (const user of users) {
    const legacy = (user.role || '').toString().trim().toLowerCase();
    const roleCode = LEGACY_TO_ROLE_CODE[legacy] || 'dispatcher';
    const roleId = roleByCode.get(roleCode);
    if (!roleId) continue;

    const exists = await knex('user_roles').where({ user_id: user.id, role_id: roleId }).first();
    if (!exists) {
      await knex('user_roles').insert({ user_id: user.id, role_id: roleId });
    }
  }
};

exports.down = async function (knex) {
  // Do not remove user_roles rows; backfill is additive. Down is no-op.
  return Promise.resolve();
};
