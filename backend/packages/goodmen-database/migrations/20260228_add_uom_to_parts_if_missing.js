/**
 * Ensure parts.uom exists even if parts table was created before
 * the inventory schema migration.
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

  const hasUom = await knex.schema.hasColumn('parts', 'uom');
  if (!hasUom) {
    await knex.schema.alterTable('parts', (table) => {
      table.string('uom').defaultTo('each');
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

  const hasUom = await knex.schema.hasColumn('parts', 'uom');
  if (hasUom) {
    await knex.schema.alterTable('parts', (table) => {
      table.dropColumn('uom');
    });
  }
};

