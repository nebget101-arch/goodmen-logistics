/**
 * FN-1664 — Create geofences table (Story B — Geofence schema + CRUD).
 *
 * Stores dispatcher-defined geofences (circle + polygon) per tenant. Each
 * geofence carries a GeoJSON geometry plus an optional link to a location
 * (address) it was derived from.
 *
 * Geometry storage decision (documented in docs/stories/FN-1654.md):
 *   Prod Postgres does NOT have the PostGIS extension enabled — the only
 *   extensions in use across the migration history are `uuid-ossp` and
 *   `pgcrypto`. Rather than introduce a heavyweight, deploy-coupled
 *   extension, geometry is stored as GeoJSON in a `jsonb` column and
 *   point-in-polygon / point-in-circle tests are performed app-side
 *   (Story C / FN-1655). This keeps the schema portable across every
 *   environment (local, dev, prod) with no extension prerequisite.
 *
 *   Shape of the `geometry` jsonb:
 *     circle  → { "type": "Circle",  "center": [lng, lat], "radius_m": <number> }
 *     polygon → { "type": "Polygon", "coordinates": [[[lng, lat], ...]] }   (GeoJSON)
 *   `[lng, lat]` order matches the GeoJSON spec (x=lng, y=lat).
 *
 * Schema
 *   id          UUID PK  (auto-generated)
 *   tenant_id   UUID NOT NULL
 *   name        TEXT NOT NULL
 *   kind        TEXT NOT NULL CHECK ('circle' | 'polygon')
 *   geometry    JSONB NOT NULL  (GeoJSON, see above)
 *   address_id  UUID NULL  (FK locations.id, SET NULL — geofence derived from a saved address)
 *   is_active   BOOLEAN NOT NULL DEFAULT true  (supports the `active` CRUD filter)
 *   created_by  UUID NOT NULL  (FK users.id, RESTRICT)
 *   created_at  TIMESTAMPTZ DEFAULT now()
 *   updated_at  TIMESTAMPTZ DEFAULT now()
 *
 * Constraints / indexes
 *   UNIQUE (tenant_id, name)        — geofence names are unique within a tenant
 *   INDEX  (tenant_id, is_active)   — list/scope queries are tenant-scoped and filter on active
 *   INDEX  (created_by)             — supports the `owned-by` CRUD filter
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('geofences');
  if (hasTable) return;

  const hasLocations = await knex.schema.hasTable('locations');

  await knex.schema.createTable('geofences', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('tenant_id').notNullable();
    table.text('name').notNullable();
    table.text('kind').notNullable();
    table.jsonb('geometry').notNullable();

    const addressId = table.uuid('address_id').nullable();
    // Only wire the FK when the referenced table is present in this environment.
    if (hasLocations) {
      addressId.references('id').inTable('locations').onDelete('SET NULL');
    }

    table.boolean('is_active').notNullable().defaultTo(true);
    table
      .uuid('created_by')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE geofences
    ADD CONSTRAINT chk_geofences_kind
    CHECK (kind IN ('circle', 'polygon'))
  `);

  await knex.raw(`
    ALTER TABLE geofences
    ADD CONSTRAINT uq_geofences_tenant_name
    UNIQUE (tenant_id, name)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_geofences_tenant_active
    ON geofences (tenant_id, is_active)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_geofences_created_by
    ON geofences (created_by)
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('geofences');
};
