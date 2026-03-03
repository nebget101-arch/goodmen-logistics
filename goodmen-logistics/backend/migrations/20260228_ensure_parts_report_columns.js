/**
 * Ensure report-related columns exist on parts table, even if
 * the table was created before the full inventory schema.
 *
 * Columns we guarantee:
 * - uom
 * - default_cost
 * - default_retail_price
 * - is_active
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasParts = await knex.schema.hasTable('parts');
  if (!hasParts) {
    // Nothing to do – parts table not present in this environment.
    return;
  }

  // Ensure uom exists
  let hasCol = await knex.schema.hasColumn('parts', 'uom');
  if (!hasCol) {
    await knex.schema.alterTable('parts', (table) => {
      table.string('uom').defaultTo('each');
    });
  }

  // Ensure default_cost exists
  hasCol = await knex.schema.hasColumn('parts', 'default_cost');
  if (!hasCol) {
    await knex.schema.alterTable('parts', (table) => {
      table.decimal('default_cost', 10, 2).defaultTo(0);
    });
  }

  // Ensure default_retail_price exists
  hasCol = await knex.schema.hasColumn('parts', 'default_retail_price');
  if (!hasCol) {
    await knex.schema.alterTable('parts', (table) => {
      table.decimal('default_retail_price', 10, 2).defaultTo(0);
    });
  }

  // Ensure is_active exists (used in WHERE clause)
  hasCol = await knex.schema.hasColumn('parts', 'is_active');
  if (!hasCol) {
    await knex.schema.alterTable('parts', (table) => {
      table.boolean('is_active').defaultTo(true);
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasParts = await knex.schema.hasTable('parts');
  if (!hasParts) return;

  const maybeDrop = async (columnName) => {
    const exists = await knex.schema.hasColumn('parts', columnName);
    if (exists) {
      await knex.schema.alterTable('parts', (table) => {
        table.dropColumn(columnName);
      });
    }
  };

  await maybeDrop('uom');
  await maybeDrop('default_cost');
  await maybeDrop('default_retail_price');
  await maybeDrop('is_active');
};

