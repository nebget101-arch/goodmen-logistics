'use strict';

/**
 * FN-1254 — vendor_positions table for roadside GPS heartbeat ingestion.
 *
 * Stores live vendor GPS pings written by the heartbeat endpoint
 * (vendor-position.service.js, FN-1253). The Jira spec requested PostGIS
 * GEOGRAPHY + GIST spatial index, but production Postgres does NOT have the
 * PostGIS extension (confirmed in FN-1250 migration notes and FN-1253 backend
 * implementation). Spatial queries are handled in JS via Haversine, consistent
 * with the pattern established by FN-1250 for roadside_vendors.base_location.
 *
 * Schema
 *   id           UUID PK
 *   vendor_id    UUID NOT NULL — references roadside_vendors.vendor_id (no hard FK;
 *                                write-optimised ingest path, integrity upheld by
 *                                application layer)
 *   tenant_id    UUID NULL     — NULL = marketplace vendor (cross-tenant)
 *   lat          DECIMAL(10,7) NOT NULL  CHECK -90..90
 *   lng          DECIMAL(11,7) NOT NULL  CHECK -180..180
 *   recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
 *
 * Indexes
 *   idx_vendor_positions_vendor_recorded_at  (vendor_id, recorded_at DESC)
 *     — throttle check in vendor-position.service.js (last ping per vendor)
 *     — matching service fresh-position query (vendor_id IN (...), recorded_at >= cutoff)
 *   idx_vendor_positions_fresh               PARTIAL on (recorded_at DESC, vendor_id)
 *     WHERE recorded_at > now() - interval '1 hour'
 *     — filtered index on the "fresh" window used by the matching service
 *       (FRESH_THRESHOLD_MS = 5 min; 1 h window gives generous headroom)
 *   idx_vendor_positions_tenant_recorded_at  (tenant_id, recorded_at DESC)
 *     — tenant-scoped queries
 */

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('vendor_positions');
  if (hasTable) return;

  await knex.schema.createTable('vendor_positions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('vendor_id').notNullable();
    table.uuid('tenant_id').nullable();
    table.decimal('lat', 10, 7).notNullable();
    table.decimal('lng', 11, 7).notNullable();
    table
      .timestamp('recorded_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE vendor_positions
    ADD CONSTRAINT chk_vendor_positions_lat CHECK (lat BETWEEN -90 AND 90)
  `);

  await knex.raw(`
    ALTER TABLE vendor_positions
    ADD CONSTRAINT chk_vendor_positions_lng CHECK (lng BETWEEN -180 AND 180)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_vendor_positions_vendor_recorded_at
    ON vendor_positions (vendor_id, recorded_at DESC)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_vendor_positions_fresh
    ON vendor_positions (recorded_at DESC, vendor_id)
    WHERE recorded_at > now() - interval '1 hour'
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_vendor_positions_tenant_recorded_at
    ON vendor_positions (tenant_id, recorded_at DESC)
  `);

  await knex.raw(`
    COMMENT ON TABLE vendor_positions IS
    'FN-1254: live vendor GPS heartbeat store for roadside matching (FN-1202 Story 5.2). No PostGIS — lat/lng DECIMAL; spatial queries via Haversine in JS (see vendor-matching.service.js).'
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('vendor_positions');
};
