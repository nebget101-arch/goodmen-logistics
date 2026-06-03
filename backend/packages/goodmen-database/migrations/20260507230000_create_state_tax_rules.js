/**
 * FN-1537 — Create state_tax_rules reference table
 *
 * State-level base sales-tax rate plus per-component flags
 * (labor / parts / fees taxable) for motor-vehicle and equipment repair.
 *
 * Source data + methodology:
 *   docs/reference/state-sales-tax-rules-2026.csv
 *   docs/reference/state-sales-tax-rules-2026.md
 *
 * Rows are populated by `seeds/07_state_tax_rules_seed.js`, which reads
 * the CSV and INSERTs with ON CONFLICT update for idempotency.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('state_tax_rules', (t) => {
    t.string('state_code', 2).primary();
    t.string('state_name', 64).notNullable();
    t.decimal('default_sales_tax_rate', 6, 4).notNullable().defaultTo(0);
    t.boolean('labor_taxable').notNullable().defaultTo(false);
    t.boolean('parts_taxable').notNullable().defaultTo(false);
    t.boolean('fees_taxable').notNullable().defaultTo(false);
    t.text('notes').nullable();
    t.text('source_url').nullable();
    t.date('effective_from').notNullable();
    t.date('effective_to').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Sales-tax rate is non-negative.
  await knex.raw(`
    ALTER TABLE state_tax_rules
    ADD CONSTRAINT chk_state_tax_rules_rate_non_negative
    CHECK (default_sales_tax_rate >= 0)
  `);

  // Effective range is well-formed (open-ended is fine).
  await knex.raw(`
    ALTER TABLE state_tax_rules
    ADD CONSTRAINT chk_state_tax_rules_effective_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('state_tax_rules');
};
