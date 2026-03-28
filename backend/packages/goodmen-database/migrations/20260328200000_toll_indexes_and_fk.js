/**
 * FN-450: Add composite index and FK constraint on toll_transactions.
 *
 * - Composite index: toll_transactions(tenant_id, transaction_date DESC)
 * - FK constraint: toll_transactions.settlement_id → settlements.id ON DELETE SET NULL
 */
exports.up = async function (knex) {
  const hasTollTxn = await knex.schema.hasTable('toll_transactions');
  if (!hasTollTxn) return;

  // Composite index for common query pattern (tenant + date ordering)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_toll_txn_tenant_date
    ON toll_transactions(tenant_id, transaction_date DESC);
  `);

  // FK constraint: settlement_id → settlements.id (only if settlements table exists)
  const hasSettlements = await knex.schema.hasTable('settlements');
  const hasSettlementId = await knex.schema.hasColumn('toll_transactions', 'settlement_id');

  if (hasSettlements && hasSettlementId) {
    await knex.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_toll_txn_settlement'
        ) THEN
          ALTER TABLE toll_transactions
            ADD CONSTRAINT fk_toll_txn_settlement
            FOREIGN KEY (settlement_id) REFERENCES settlements(id)
            ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }
};

exports.down = async function (knex) {
  const hasTollTxn = await knex.schema.hasTable('toll_transactions');
  if (!hasTollTxn) return;

  await knex.raw(`DROP INDEX IF EXISTS idx_toll_txn_tenant_date;`);
  await knex.raw(`ALTER TABLE toll_transactions DROP CONSTRAINT IF EXISTS fk_toll_txn_settlement;`);
};
