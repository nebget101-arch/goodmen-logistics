'use strict';

/**
 * FN-1538 — Persist tax breakdown + manual-override flag on work_orders.
 *
 * `tax_breakdown` (JSONB) stores the audit trail emitted by the state-aware
 * tax engine in `work-orders.service.js`:
 *     {
 *       rule_state, rate, override, fallback_reason,
 *       labor_taxable, parts_taxable, fees_taxable,
 *       labor_subtotal, parts_subtotal, fees_subtotal,
 *       taxable_subtotal, taxable_after_discount,
 *       discount_amount, tax_amount
 *     }
 * The frontend (FN-1539) renders this as the "how was tax computed" tooltip.
 *
 * `tax_rate_override` (BOOLEAN) makes the override intent explicit. With a
 * straight `tax_rate_percent` column, "0" is ambiguous between "user wants
 * no tax" and "default — compute from state rule". Adding this flag lets
 * `0` mean "user explicitly set 0% tax" only when the flag is true.
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('work_orders');
  if (!hasTable) return;

  const hasBreakdown = await knex.schema.hasColumn('work_orders', 'tax_breakdown');
  const hasOverride = await knex.schema.hasColumn('work_orders', 'tax_rate_override');

  await knex.schema.alterTable('work_orders', (t) => {
    if (!hasBreakdown) t.jsonb('tax_breakdown').nullable();
    if (!hasOverride) t.boolean('tax_rate_override').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('work_orders');
  if (!hasTable) return;

  await knex.schema.alterTable('work_orders', (t) => {
    t.dropColumn('tax_breakdown');
    t.dropColumn('tax_rate_override');
  });
};
