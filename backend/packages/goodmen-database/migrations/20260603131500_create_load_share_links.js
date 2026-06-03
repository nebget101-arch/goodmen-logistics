'use strict';

/**
 * FN-1674 (Story E — Share-link generation) — Create load_share_links table.
 *
 * Backs the per-load public tracking links brokers generate, manage
 * (expiry/revocation), and audit (view counts). The raw token is shown to the
 * broker once and never stored; only its SHA-256 hash lives here, so token
 * lookups on the public page are an indexed O(1) hash match.
 *
 * Schema
 *   id              UUID PK
 *   load_id         UUID NOT NULL  (FK loads.id, CASCADE — links die with the load)
 *   token_hash      TEXT NOT NULL  (SHA-256 of the 32-byte base64url token; UNIQUE)
 *   created_by      UUID NOT NULL  (FK users.id, RESTRICT)
 *   created_at      TIMESTAMPTZ DEFAULT now()
 *   expires_at      TIMESTAMPTZ NULL  (default 7 days post-delivery, set by API)
 *   revoked_at      TIMESTAMPTZ NULL  (set on manual revoke)
 *   view_count      INTEGER NOT NULL DEFAULT 0
 *   last_viewed_at  TIMESTAMPTZ NULL
 *   reveal_options  JSONB NOT NULL DEFAULT '{}'  (driver/vehicle/breadcrumbs/route toggles)
 *
 * Indexes
 *   UNIQUE (token_hash)  — O(1) public-page lookup
 *   INDEX  (load_id)     — list/manage links for a given load
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('load_share_links');
  if (hasTable) return;

  await knex.schema.createTable('load_share_links', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('load_id')
      .notNullable()
      .references('id')
      .inTable('loads')
      .onDelete('CASCADE');
    table.text('token_hash').notNullable();
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
    table.timestamp('expires_at', { useTz: true }).nullable();
    table.timestamp('revoked_at', { useTz: true }).nullable();
    table.integer('view_count').notNullable().defaultTo(0);
    table.timestamp('last_viewed_at', { useTz: true }).nullable();
    table.jsonb('reveal_options').notNullable().defaultTo('{}');
  });

  await knex.raw(`
    ALTER TABLE load_share_links
    ADD CONSTRAINT uq_load_share_links_token_hash
    UNIQUE (token_hash)
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_load_share_links_load_id
    ON load_share_links (load_id)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('load_share_links');
};
