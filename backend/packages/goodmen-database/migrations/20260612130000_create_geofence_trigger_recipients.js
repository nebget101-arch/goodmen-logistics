/**
 * FN-1757 — Create geofence_trigger_recipients table
 * (Story A — Geofence alert recipients + email/in-app dispatch + broker updates).
 *
 * A geofence trigger (FN-1664) with `action='notify'` fans out to one or more
 * recipients when its `event_kind` crossing fires. A recipient is exactly one
 * of three kinds — an internal `user`, an external `email` address, or a
 * `broker` (who gets a load-context email). Each recipient chooses a delivery
 * `channel` (email, in-app, or both). The dispatch engine (FN-1758) resolves
 * these rows per event and hands them to `notification-service.js`.
 *
 * Schema
 *   id             UUID PK  (auto-generated)
 *   trigger_id     UUID NOT NULL  (FK geofence_triggers.id, CASCADE — recipients belong to a trigger)
 *   recipient_type TEXT NOT NULL CHECK ('user' | 'email' | 'broker')
 *   user_id        UUID NULL      (FK users.id, CASCADE — set when recipient_type = 'user')
 *   email          TEXT NULL      (set when recipient_type = 'email')
 *   broker_id      UUID NULL      (FK brokers.id, CASCADE — set when recipient_type = 'broker')
 *   channel        TEXT NOT NULL DEFAULT 'both' CHECK ('email' | 'in_app' | 'both')
 *   created_at     TIMESTAMPTZ DEFAULT now()
 *
 * Integrity constraints
 *   chk_geofence_trigger_recipients_channel — channel is one of email|in_app|both
 *   chk_geofence_trigger_recipients_type    — recipient_type is one of user|email|broker
 *   chk_geofence_trigger_recipients_target  — exactly one of (user_id, email, broker_id)
 *                                             is set AND it is consistent with recipient_type
 *   INDEX (trigger_id)                       — recipients are always loaded per-trigger
 *
 * Conventions mirror the Phase 1 geofence migrations
 * (`20260603100100_create_geofence_triggers.js`): idempotent `hasTable` guard,
 * `uuid_generate_v4()` PKs, FKs wired only when the referenced table is present
 * in this environment (mirror of `20260603100000_create_geofences.js`),
 * `CREATE INDEX IF NOT EXISTS`, and named CHECK constraints.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('geofence_trigger_recipients');
  if (hasTable) return;

  const hasUsers = await knex.schema.hasTable('users');
  const hasBrokers = await knex.schema.hasTable('brokers');

  await knex.schema.createTable('geofence_trigger_recipients', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('trigger_id')
      .notNullable()
      .references('id')
      .inTable('geofence_triggers')
      .onDelete('CASCADE');
    table.text('recipient_type').notNullable();

    const userId = table.uuid('user_id').nullable();
    // Only wire the FK when the referenced table is present in this environment.
    if (hasUsers) {
      userId.references('id').inTable('users').onDelete('CASCADE');
    }

    table.text('email').nullable();

    const brokerId = table.uuid('broker_id').nullable();
    if (hasBrokers) {
      brokerId.references('id').inTable('brokers').onDelete('CASCADE');
    }

    table.text('channel').notNullable().defaultTo('both');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE geofence_trigger_recipients
    ADD CONSTRAINT chk_geofence_trigger_recipients_type
    CHECK (recipient_type IN ('user', 'email', 'broker'))
  `);

  await knex.raw(`
    ALTER TABLE geofence_trigger_recipients
    ADD CONSTRAINT chk_geofence_trigger_recipients_channel
    CHECK (channel IN ('email', 'in_app', 'both'))
  `);

  // Exactly one of (user_id, email, broker_id) is set, and the populated column
  // matches the declared recipient_type. This is the integrity net for the
  // dispatch resolver — a 'user' row must carry only user_id, etc.
  await knex.raw(`
    ALTER TABLE geofence_trigger_recipients
    ADD CONSTRAINT chk_geofence_trigger_recipients_target
    CHECK (
      (recipient_type = 'user'   AND user_id   IS NOT NULL AND email IS NULL AND broker_id IS NULL) OR
      (recipient_type = 'email'  AND email     IS NOT NULL AND user_id IS NULL AND broker_id IS NULL) OR
      (recipient_type = 'broker' AND broker_id IS NOT NULL AND user_id IS NULL AND email IS NULL)
    )
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_geofence_trigger_recipients_trigger_id
    ON geofence_trigger_recipients (trigger_id)
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('geofence_trigger_recipients');
};
