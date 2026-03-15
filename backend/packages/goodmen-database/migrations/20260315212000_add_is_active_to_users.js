'use strict';

/**
 * Add soft-activation column for users so admins can inactivate accounts.
 */

exports.up = async function up(knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) return;

  const hasIsActive = await knex.schema.hasColumn('users', 'is_active');
  if (!hasIsActive) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('is_active').notNullable().defaultTo(true);
    });
  }

  await knex.raw('UPDATE users SET is_active = true WHERE is_active IS NULL');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active)');
};

exports.down = async function down(knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) return;

  const hasIsActive = await knex.schema.hasColumn('users', 'is_active');
  if (!hasIsActive) return;

  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('is_active');
  });
};
