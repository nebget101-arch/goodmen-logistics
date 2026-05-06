'use strict';

/**
 * FN-1341 (parent FN-1327) — Control Center: role-based layout presets.
 *
 * Adds `dashboard_layout_presets`, an admin-editable catalog of role-tuned
 * starter layouts. Backend (FN-1342) reads these as the source of truth for
 * "no per-user layout yet" responses, replacing the hard-coded ROLE_DEFAULTS
 * map in `auth-users-service/services/layout-store.js`.
 *
 * Schema
 *   preset_key          VARCHAR PK            (e.g. 'owner-default')
 *   role_key            VARCHAR NOT NULL      (e.g. 'owner', 'dispatcher', 'safety')
 *   display_name        VARCHAR NOT NULL      (UI label, e.g. 'Compliance')
 *   layout_json         JSONB NOT NULL DEFAULT '{}'
 *   is_default_for_role BOOLEAN NOT NULL DEFAULT false
 *   created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
 *   updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
 *
 * Indexes
 *   (role_key)                                          — role-scoped lookup
 *   UNIQUE (role_key) WHERE is_default_for_role = true  — exactly one default per role
 *
 * Seed (mirrors current ROLE_DEFAULTS in layout-store.js so behavior is
 * unchanged until FN-1342 swaps the read path):
 *   - 'owner-default'      / role 'owner'      / default
 *   - 'dispatcher-default' / role 'dispatcher' / default
 *   - 'compliance-default' / role 'safety'     / default
 *     ('safety' is the existing role key in the auth/RBAC layer that the
 *     UI surfaces as "Compliance" in this preset.)
 */

const PRESETS = [
  {
    preset_key: 'owner-default',
    role_key: 'owner',
    display_name: 'Owner',
    layout_json: {
      cards: ['daily-briefing', 'predictive-insights', 'action-queue', 'quick-actions']
    },
    is_default_for_role: true
  },
  {
    preset_key: 'dispatcher-default',
    role_key: 'dispatcher',
    display_name: 'Dispatcher',
    layout_json: {
      cards: ['daily-briefing', 'action-queue', 'predictive-insights', 'quick-actions']
    },
    is_default_for_role: true
  },
  {
    preset_key: 'compliance-default',
    role_key: 'safety',
    display_name: 'Compliance',
    layout_json: {
      cards: ['daily-briefing', 'action-queue', 'predictive-insights', 'quick-actions']
    },
    is_default_for_role: true
  }
];

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('dashboard_layout_presets');
  if (!hasTable) {
    await knex.schema.createTable('dashboard_layout_presets', (table) => {
      table.string('preset_key').primary();
      table.string('role_key').notNullable();
      table.string('display_name').notNullable();
      table.jsonb('layout_json').notNullable().defaultTo('{}');
      table.boolean('is_default_for_role').notNullable().defaultTo(false);
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
      'CREATE INDEX IF NOT EXISTS idx_dashboard_layout_presets_role ' +
        'ON dashboard_layout_presets (role_key)'
    );

    await knex.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_layout_presets_default_per_role ' +
        'ON dashboard_layout_presets (role_key) WHERE is_default_for_role = true'
    );
  }

  for (const row of PRESETS) {
    await knex('dashboard_layout_presets')
      .insert({
        preset_key: row.preset_key,
        role_key: row.role_key,
        display_name: row.display_name,
        layout_json: JSON.stringify(row.layout_json),
        is_default_for_role: row.is_default_for_role
      })
      .onConflict('preset_key')
      .ignore();
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('dashboard_layout_presets');
};

exports.PRESETS = PRESETS;
