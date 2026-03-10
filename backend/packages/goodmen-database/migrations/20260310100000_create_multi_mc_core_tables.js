'use strict';

/**
 * Multi-MC foundation (Phase 2)
 *
 * Creates the additive top-level context tables required for future
 * tenant/company and operating entity / MC support.
 *
 * Intentionally deferred to later phases:
 * - driver_operating_entity_assignments (effective-dated)
 * - vehicle_operating_entity_assignments (effective-dated)
 * - request middleware enforcing active operating entity
 * - NOT NULL tightening on new foreign keys added to existing tables
 */

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  if (!(await knex.schema.hasTable('tenants'))) {
    await knex.schema.createTable('tenants', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.text('name').notNullable();
      table.text('legal_name').nullable();
      table.text('status').notNullable().defaultTo('active');
      table.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status)');
  }

  if (!(await knex.schema.hasTable('operating_entities'))) {
    await knex.schema.createTable('operating_entities', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('RESTRICT');
      table.text('entity_type').notNullable().defaultTo('carrier');
      table.text('name').notNullable();
      table.text('legal_name').nullable();
      table.text('dba_name').nullable();
      table.text('mc_number').nullable();
      table.text('dot_number').nullable();
      table.text('ein').nullable();
      table.text('phone').nullable();
      table.text('email').nullable();
      table.text('address_line1').nullable();
      table.text('address_line2').nullable();
      table.text('city').nullable();
      table.text('state').nullable();
      table.text('zip_code').nullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.text('default_currency').nullable().defaultTo('USD');
      table.jsonb('settings_json').nullable().defaultTo(knex.raw("'{}'::jsonb"));
      table.timestamps(true, true);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_operating_entities_tenant ON operating_entities(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_operating_entities_tenant_active ON operating_entities(tenant_id, is_active)');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_operating_entities_mc_not_null ON operating_entities(mc_number) WHERE mc_number IS NOT NULL');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_operating_entities_dot_not_null ON operating_entities(dot_number) WHERE dot_number IS NOT NULL');
  }

  if (!(await knex.schema.hasTable('user_tenant_memberships'))) {
    await knex.schema.createTable('user_tenant_memberships', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.text('membership_role').nullable();
      table.boolean('is_default').notNullable().defaultTo(false);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamps(true, true);
      table.unique(['user_id', 'tenant_id']);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_user_tenant_memberships_user ON user_tenant_memberships(user_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_user_tenant_memberships_tenant ON user_tenant_memberships(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_user_tenant_memberships_user_tenant ON user_tenant_memberships(user_id, tenant_id)');
  }

  if (!(await knex.schema.hasTable('user_operating_entities'))) {
    await knex.schema.createTable('user_operating_entities', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.uuid('operating_entity_id').notNullable().references('id').inTable('operating_entities').onDelete('CASCADE');
      table.text('access_level').nullable();
      table.boolean('is_default').notNullable().defaultTo(false);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamps(true, true);
      table.unique(['user_id', 'operating_entity_id']);
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_user_operating_entities_user ON user_operating_entities(user_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_user_operating_entities_entity ON user_operating_entities(operating_entity_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_user_operating_entities_user_entity ON user_operating_entities(user_id, operating_entity_id)');
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('user_operating_entities');
  await knex.schema.dropTableIfExists('user_tenant_memberships');
  await knex.schema.dropTableIfExists('operating_entities');
  await knex.schema.dropTableIfExists('tenants');
};
