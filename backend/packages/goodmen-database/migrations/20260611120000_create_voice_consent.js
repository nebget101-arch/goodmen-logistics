'use strict';

/**
 * FN-1223 — Create voice_consent table.
 *
 * Captures GDPR consent decisions from Twilio voice calls. One row per call
 * leg; append-only (never updated). The recording_id is null when the caller
 * declines or when recording is not started before consent is granted.
 *
 * caller_id / tenant_id are logical — tenant resolution happens via
 * did_mapping (same migration batch). No DB-level FK to tenants to keep the
 * voice module decoupled from the auth-users schema.
 *
 * Indexes
 *   idx_voice_consent_tenant_caller_time  (tenant_id, caller_id, created_at DESC)
 *     — supports consent history lookups per caller within a tenant
 *   idx_voice_consent_recording_id        (recording_id)
 *     — supports webhook lookups by Twilio recording SID (sparse — nullable)
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('voice_consent');
  if (hasTable) return;

  await knex.schema.createTable('voice_consent', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.text('caller_id').notNullable();
    table.uuid('tenant_id').notNullable();
    table.boolean('granted').notNullable();
    table.timestamp('granted_at', { useTz: true }).nullable();
    table.text('ip').nullable();
    table.text('recording_id').nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_voice_consent_tenant_caller_time
    ON voice_consent (tenant_id, caller_id, created_at DESC)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_voice_consent_recording_id
    ON voice_consent (recording_id)
    WHERE recording_id IS NOT NULL
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('voice_consent');
};
