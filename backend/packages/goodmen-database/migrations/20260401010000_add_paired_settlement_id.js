/**
 * FN-594 — Add backward-compatible pairing metadata to settlements.
 *
 * This migration is intentionally additive so legacy single-settlement rows
 * remain valid while future dual-settlement flows can link paired records.
 */
exports.up = async function (knex) {
  const hasSettlements = await knex.schema.hasTable('settlements');
  if (!hasSettlements) return;

  const hasPairedSettlementId = await knex.schema.hasColumn('settlements', 'paired_settlement_id');
  if (!hasPairedSettlementId) {
    await knex.schema.alterTable('settlements', (table) => {
      table.uuid('paired_settlement_id').nullable();
    });

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_settlements_paired_settlement
      ON settlements(paired_settlement_id)
    `);

    await knex.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE constraint_name = 'settlements_paired_settlement_id_foreign'
            AND table_name = 'settlements'
        ) THEN
          ALTER TABLE settlements
          ADD CONSTRAINT settlements_paired_settlement_id_foreign
          FOREIGN KEY (paired_settlement_id)
          REFERENCES settlements(id)
          ON DELETE SET NULL;
        END IF;
      END$$;
    `);
  }
};

exports.down = async function (knex) {
  const hasSettlements = await knex.schema.hasTable('settlements');
  if (!hasSettlements) return;

  const hasPairedSettlementId = await knex.schema.hasColumn('settlements', 'paired_settlement_id');
  if (!hasPairedSettlementId) return;

  await knex.raw('DROP INDEX IF EXISTS idx_settlements_paired_settlement');
  await knex.raw('ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_paired_settlement_id_foreign');

  await knex.schema.alterTable('settlements', (table) => {
    table.dropColumn('paired_settlement_id');
  });
};
