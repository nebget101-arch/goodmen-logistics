'use strict';

/**
 * FN-1342 (parent FN-1327) — Read access for `dashboard_layout_presets`.
 *
 * Backs the role-default lookup in `services/layout-store.js`. Returns
 * `null` (not throws) when no preset row matches, so the caller can fall
 * through to the hard-coded ROLE_DEFAULTS map (rollback-safe behavior
 * when the table is empty or unavailable).
 *
 * Schema (FN-1341 migration `20260505180000_create_dashboard_layout_presets`):
 *   preset_key VARCHAR PK, role_key VARCHAR, display_name VARCHAR,
 *   layout_json JSONB, is_default_for_role BOOLEAN, created_at, updated_at.
 *   UNIQUE (role_key) WHERE is_default_for_role = true — at most one
 *   default per role_key.
 */

const TABLE = 'dashboard_layout_presets';

function parseLayoutJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_err) {
      return null;
    }
  }
  if (typeof value === 'object') return value;
  return null;
}

function createPresetStore({ knex }) {
  if (!knex) throw new Error('preset-store requires a knex instance');

  async function getDefaultForRole(roleKey) {
    if (!roleKey || typeof roleKey !== 'string') return null;
    const row = await knex(TABLE)
      .where({ role_key: roleKey, is_default_for_role: true })
      .first('preset_key', 'role_key', 'display_name', 'layout_json');
    if (!row) return null;
    const layout = parseLayoutJson(row.layout_json);
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
      return null;
    }
    return {
      preset_key: row.preset_key,
      role_key: row.role_key,
      display_name: row.display_name,
      layout
    };
  }

  return { getDefaultForRole };
}

module.exports = {
  createPresetStore,
  parseLayoutJson,
  TABLE
};
