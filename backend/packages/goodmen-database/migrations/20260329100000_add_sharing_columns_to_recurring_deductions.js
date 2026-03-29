/**
 * FN-498: Add expense sharing/split columns to recurring_deduction_rules.
 *
 * New columns:
 *   expense_responsibility  TEXT     ('company','driver','owner','shared')
 *   split_type              TEXT     ('percentage','fixed_amount')
 *   driver_share            DECIMAL  driver portion (% or $)
 *   owner_share             DECIMAL  owner portion  (% or $)
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('recurring_deduction_rules');
  if (!hasTable) return;

  const hasExpResp = await knex.schema.hasColumn('recurring_deduction_rules', 'expense_responsibility');
  if (hasExpResp) return; // already applied

  await knex.schema.alterTable('recurring_deduction_rules', (table) => {
    table.text('expense_responsibility').nullable().defaultTo(null);
    table.text('split_type').nullable().defaultTo(null);
    table.decimal('driver_share', 14, 2).nullable().defaultTo(null);
    table.decimal('owner_share', 14, 2).nullable().defaultTo(null);
  });
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('recurring_deduction_rules');
  if (!hasTable) return;

  await knex.schema.alterTable('recurring_deduction_rules', (table) => {
    table.dropColumn('expense_responsibility');
    table.dropColumn('split_type');
    table.dropColumn('driver_share');
    table.dropColumn('owner_share');
  });
};
