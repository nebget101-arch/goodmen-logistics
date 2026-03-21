/**
 * Add example_column to users (idempotent).
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('users');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('users', 'example_column');
  if (hasColumn) return;

  return knex.schema.alterTable('users', table => {
    table.string('example_column');
  });
};

/**
 * Remove example_column from users if present.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('users', 'example_column');
  if (!hasColumn) return;

  return knex.schema.alterTable('users', table => {
    table.dropColumn('example_column');
  });
};
