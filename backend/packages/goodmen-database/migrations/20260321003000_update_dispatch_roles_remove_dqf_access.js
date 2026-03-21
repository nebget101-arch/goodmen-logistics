'use strict';

/**
 * Update dispatch and dispatch_manager role permissions:
 * - Remove DQF access from dispatcher and dispatch_manager
 * - Ensure safety_manager has dqf.view and dqf.manage
 * - Dispatcher/dispatch_manager keep drivers.view (read-only)
 * - Dispatcher/dispatch_manager can see HOS (read-only)
 */

exports.up = async (knex) => {
  const hasRoles = await knex.schema.hasTable('roles');
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');

  if (!hasRoles || !hasPermissions || !hasRolePermissions) {
    return;
  }

  // Get role IDs
  const [dispatcherRole, dispatchManagerRole, safetyManagerRole] = await Promise.all([
    knex('roles').where({ code: 'dispatcher' }).first('id'),
    knex('roles').where({ code: 'dispatch_manager' }).first('id'),
    knex('roles').where({ code: 'safety_manager' }).first('id')
  ]);

  // Get permission IDs
  const permissionCodes = [
    'dqf.view',
    'dqf.manage',
    'dqf.edit',
    'dqf.create',
    'dqf.delete'
  ];

  const permissions = await knex('permissions')
    .whereIn('code', permissionCodes)
    .select('id', 'code');

  const permIdsByCode = new Map(permissions.map((p) => [p.code, p.id]));

  // Remove DQF permissions from dispatcher
  if (dispatcherRole && permIdsByCode.size > 0) {
    const dqfPermIds = Array.from(permIdsByCode.values());
    await knex('role_permissions')
      .where('role_id', dispatcherRole.id)
      .whereIn('permission_id', dqfPermIds)
      .del();
  }

  // Remove DQF permissions from dispatch_manager
  if (dispatchManagerRole && permIdsByCode.size > 0) {
    const dqfPermIds = Array.from(permIdsByCode.values());
    await knex('role_permissions')
      .where('role_id', dispatchManagerRole.id)
      .whereIn('permission_id', dqfPermIds)
      .del();
  }

  // Ensure safety_manager has dqf.view and dqf.manage
  if (safetyManagerRole) {
    const dqfViewId = permIdsByCode.get('dqf.view');
    const dqfManageId = permIdsByCode.get('dqf.manage');

    if (dqfViewId) {
      const exists = await knex('role_permissions')
        .where({ role_id: safetyManagerRole.id, permission_id: dqfViewId })
        .first();
      if (!exists) {
        await knex('role_permissions').insert({
          role_id: safetyManagerRole.id,
          permission_id: dqfViewId
        });
      }
    }

    if (dqfManageId) {
      const exists = await knex('role_permissions')
        .where({ role_id: safetyManagerRole.id, permission_id: dqfManageId })
        .first();
      if (!exists) {
        await knex('role_permissions').insert({
          role_id: safetyManagerRole.id,
          permission_id: dqfManageId
        });
      }
    }
  }
};

exports.down = async (knex) => {
  // Rollback: re-add DQF permissions to dispatcher and dispatch_manager
  const hasRoles = await knex.schema.hasTable('roles');
  const hasPermissions = await knex.schema.hasTable('permissions');
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');

  if (!hasRoles || !hasPermissions || !hasRolePermissions) {
    return;
  }

  const [dispatcherRole, dispatchManagerRole] = await Promise.all([
    knex('roles').where({ code: 'dispatcher' }).first('id'),
    knex('roles').where({ code: 'dispatch_manager' }).first('id')
  ]);

  const permissionCodes = ['dqf.view', 'dqf.manage'];
  const permissions = await knex('permissions')
    .whereIn('code', permissionCodes)
    .select('id', 'code');

  const permIdsByCode = new Map(permissions.map((p) => [p.code, p.id]));

  // Re-add for dispatcher
  if (dispatcherRole && permIdsByCode.has('dqf.manage')) {
    const existing = await knex('role_permissions')
      .where({ role_id: dispatcherRole.id, permission_id: permIdsByCode.get('dqf.manage') })
      .first();
    if (!existing) {
      await knex('role_permissions').insert({
        role_id: dispatcherRole.id,
        permission_id: permIdsByCode.get('dqf.manage')
      });
    }
  }

  // Re-add for dispatch_manager
  if (dispatchManagerRole && permIdsByCode.has('dqf.manage')) {
    const existing = await knex('role_permissions')
      .where({ role_id: dispatchManagerRole.id, permission_id: permIdsByCode.get('dqf.manage') })
      .first();
    if (!existing) {
      await knex('role_permissions').insert({
        role_id: dispatchManagerRole.id,
        permission_id: permIdsByCode.get('dqf.manage')
      });
    }
  }
};
