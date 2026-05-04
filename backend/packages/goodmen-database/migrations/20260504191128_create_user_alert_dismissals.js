'use strict';

/**
 * FN-1165 (parent FN-1128) — Smart Alerts: per-user dismissals table.
 *
 * Backs the Postgres replacement of the in-memory MemoryDismissalsStore in
 * `backend/gateway/services/dismissals-store.js` so dismissed Smart Alerts
 * stay hidden across gateway restarts and survive horizontal scale-out.
 *
 * Schema
 *   id                UUID PK
 *   tenant_id         UUID NOT NULL  (FK → tenants.id ON DELETE CASCADE)
 *   user_id           UUID NOT NULL  (FK → users.id   ON DELETE CASCADE)
 *   alert_fingerprint TEXT NOT NULL  — stable identifier for the alert
 *                                       (the gateway aggregator's `alertId`)
 *   dismissed_at      TIMESTAMPTZ DEFAULT now()
 *   expires_at        TIMESTAMPTZ NOT NULL — usually dismissed_at + 24h
 *
 * Constraints
 *   UNIQUE (tenant_id, user_id, alert_fingerprint) — enables ON CONFLICT
 *     DO UPDATE so a re-dismiss simply refreshes the TTL.
 *
 * Indexes
 *   (user_id, expires_at) — backs the per-user lookup performed on every
 *     `GET /api/alerts/smart` (FN-1161) and the periodic prune of expired
 *     rows.
 */

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('user_alert_dismissals');
  if (hasTable) return;

  await knex.schema.createTable('user_alert_dismissals', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('tenant_id')
      .notNullable()
      .references('id')
      .inTable('tenants')
      .onDelete('CASCADE');
    table
      .uuid('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table.text('alert_fingerprint').notNullable();
    table
      .timestamp('dismissed_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp('expires_at', { useTz: true }).notNullable();

    table.unique(['tenant_id', 'user_id', 'alert_fingerprint'], {
      indexName: 'user_alert_dismissals_tenant_user_fp_uniq'
    });
  });

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_user_alert_dismissals_user_expires ' +
      'ON user_alert_dismissals (user_id, expires_at)'
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('user_alert_dismissals');
};
