'use strict';

// FN-1707 — Create user_sessions table for single-active-session enforcement.
// Each row is one active or revoked session; session_token_hash stores the
// SHA-256 of the JWT secret so the raw token is never persisted (mirrors
// password_reset_tokens). revoked_at / revoked_reason support takeover flow.

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  const hasTable = await knex.schema.hasTable('user_sessions');
  if (hasTable) return;

  await knex.schema.createTable('user_sessions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table
      .uuid('tenant_id')
      .nullable()
      .references('id')
      .inTable('tenants')
      .onDelete('SET NULL');
    table.string('session_token_hash', 128).notNullable().unique();
    table.string('user_agent', 512).nullable();
    table.string('ip_address', 45).nullable();
    table.string('device_label', 255).nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_seen_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('revoked_at').nullable();
    table.string('revoked_reason', 100).nullable();
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_revoked
    ON user_sessions (user_id, revoked_at)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_tenant_id
    ON user_sessions (tenant_id)
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_user_sessions_tenant_id');
  await knex.raw('DROP INDEX IF EXISTS idx_user_sessions_user_revoked');
  await knex.schema.dropTableIfExists('user_sessions');
};
