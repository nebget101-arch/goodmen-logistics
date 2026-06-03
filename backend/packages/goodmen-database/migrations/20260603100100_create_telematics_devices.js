'use strict';

/**
 * FN-1660 — Telematics ingestion foundation: telematics_devices.
 *
 * One row per physical telematics unit paired to a vehicle. The backend
 * resolves an inbound webhook/poll (provider + external_device_id) to a
 * vehicle via this table, then writes normalized rows to
 * vehicle_position_pings. `last_seen_at` drives the polling-fallback cron
 * (FN-1661): pull last position when no webhook has arrived in N minutes.
 *
 * Schema
 *   id                 UUID PK
 *   vehicle_id         UUID NOT NULL  FK → vehicles.id (ON DELETE CASCADE)
 *   provider_id        UUID NOT NULL  FK → telematics_providers.id (ON DELETE RESTRICT)
 *   external_device_id TEXT NOT NULL  — provider's device identifier
 *   serial             TEXT           — hardware serial (nullable)
 *   paired_at          TIMESTAMPTZ    — when the device was linked to the vehicle
 *   last_seen_at       TIMESTAMPTZ    — last ping received (webhook or poll)
 *   created_at         TIMESTAMPTZ DEFAULT now()
 *   updated_at         TIMESTAMPTZ DEFAULT now()
 *
 * Constraints / indexes
 *   UNIQUE (provider_id, external_device_id) — a device id is unique per provider
 *   INDEX  (vehicle_id)                       — look up devices for a vehicle
 *   INDEX  (last_seen_at)                     — polling-fallback "stale device" scan
 */

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('telematics_devices');
  if (hasTable) return;

  await knex.schema.createTable('telematics_devices', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('vehicle_id')
      .notNullable()
      .references('id')
      .inTable('vehicles')
      .onDelete('CASCADE');
    table
      .uuid('provider_id')
      .notNullable()
      .references('id')
      .inTable('telematics_providers')
      .onDelete('RESTRICT');
    table.text('external_device_id').notNullable();
    table.text('serial').nullable();
    table.timestamp('paired_at', { useTz: true }).nullable();
    table.timestamp('last_seen_at', { useTz: true }).nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(
    'ALTER TABLE telematics_devices ' +
      'ADD CONSTRAINT uq_telematics_devices_provider_external ' +
      'UNIQUE (provider_id, external_device_id)'
  );

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_telematics_devices_vehicle_id ' +
      'ON telematics_devices (vehicle_id)'
  );

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_telematics_devices_last_seen_at ' +
      'ON telematics_devices (last_seen_at)'
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('telematics_devices');
};
