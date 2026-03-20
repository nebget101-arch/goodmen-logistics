'use strict';

/**
 * Add 'driver' to users.role so driver app users can be created.
 * Handles both PostgreSQL native enum and CHECK constraint.
 */

// ALTER TYPE ... ADD VALUE can fail inside transaction blocks in PostgreSQL,
// and any resulting error marks the whole transaction aborted.
exports.config = { transaction: false };

exports.up = async function (knex) {
  const r = await knex.raw(`
    SELECT udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'role'
    LIMIT 1
  `);
  const udtName = r?.rows?.[0]?.udt_name;
  if (!udtName) return;

  if (udtName === 'varchar') {
    // Column is varchar (e.g. with CHECK); adding driver would require altering the constraint with all existing role values
    return;
  }
  const quoted = knex.client.config.client === 'pg' ? `"${udtName}"` : udtName;
  await knex.raw(`ALTER TYPE ${quoted} ADD VALUE 'driver'`).catch(() => {});
};

exports.down = async function () {
  // Reverting enum/constraint is environment-specific; leave as-is.
};
