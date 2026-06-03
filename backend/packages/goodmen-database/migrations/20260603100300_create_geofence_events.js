'use strict';

/**
 * FN-1668 — Create geofence_events table (Story C — FN-1655:
 * geofence event computation + load-status automation).
 *
 * A Bull worker (FN-1669) reads new vehicle_position_pings, runs app-side
 * point-in-geofence tests (geometry is GeoJSON in geofences.geometry — prod
 * has no PostGIS, see FN-1664), and writes one row here per detected crossing.
 * Those rows then drive load-status automation
 * (pickup enter→arrived, exit→in transit, delivery enter→arrived,
 *  delivery exit >5min→delivered) plus dwell detection.
 *
 * Schema
 *   id          UUID PK  (auto-generated)
 *   geofence_id UUID NOT NULL  — FK geofences.id, CASCADE (event log is
 *                               meaningless once its geofence is gone; geofences
 *                               are soft-disabled via is_active, hard deletes are rare)
 *   vehicle_id  UUID NOT NULL  — NO hard FK, by design (see note below)
 *   event_kind  TEXT NOT NULL CHECK ('enter' | 'exit' | 'dwell')
 *   ts          TIMESTAMPTZ NOT NULL  — crossing time (= the triggering ping's ts)
 *   ping_id     UUID NOT NULL  — the vehicle_position_pings row that triggered
 *                               this event. SOFT reference, NO hard FK (see note)
 *   load_id     UUID NULL  — FK loads.id, SET NULL — the load whose status this
 *                            event drove (NULL when the crossing maps to no load)
 *   created_at  TIMESTAMPTZ DEFAULT now()
 *
 * ── Why vehicle_id and ping_id have no hard FK ─────────────────────────────
 *   • vehicle_id: mirrors the write-optimized ingest pattern of
 *     vehicle_position_pings (FN-1660), which also stores vehicle_id without a
 *     FK. The value is copied straight off the triggering ping.
 *   • ping_id: vehicle_position_pings is RANGE-partitioned by ts with a
 *     COMPOSITE primary key (id, ts) — a foreign key would have to reference
 *     the full (id, ts) pair, not id alone, and PG forbids a FK to just part of
 *     a partitioned table's key. Storing ping_id as a plain UUID keeps the
 *     event→ping linkage without coupling this table to the partition key.
 *
 * Constraints / indexes
 *   UNIQUE (ping_id, geofence_id, event_kind)
 *     — idempotency net: the Bull worker (FN-1669) can retry/reprocess a ping,
 *       so re-emitting the same crossing must be a no-op. One enter/exit/dwell
 *       per (ping, geofence).
 *   INDEX (vehicle_id, ts DESC)   — worker lookup: latest events for a vehicle
 *   INDEX (geofence_id, ts DESC)  — worker lookup: events per geofence
 *   INDEX (load_id) WHERE load_id IS NOT NULL
 *                                 — load-status automation reads events by load
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const TABLE = 'geofence_events';

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable(TABLE);
  if (hasTable) return;

  const hasLoads = await knex.schema.hasTable('loads');

  await knex.schema.createTable(TABLE, (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));

    table
      .uuid('geofence_id')
      .notNullable()
      .references('id')
      .inTable('geofences')
      .onDelete('CASCADE');

    // No hard FK — value copied from the triggering ping (see header note).
    table.uuid('vehicle_id').notNullable();

    table.text('event_kind').notNullable();

    table.timestamp('ts', { useTz: true }).notNullable();

    // Soft reference to vehicle_position_pings.id — no hard FK because that
    // table is partitioned with a composite PK (id, ts) (see header note).
    table.uuid('ping_id').notNullable();

    const loadId = table.uuid('load_id').nullable();
    // Only wire the FK when the referenced table is present in this environment.
    if (hasLoads) {
      loadId.references('id').inTable('loads').onDelete('SET NULL');
    }

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE ${TABLE}
    ADD CONSTRAINT chk_geofence_events_event_kind
    CHECK (event_kind IN ('enter', 'exit', 'dwell'))
  `);

  // Idempotency net for the Bull worker — one event per (ping, geofence, kind).
  await knex.raw(`
    ALTER TABLE ${TABLE}
    ADD CONSTRAINT uq_geofence_events_ping_geofence_kind
    UNIQUE (ping_id, geofence_id, event_kind)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_geofence_events_vehicle_ts
    ON ${TABLE} (vehicle_id, ts DESC)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_geofence_events_geofence_ts
    ON ${TABLE} (geofence_id, ts DESC)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_geofence_events_load
    ON ${TABLE} (load_id)
    WHERE load_id IS NOT NULL
  `);

  await knex.raw(`COMMENT ON TABLE ${TABLE} IS
    'FN-1668: geofence crossing events computed by the FN-1669 Bull worker from vehicle_position_pings; drives load-status automation and dwell detection.'`);
  await knex.raw(`COMMENT ON COLUMN ${TABLE}.vehicle_id IS
    'vehicles.id — intentionally no FK (copied from the triggering ping; mirrors vehicle_position_pings)'`);
  await knex.raw(`COMMENT ON COLUMN ${TABLE}.ping_id IS
    'vehicle_position_pings.id — soft reference, no FK (pings is partitioned with composite PK (id, ts))'`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};
