'use strict';

/**
 * FN-1223 — Create did_mapping table.
 *
 * Maps a DID (Direct Inward Dial) phone number to a tenant. Used by the
 * Twilio voice bridge to resolve which tenant owns an inbound call before
 * routing and consent capture. Unmapped DIDs are rejected at the webhook.
 *
 * did is globally unique — one DID cannot belong to multiple tenants.
 *
 * Indexes
 *   unique constraint on did   — enforced at DB level; fast lookup by DID
 *   idx_did_mapping_tenant_id  (tenant_id)
 *     — supports listing all DIDs for a given tenant (admin use)
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('did_mapping');
  if (hasTable) return;

  await knex.schema.createTable('did_mapping', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.text('did').notNullable().unique();
    table.uuid('tenant_id').notNullable();
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
    CREATE INDEX IF NOT EXISTS idx_did_mapping_tenant_id
    ON did_mapping (tenant_id)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('did_mapping');
};
