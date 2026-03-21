/**
 * Backfill older users table shapes so auth and user creation work reliably.
 * Some environments were created before first_name/last_name/email existed.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasUsers = await knex.schema.hasTable('users');
  if (!hasUsers) return;

  const hasFirstName = await knex.schema.hasColumn('users', 'first_name');
  const hasLastName = await knex.schema.hasColumn('users', 'last_name');
  const hasEmail = await knex.schema.hasColumn('users', 'email');

  if (!hasFirstName || !hasLastName || !hasEmail) {
    await knex.schema.alterTable('users', (table) => {
      if (!hasFirstName) table.string('first_name', 100).nullable();
      if (!hasLastName) table.string('last_name', 100).nullable();
      if (!hasEmail) table.string('email', 255).nullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down() {
  return Promise.resolve();
};