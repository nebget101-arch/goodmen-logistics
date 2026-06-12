'use strict';

/**
 * FN-1249 / FN-1250 — Roadside v2 vendor network: vendors table.
 *
 * The Jira spec calls for PostGIS `base_location (point)`, but the production
 * Postgres instance does NOT have the PostGIS extension (confirmed in the
 * geofences migration FN-1664 — only uuid-ossp and pgcrypto are present).
 * `base_location` is therefore stored as JSONB with shape { lat, lng } and
 * validated at the application layer, consistent with the geofences approach.
 * The column can be promoted to PostGIS geography(Point) later if/when the
 * extension is enabled.
 *
 * Schema
 *   vendor_id      UUID PK
 *   tenant_id      UUID NULL  — NULL = marketplace vendor (cross-tenant visible)
 *   name           TEXT NOT NULL
 *   skills         JSONB NOT NULL DEFAULT '[]'
 *   capacity       INTEGER NOT NULL DEFAULT 0
 *   base_location  JSONB NULL  — { lat: number, lng: number }
 *   status         TEXT NOT NULL CHECK ('active' | 'suspended') DEFAULT 'active'
 *   created_at     TIMESTAMPTZ DEFAULT now()
 *   updated_at     TIMESTAMPTZ DEFAULT now()
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('roadside_vendors');
  if (hasTable) return;

  await knex.schema.createTable('roadside_vendors', (table) => {
    table.uuid('vendor_id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id').nullable();
    table.text('name').notNullable();
    table.jsonb('skills').notNullable().defaultTo('[]');
    table.integer('capacity').notNullable().defaultTo(0);
    table.jsonb('base_location').nullable();
    table.text('status').notNullable().defaultTo('active');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE roadside_vendors
    ADD CONSTRAINT chk_roadside_vendors_status
    CHECK (status IN ('active', 'suspended'))
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_roadside_vendors_tenant_status
    ON roadside_vendors (tenant_id, status)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_roadside_vendors_marketplace
    ON roadside_vendors (status)
    WHERE tenant_id IS NULL
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('roadside_vendors');
};
