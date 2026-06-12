'use strict';

/**
 * FN-1218 — Create incident_triage audit table + indexes.
 *
 * Persists one row per triage call (append-only audit trail — never update in
 * place, even for the same incident). Consumed by the drivers-compliance
 * triage service (FN-1217).
 *
 * incident_id / tenant_id are logical foreign keys — the incidents table lives
 * in a separate microservice, so no DB-level FK constraint is applied.
 *
 * Indexes
 *   idx_incident_triage_tenant_incident_time  (tenant_id, incident_id, created_at DESC)
 *     — O(log n) for getLatestTriage(incidentId, tenantId), which is the hot path
 *   idx_incident_triage_incident_id           (incident_id)
 *     — supports incident-level queries without leading tenant_id
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('incident_triage');
  if (hasTable) return;

  await knex.schema.createTable('incident_triage', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('incident_id').notNullable();
    table.uuid('tenant_id').notNullable();
    table.text('severity').nullable();
    table.text('category').nullable();
    table.text('urgency').nullable();
    table.jsonb('vendor_skills').nullable();
    table.text('rationale').nullable();
    table.text('prompt_version').nullable();
    table.text('model_name').nullable();
    table.integer('latency_ms').notNullable().defaultTo(0);
    table.integer('cache_read_tokens').notNullable().defaultTo(0);
    table.integer('cache_creation_tokens').notNullable().defaultTo(0);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_incident_triage_tenant_incident_time
    ON incident_triage (tenant_id, incident_id, created_at DESC)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_incident_triage_incident_id
    ON incident_triage (incident_id)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('incident_triage');
};
