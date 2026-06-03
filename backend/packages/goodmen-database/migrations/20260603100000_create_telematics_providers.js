'use strict';

/**
 * FN-1660 — Telematics ingestion foundation: telematics_providers.
 *
 * Reference/lookup table of supported telematics providers. Concrete adapters
 * (Samsara, Motive) live in goodmen-shared (FN-1661); this table lets
 * telematics_devices reference a provider by FK and lets us toggle providers
 * on/off without a code change. Seeded with samsara + motive by
 * seeds/08_telematics_providers_seed.js.
 *
 * Schema
 *   id          UUID PK
 *   code        TEXT UNIQUE NOT NULL  — stable machine key ('samsara' | 'motive')
 *   name        TEXT NOT NULL         — human label ('Samsara', 'Motive')
 *   is_active   BOOLEAN DEFAULT true  — disable a provider without deleting rows
 *   created_at  TIMESTAMPTZ DEFAULT now()
 *   updated_at  TIMESTAMPTZ DEFAULT now()
 */

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('telematics_providers');
  if (hasTable) return;

  await knex.schema.createTable('telematics_providers', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.text('code').notNullable();
    table.text('name').notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
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
    'ALTER TABLE telematics_providers ' +
      'ADD CONSTRAINT uq_telematics_providers_code UNIQUE (code)'
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('telematics_providers');
};
