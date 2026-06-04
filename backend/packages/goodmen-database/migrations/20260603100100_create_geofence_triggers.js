/**
 * FN-1664 — Create geofence_triggers table (Story B — Geofence schema + CRUD).
 *
 * A geofence can have one or more triggers. A trigger fires an `action` when a
 * vehicle produces an `event_kind` (enter / exit / dwell) for the parent
 * geofence. A trigger may be scoped to a single vehicle (`vehicle_id`) or apply
 * to every vehicle in the tenant when `vehicle_id` is NULL.
 *
 * Schema
 *   id             UUID PK  (auto-generated)
 *   geofence_id    UUID NOT NULL  (FK geofences.id, CASCADE — triggers belong to a geofence)
 *   vehicle_id     UUID NULL      (FK vehicles.id, CASCADE — NULL = applies to all vehicles)
 *   event_kind     TEXT NOT NULL CHECK ('enter' | 'exit' | 'dwell')
 *   dwell_minutes  INTEGER NULL   (required when event_kind = 'dwell')
 *   action         TEXT NOT NULL CHECK ('notify' | 'update_load_status' | 'webhook')
 *   target_url     TEXT NULL      (required when action = 'webhook')
 *   created_at     TIMESTAMPTZ DEFAULT now()
 *   updated_at     TIMESTAMPTZ DEFAULT now()
 *
 * Integrity constraints
 *   chk_geofence_triggers_dwell   — dwell triggers must carry dwell_minutes (> 0)
 *   chk_geofence_triggers_webhook — webhook actions must carry a target_url
 *   INDEX (geofence_id)           — triggers are always loaded per-geofence
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('geofence_triggers');
  if (hasTable) return;

  await knex.schema.createTable('geofence_triggers', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('geofence_id')
      .notNullable()
      .references('id')
      .inTable('geofences')
      .onDelete('CASCADE');
    table
      .uuid('vehicle_id')
      .nullable()
      .references('id')
      .inTable('vehicles')
      .onDelete('CASCADE');
    table.text('event_kind').notNullable();
    table.integer('dwell_minutes').nullable();
    table.text('action').notNullable();
    table.text('target_url').nullable();
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
    ALTER TABLE geofence_triggers
    ADD CONSTRAINT chk_geofence_triggers_event_kind
    CHECK (event_kind IN ('enter', 'exit', 'dwell'))
  `);

  await knex.raw(`
    ALTER TABLE geofence_triggers
    ADD CONSTRAINT chk_geofence_triggers_action
    CHECK (action IN ('notify', 'update_load_status', 'webhook'))
  `);

  // A dwell event is meaningless without a dwell duration.
  await knex.raw(`
    ALTER TABLE geofence_triggers
    ADD CONSTRAINT chk_geofence_triggers_dwell
    CHECK (event_kind <> 'dwell' OR (dwell_minutes IS NOT NULL AND dwell_minutes > 0))
  `);

  // A webhook action must know where to POST.
  await knex.raw(`
    ALTER TABLE geofence_triggers
    ADD CONSTRAINT chk_geofence_triggers_webhook
    CHECK (action <> 'webhook' OR target_url IS NOT NULL)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_geofence_triggers_geofence_id
    ON geofence_triggers (geofence_id)
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('geofence_triggers');
};
