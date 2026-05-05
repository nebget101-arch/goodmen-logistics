'use strict';

/**
 * FN-1341 (parent FN-1327) — Idempotent seed for dashboard_layout_presets.
 *
 * The migration `20260505180000_create_dashboard_layout_presets.js` seeds
 * the same three rows at migration time. This standalone seed file lets
 * the rows be re-applied on environments where the catalog has been edited
 * away from the canonical defaults (e.g. local dev experimentation), and
 * makes the seed available via `knex seed:run --specific=...`.
 *
 * Idempotent: ON CONFLICT (preset_key) updates display_name + layout_json
 * back to the canonical values; existing edits to other rows are preserved.
 */

const { PRESETS } = require('../migrations/20260505180000_create_dashboard_layout_presets');

exports.seed = async function seed(knex) {
  const hasTable = await knex.schema.hasTable('dashboard_layout_presets');
  if (!hasTable) return;

  for (const row of PRESETS) {
    await knex('dashboard_layout_presets')
      .insert({
        preset_key: row.preset_key,
        role_key: row.role_key,
        display_name: row.display_name,
        layout_json: JSON.stringify(row.layout_json),
        is_default_for_role: row.is_default_for_role,
        updated_at: knex.fn.now()
      })
      .onConflict('preset_key')
      .merge({
        role_key: row.role_key,
        display_name: row.display_name,
        layout_json: JSON.stringify(row.layout_json),
        is_default_for_role: row.is_default_for_role,
        updated_at: knex.fn.now()
      });
  }
};
