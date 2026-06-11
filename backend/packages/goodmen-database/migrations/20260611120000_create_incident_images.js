'use strict';

/**
 * FN-1232 — Create incident_images table.
 *
 * Persists image metadata after successful R2 upload. The actual bytes live in
 * R2 (never in Postgres). Each row represents one uploaded file attached to a
 * roadside incident. Signed GET URLs are generated on demand by the backend
 * service (FN-1231) and never stored here.
 *
 * incident_id / tenant_id are logical foreign keys — the incidents table lives
 * in a separate microservice (roadside_calls), so no DB-level FK is applied.
 * uploaded_by is a logical FK to users; same reasoning — no DB-level FK.
 *
 * Schema
 *   id                 UUID PK  (auto-generated)
 *   incident_id        UUID NOT NULL   — roadside_calls.id (logical)
 *   tenant_id          UUID NOT NULL   — tenant isolation
 *   s3_key             TEXT NOT NULL   — R2 object key
 *   mime_type          TEXT NOT NULL   — e.g. image/jpeg, image/png, image/heic
 *   size_bytes         BIGINT NOT NULL — file size in bytes (≤ 10 MB enforced by service)
 *   original_file_name TEXT NULL       — client-supplied filename, sanitised by service
 *   uploaded_by        UUID NULL       — user who uploaded; null for system uploads
 *   uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
 *
 * Indexes
 *   idx_incident_images_tenant_incident  (tenant_id, incident_id)
 *     — primary access pattern: list all images for an incident within a tenant
 *   idx_incident_images_incident_id      (incident_id)
 *     — fallback for incident-only queries (admin / global lookups)
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('incident_images');
  if (hasTable) return;

  await knex.schema.createTable('incident_images', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('incident_id').notNullable();
    table.uuid('tenant_id').notNullable();
    table.text('s3_key').notNullable();
    table.text('mime_type').notNullable();
    table.bigInteger('size_bytes').notNullable();
    table.text('original_file_name').nullable();
    table.uuid('uploaded_by').nullable();
    table
      .timestamp('uploaded_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_incident_images_tenant_incident
    ON incident_images (tenant_id, incident_id)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_incident_images_incident_id
    ON incident_images (incident_id)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('incident_images');
};
