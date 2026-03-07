'use strict';

/**
 * RBAC (Role-Based Access Control) schema.
 * - roles, permissions, role_permissions
 * - user_roles (many-to-many users <-> roles)
 * - locations: add code, location_type, active
 * - user_locations (many-to-many users <-> locations)
 * - divisions (optional: carrier, shop, parts)
 * Does NOT remove users.role column; backfill migration will map legacy role to new roles.
 */

exports.up = async function (knex) {
  // Divisions (optional grouping for locations/roles)
  const hasDivisions = await knex.schema.hasTable('divisions');
  if (!hasDivisions) {
    await knex.schema.createTable('divisions', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.string('code', 64).notNullable().unique();
      table.string('name', 255).notNullable();
      table.timestamps(true, true);
    });
  }

  // Roles
  const hasRoles = await knex.schema.hasTable('roles');
  if (!hasRoles) {
    await knex.schema.createTable('roles', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.string('code', 64).notNullable().unique();
      table.string('name', 255).notNullable();
      table.text('description');
      table.timestamps(true, true);
    });
  }

  // Permissions (module.action e.g. loads.view, work_orders.edit)
  const hasPermissions = await knex.schema.hasTable('permissions');
  if (!hasPermissions) {
    await knex.schema.createTable('permissions', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.string('module', 64).notNullable();
      table.string('action', 64).notNullable();
      table.string('code', 128).notNullable().unique();
      table.text('description');
      table.timestamps(true, true);
    });
  }

  // role_permissions
  const hasRolePermissions = await knex.schema.hasTable('role_permissions');
  if (!hasRolePermissions) {
    await knex.schema.createTable('role_permissions', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
      table.uuid('permission_id').notNullable().references('id').inTable('permissions').onDelete('CASCADE');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.unique(['role_id', 'permission_id']);
    });
  }

  // user_roles
  const hasUserRoles = await knex.schema.hasTable('user_roles');
  if (!hasUserRoles) {
    await knex.schema.createTable('user_roles', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.unique(['user_id', 'role_id']);
    });
  }

  // locations: add code, location_type, active, division_id if missing
  const hasLocations = await knex.schema.hasTable('locations');
  if (hasLocations) {
    const addCol = async (col, fn) => {
      const has = await knex.schema.hasColumn('locations', col);
      if (!has) await knex.schema.alterTable('locations', fn);
    };
    await addCol('code', (t) => t.string('code', 64));
    await addCol('location_type', (t) => t.string('location_type', 64));
    await addCol('active', (t) => t.boolean('active').defaultTo(true));
    const hasDivisionId = await knex.schema.hasColumn('locations', 'division_id');
    if (!hasDivisionId) {
      await knex.schema.alterTable('locations', (t) => {
        t.uuid('division_id').references('id').inTable('divisions').onDelete('SET NULL');
      });
    }
  }

  // user_locations
  const hasUserLocations = await knex.schema.hasTable('user_locations');
  if (!hasUserLocations) {
    await knex.schema.createTable('user_locations', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.unique(['user_id', 'location_id']);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('user_locations');
  await knex.schema.dropTableIfExists('user_roles');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('roles');
  if (await knex.schema.hasTable('locations')) {
    const hasDivisionId = await knex.schema.hasColumn('locations', 'division_id');
    if (hasDivisionId) await knex.schema.alterTable('locations', (t) => t.dropColumn('division_id'));
    const hasCode = await knex.schema.hasColumn('locations', 'code');
    if (hasCode) await knex.schema.alterTable('locations', (t) => t.dropColumn('code'));
    const hasLocationType = await knex.schema.hasColumn('locations', 'location_type');
    if (hasLocationType) await knex.schema.alterTable('locations', (t) => t.dropColumn('location_type'));
    const hasActive = await knex.schema.hasColumn('locations', 'active');
    if (hasActive) await knex.schema.alterTable('locations', (t) => t.dropColumn('active'));
  }
  await knex.schema.dropTableIfExists('divisions');
};
