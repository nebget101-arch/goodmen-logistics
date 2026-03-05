/**
 * Customer credit balance + transactions
 */
exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasBalance = await knex.schema.hasTable('customer_credit_balance');
  if (!hasBalance) {
    await knex.schema.createTable('customer_credit_balance', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('customer_id').notNullable().unique().references('id').inTable('customers').onDelete('CASCADE');
      table.decimal('credit_limit', 12, 2).defaultTo(0);
      table.decimal('credit_used', 12, 2).defaultTo(0);
      table.decimal('available_credit', 12, 2).defaultTo(0);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  const hasTransactions = await knex.schema.hasTable('customer_credit_transactions');
  if (!hasTransactions) {
    await knex.schema.createTable('customer_credit_transactions', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
      table.enu('transaction_type', ['INVOICE_APPLIED', 'PAYMENT', 'LIMIT_CHANGE']).notNullable();
      table.uuid('reference_id');
      table.text('reference_type');
      table.decimal('amount', 12, 2).defaultTo(0);
      table.text('description');
      table.decimal('previous_balance', 12, 2).defaultTo(0);
      table.decimal('new_balance', 12, 2).defaultTo(0);
      table.uuid('created_by_user_id').references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_customer_credit_tx_customer ON customer_credit_transactions (customer_id, created_at DESC)');
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('customer_credit_transactions');
  await knex.schema.dropTableIfExists('customer_credit_balance');
};
