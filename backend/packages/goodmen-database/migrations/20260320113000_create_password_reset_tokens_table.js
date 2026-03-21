'use strict';

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  const hasTable = await knex.schema.hasTable('password_reset_tokens');
  if (hasTable) return;

  await knex.schema.createTable('password_reset_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('token_hash', 128).notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.timestamp('used_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at)');
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_password_reset_tokens_expires_at');
  await knex.raw('DROP INDEX IF EXISTS idx_password_reset_tokens_user_id');
  await knex.schema.dropTableIfExists('password_reset_tokens');
};
