/**
 * FN-767: Adds a JSONB `preferences` column on users for per-user UI preferences
 * (loads-dashboard column visibility, saved filter views, etc.).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) return;

  const hasPreferences = await knex.schema.hasColumn('users', 'preferences');
  if (hasPreferences) return;

  await knex.schema.alterTable('users', (table) => {
    table.jsonb('preferences').notNullable().defaultTo('{}');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) return;

  const hasPreferences = await knex.schema.hasColumn('users', 'preferences');
  if (!hasPreferences) return;

  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('preferences');
  });
};
