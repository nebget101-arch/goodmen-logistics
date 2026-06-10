'use strict';

/**
 * FN-1241 — Create sms_optin table for roadside SMS notification opt-in.
 *
 * Stores per-recipient SMS consent for incident state-change notifications
 * (FN-1198). The `incident-sms-notify` service (FN-1240) checks for an
 * active opt-in row before sending; it falls back to allowing delivery if
 * this table doesn't exist, so this migration can land independently.
 *
 * Schema
 *   id           UUID PK
 *   tenant_id    UUID NOT NULL  (scopes opt-ins by tenant)
 *   phone_e164   TEXT NOT NULL  (normalized E.164 phone number)
 *   channel_pref TEXT NOT NULL DEFAULT 'sms'  (notification channel preference)
 *   opted_in_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   opted_out_at TIMESTAMPTZ NULL  (NULL = still opted in)
 *
 * Indexes
 *   UNIQUE (tenant_id, phone_e164)  — O(1) opt-in check by the notify service
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('sms_optin');
  if (hasTable) return;

  await knex.schema.createTable('sms_optin', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id').notNullable();
    table.text('phone_e164').notNullable();
    table.text('channel_pref').notNullable().defaultTo('sms');
    table
      .timestamp('opted_in_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp('opted_out_at', { useTz: true }).nullable();
  });

  await knex.raw(`
    ALTER TABLE sms_optin
    ADD CONSTRAINT uq_sms_optin_tenant_phone
    UNIQUE (tenant_id, phone_e164)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('sms_optin');
};
