/**
 * Enable the uuid-ossp PostgreSQL extension.
 *
 * This must run before any migration that uses uuid_generate_v4().
 * The IF NOT EXISTS guard makes it safe on databases that already
 * have the extension (e.g. production).
 */
exports.up = async function (knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
};

exports.down = async function (knex) {
  // Intentionally left as a no-op: dropping the extension could break
  // existing data on other tables, so we never roll it back.
};
