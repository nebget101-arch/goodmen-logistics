/**
 * FN-673 follow-up: Replace account-scoped unique index with per-physical-card rules.
 *
 * idx_fcda_one_active_per_card was ON (fuel_card_account_id) WHERE active — only one active
 * assignment per account. Per-card assign flows need multiple actives per account (distinct fuel_card_id).
 */
exports.up = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_fcda_one_active_per_card`);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_fcda_one_active_per_fuel_card
    ON fuel_card_driver_assignments (tenant_id, fuel_card_id)
    WHERE status = 'active' AND fuel_card_id IS NOT NULL
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_fcda_one_active_legacy_slot
    ON fuel_card_driver_assignments (tenant_id, fuel_card_account_id, COALESCE(card_number_last4, ''))
    WHERE status = 'active' AND fuel_card_id IS NULL
  `);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_fcda_one_active_per_fuel_card`);
  await knex.raw(`DROP INDEX IF EXISTS idx_fcda_one_active_legacy_slot`);

  // Rollback only safe if at most one active row per fuel_card_account_id.
  await knex.raw(`
    CREATE UNIQUE INDEX idx_fcda_one_active_per_card
    ON fuel_card_driver_assignments (fuel_card_account_id)
    WHERE status = 'active'
  `);
};
