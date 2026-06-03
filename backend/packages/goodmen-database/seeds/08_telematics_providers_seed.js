'use strict';

/**
 * FN-1660 — Seed telematics_providers with the two Phase-1 providers.
 *
 * Idempotent: INSERT ... ON CONFLICT (code) DO UPDATE so re-running the seed
 * refreshes the human label / active flag without creating duplicates. These
 * rows are reference data the telematics_devices FK depends on, so the seed is
 * additive and safe to run in every environment.
 *
 * Depends on migration 20260603100000_create_telematics_providers having run.
 */

const PROVIDERS = [
  { code: 'samsara', name: 'Samsara' },
  { code: 'motive', name: 'Motive' },
];

exports.seed = async function seed(knex) {
  const hasTable = await knex.schema.hasTable('telematics_providers');
  if (!hasTable) {
    // Migration not run yet — skip silently (matches other seeds' contract).
    return;
  }

  for (const p of PROVIDERS) {
    await knex.raw(
      `INSERT INTO telematics_providers (code, name, is_active)
         VALUES (?, ?, true)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             is_active = true,
             updated_at = now()`,
      [p.code, p.name]
    );
  }
};
