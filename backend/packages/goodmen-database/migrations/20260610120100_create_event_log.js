'use strict';

/**
 * FN-1241 — Create event_log table for idempotent incident event delivery.
 *
 * Backs the deduplication logic in `incident-event-publisher` (FN-1240).
 * Each published `incident.state_changed` event is recorded here keyed by
 * (aggregate_id, event_type, state, version). Re-delivery of the same triplet
 * is detected by the publisher's pre-insert SELECT; the INSERT itself uses
 * ON CONFLICT DO NOTHING against the unique expression index.
 *
 * The table is designed as a generic append-only event ledger: aggregate_type
 * and event_type allow future event kinds to share the same table without
 * schema changes.
 *
 * Schema
 *   id             UUID PK
 *   aggregate_id   UUID NOT NULL  (the incident_id)
 *   aggregate_type TEXT NOT NULL  (e.g. 'incident')
 *   event_type     TEXT NOT NULL  (e.g. 'incident.state_changed')
 *   tenant_id      UUID NOT NULL
 *   payload        JSONB NOT NULL DEFAULT '{}'  (contains state, version)
 *   published_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *
 * Indexes
 *   UNIQUE expression index on (aggregate_id, event_type, state, version)
 *     — enables ON CONFLICT DO NOTHING for idempotent INSERT
 *   INDEX (aggregate_id)  — fast lookup in the publisher's duplicate check
 *   INDEX (tenant_id)     — tenant-scoped queries
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('event_log');
  if (hasTable) return;

  await knex.schema.createTable('event_log', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('aggregate_id').notNullable();
    table.text('aggregate_type').notNullable();
    table.text('event_type').notNullable();
    table.uuid('tenant_id').notNullable();
    table.jsonb('payload').notNullable().defaultTo('{}');
    table
      .timestamp('published_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // Unique expression index for idempotent INSERT ... ON CONFLICT DO NOTHING.
  // Keyed by (aggregate_id, event_type, state from payload, version from payload).
  await knex.raw(`
    CREATE UNIQUE INDEX uq_event_log_aggregate_state_version
    ON event_log (aggregate_id, event_type, (payload->>'state'), ((payload->>'version')::int))
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_event_log_aggregate_id
    ON event_log (aggregate_id)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_event_log_tenant_id
    ON event_log (tenant_id)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('event_log');
};
