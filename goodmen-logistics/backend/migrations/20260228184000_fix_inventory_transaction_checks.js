/**
 * Expand inventory_transactions check constraints to support work order flows.
 */
exports.up = async function(knex) {
  if (!await knex.schema.hasTable('inventory_transactions')) return;

  await knex.raw('ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check');
  await knex.raw('ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_reference_type_check');

  await knex.raw(`
    ALTER TABLE inventory_transactions
    ADD CONSTRAINT inventory_transactions_transaction_type_check
    CHECK (transaction_type IN ('RECEIVE', 'ADJUST', 'CYCLE_COUNT_ADJUST', 'RESERVE', 'ISSUE', 'RETURN'))
  `);

  await knex.raw(`
    ALTER TABLE inventory_transactions
    ADD CONSTRAINT inventory_transactions_reference_type_check
    CHECK (reference_type IN ('RECEIVING_TICKET', 'ADJUSTMENT', 'CYCLE_COUNT', 'WORK_ORDER'))
  `);
};

exports.down = async function(knex) {
  if (!await knex.schema.hasTable('inventory_transactions')) return;

  await knex.raw('ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_transaction_type_check');
  await knex.raw('ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_reference_type_check');

  await knex.raw(`
    ALTER TABLE inventory_transactions
    ADD CONSTRAINT inventory_transactions_transaction_type_check
    CHECK (transaction_type IN ('RECEIVE', 'ADJUST', 'CYCLE_COUNT_ADJUST'))
  `);

  await knex.raw(`
    ALTER TABLE inventory_transactions
    ADD CONSTRAINT inventory_transactions_reference_type_check
    CHECK (reference_type IN ('RECEIVING_TICKET', 'ADJUSTMENT', 'CYCLE_COUNT'))
  `);
};
