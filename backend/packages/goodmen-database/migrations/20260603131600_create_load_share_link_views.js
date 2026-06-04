'use strict';

/**
 * FN-1674 (Story E — Share-link generation) — Create load_share_link_views table.
 *
 * One row per public-page view of a share link. Powers the broker-facing
 * "viewed N times" audit. IP and user-agent are stored hashed only — we record
 * enough to distinguish/aggregate viewers without retaining PII in the clear.
 *
 * Schema
 *   id               UUID PK
 *   share_link_id    UUID NOT NULL  (FK load_share_links.id, CASCADE)
 *   viewed_at        TIMESTAMPTZ DEFAULT now()
 *   ip_hash          TEXT NULL  (SHA-256 of viewer IP)
 *   user_agent_hash  TEXT NULL  (SHA-256 of viewer user-agent)
 *
 * Indexes
 *   INDEX (share_link_id, viewed_at DESC) — list a link's views newest-first
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasTable = await knex.schema.hasTable('load_share_link_views');
  if (hasTable) return;

  await knex.schema.createTable('load_share_link_views', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table
      .uuid('share_link_id')
      .notNullable()
      .references('id')
      .inTable('load_share_links')
      .onDelete('CASCADE');
    table
      .timestamp('viewed_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.text('ip_hash').nullable();
    table.text('user_agent_hash').nullable();
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_load_share_link_views_link_viewed_at
    ON load_share_link_views (share_link_id, viewed_at DESC)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('load_share_link_views');
};
