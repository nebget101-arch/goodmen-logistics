/**
 * Migration: add locations sub-module permissions — FN-695
 *
 * Adds locations.bins.manage, locations.users.manage, locations.supply_rules.manage
 * to the permissions table, and grants them to shop_manager, parts_manager, and super_admin.
 */

const NEW_PERMISSIONS = [
  { module: 'locations', action: 'manage', code: 'locations.bins.manage', description: 'Manage bins within locations' },
  { module: 'locations', action: 'manage', code: 'locations.users.manage', description: 'Manage user-location assignments' },
  { module: 'locations', action: 'manage', code: 'locations.supply_rules.manage', description: 'Manage warehouse-to-shop supply rules' }
];

// Roles that should receive the new permissions
const GRANT_TO_ROLES = ['super_admin', 'shop_manager', 'parts_manager'];

exports.up = async function (knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  if (!hasPermissions) return;

  // Insert permissions (idempotent)
  for (const p of NEW_PERMISSIONS) {
    const exists = await knex('permissions').where({ code: p.code }).first();
    if (!exists) {
      await knex('permissions').insert({
        ...p,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    }
  }

  // Grant to roles
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasRolePermissions) return;

  const permRows = await knex('permissions')
    .whereIn('code', NEW_PERMISSIONS.map((p) => p.code))
    .select('id', 'code');

  const roles = await knex('roles')
    .whereIn('code', GRANT_TO_ROLES)
    .select('id', 'code');

  for (const role of roles) {
    const existing = await knex('role_permissions')
      .where({ role_id: role.id })
      .select('permission_id');
    const existingSet = new Set(existing.map((r) => r.permission_id));

    for (const perm of permRows) {
      if (!existingSet.has(perm.id)) {
        await knex('role_permissions').insert({
          role_id: role.id,
          permission_id: perm.id
        });
      }
    }
  }
};

exports.down = async function (knex) {
  const hasPermissions = await knex.schema.hasTable('permissions');
  if (!hasPermissions) return;

  const permCodes = NEW_PERMISSIONS.map((p) => p.code);
  const permRows = await knex('permissions').whereIn('code', permCodes).select('id');
  const permIds = permRows.map((r) => r.id);

  if (permIds.length > 0) {
    const hasRolePermissions = await knex.schema.hasTable('role_permissions');
    if (hasRolePermissions) {
      await knex('role_permissions').whereIn('permission_id', permIds).del();
    }
    await knex('permissions').whereIn('id', permIds).del();
  }
};
