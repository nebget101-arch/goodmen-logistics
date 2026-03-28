'use strict';

/**
 * FN-448: Add FK constraint on toll_transactions.settlement_id → settlements.id
 * Ensures referential integrity for toll-to-settlement linkage.
 * ON DELETE SET NULL so deleting a settlement doesn't orphan toll transactions.
 */

exports.up = async function (knex) {
  // Add index for FK performance first
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_toll_txn_settlement ON toll_transactions(settlement_id) WHERE settlement_id IS NOT NULL'
  );

  // Add FK constraint
  await knex.raw(`
    ALTER TABLE toll_transactions
    ADD CONSTRAINT fk_toll_txn_settlement
    FOREIGN KEY (settlement_id)
    REFERENCES settlements(id)
    ON DELETE SET NULL
  `);
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE toll_transactions DROP CONSTRAINT IF EXISTS fk_toll_txn_settlement');
  await knex.raw('DROP INDEX IF EXISTS idx_toll_txn_settlement');
};
