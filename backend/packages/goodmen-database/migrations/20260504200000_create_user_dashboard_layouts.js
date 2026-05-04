'use strict';

/**
 * FN-1174 (parent FN-1130) — Control Center: per-user dashboard layout storage.
 *
 * Backs the drag-reorder + reset-to-default behavior in the role-aware
 * Control Center (`frontend/src/app/components/control-center`). Each user
 * has at most one row; the row holds the JSON layout produced by the
 * frontend after the user reorders/persists their cards.
 *
 * Schema
 *   user_id     UUID PK            (FK → users.id   ON DELETE CASCADE)
 *   tenant_id   UUID NOT NULL      (FK → tenants.id ON DELETE CASCADE)
 *   layout_json JSONB NOT NULL DEFAULT '{}'
 *   updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
 *
 * Indexes
 *   (tenant_id) — supports tenant-scoped reads and bulk cleanup paths.
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('user_dashboard_layouts');
  if (hasTable) return;

  await knex.schema.createTable('user_dashboard_layouts', (table) => {
    table
      .uuid('user_id')
      .primary()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table
      .uuid('tenant_id')
      .notNullable()
      .references('id')
      .inTable('tenants')
      .onDelete('CASCADE');
    table.jsonb('layout_json').notNullable().defaultTo('{}');
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_user_dashboard_layouts_tenant ' +
      'ON user_dashboard_layouts (tenant_id)'
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('user_dashboard_layouts');
};
