/**
 * FN-405: Add category, source_transaction_id columns to fuel_transactions.
 * Enforce product_type enum via CHECK constraint. Backfill existing rows.
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('fuel_transactions');
  if (!hasTable) return;

  // Add category column with default 'fuel'
  const hasCategory = await knex.schema.hasColumn('fuel_transactions', 'category');
  if (!hasCategory) {
    await knex.schema.alterTable('fuel_transactions', (table) => {
      table.text('category').defaultTo('fuel');
    });
  }

  // Add source_transaction_id for grouping split rows
  const hasSourceTxnId = await knex.schema.hasColumn('fuel_transactions', 'source_transaction_id');
  if (!hasSourceTxnId) {
    await knex.schema.alterTable('fuel_transactions', (table) => {
      table.text('source_transaction_id').nullable();
    });
  }

  // Add CHECK constraints via raw SQL (idempotent with IF NOT EXISTS pattern)
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_fuel_txn_product_type'
      ) THEN
        ALTER TABLE fuel_transactions
          ADD CONSTRAINT chk_fuel_txn_product_type
          CHECK (product_type IN ('diesel', 'def', 'reefer') OR product_type IS NULL);
      END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_fuel_txn_category'
      ) THEN
        ALTER TABLE fuel_transactions
          ADD CONSTRAINT chk_fuel_txn_category
          CHECK (category IN ('fuel', 'maintenance', 'advance'));
      END IF;
    END $$;
  `);

  // Indexes
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_fuel_txn_source_txn
    ON fuel_transactions(tenant_id, source_transaction_id)
    WHERE source_transaction_id IS NOT NULL;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_fuel_txn_product_type
    ON fuel_transactions(tenant_id, product_type);
  `);

  // Backfill: default product_type to 'diesel' where NULL
  await knex.raw(`
    UPDATE fuel_transactions SET product_type = 'diesel' WHERE product_type IS NULL;
  `);
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('fuel_transactions');
  if (!hasTable) return;

  // Drop constraints
  await knex.raw(`ALTER TABLE fuel_transactions DROP CONSTRAINT IF EXISTS chk_fuel_txn_product_type;`);
  await knex.raw(`ALTER TABLE fuel_transactions DROP CONSTRAINT IF EXISTS chk_fuel_txn_category;`);

  // Drop indexes
  await knex.raw(`DROP INDEX IF EXISTS idx_fuel_txn_source_txn;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_fuel_txn_product_type;`);

  // Drop columns
  const hasCategory = await knex.schema.hasColumn('fuel_transactions', 'category');
  if (hasCategory) {
    await knex.schema.alterTable('fuel_transactions', (table) => {
      table.dropColumn('category');
    });
  }

  const hasSourceTxnId = await knex.schema.hasColumn('fuel_transactions', 'source_transaction_id');
  if (hasSourceTxnId) {
    await knex.schema.alterTable('fuel_transactions', (table) => {
      table.dropColumn('source_transaction_id');
    });
  }
};
