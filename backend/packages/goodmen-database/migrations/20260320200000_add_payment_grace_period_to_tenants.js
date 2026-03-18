'use strict';

/**
 * FN-75: Add payment_grace_period_end column to tenants
 * Used to track grace period for failed payments (3-day window to recover)
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('tenants', 'payment_grace_period_end');
  if (hasColumn) return;

  await knex.schema.alterTable('tenants', (table) => {
    table.timestamp('payment_grace_period_end', { useTz: true }).nullable();
  });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('tenants', 'payment_grace_period_end');
  if (!hasColumn) return;

  await knex.schema.alterTable('tenants', (table) => {
    table.dropColumn('payment_grace_period_end');
  });
};
