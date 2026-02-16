/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('users');
  if (!exists) {
    await knex.schema.createTable('users', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.string('username', 100).notNullable().unique();
      table.string('password_hash', 255).notNullable();
      table.enu('role', ['admin', 'safety', 'fleet', 'dispatch']).notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  } else {
    // Add columns if they do not exist
    const hasUsername = await knex.schema.hasColumn('users', 'username');
    if (!hasUsername) {
      await knex.schema.table('users', function(table) {
        table.string('username', 100).notNullable().unique();
      });
    }
    const hasPasswordHash = await knex.schema.hasColumn('users', 'password_hash');
    if (!hasPasswordHash) {
      await knex.schema.table('users', function(table) {
        table.string('password_hash', 255).notNullable();
      });
    }
    const hasRole = await knex.schema.hasColumn('users', 'role');
    if (!hasRole) {
      await knex.schema.table('users', function(table) {
        table.enu('role', ['admin', 'safety', 'fleet', 'dispatch']).notNullable();
      });
    }
    const hasCreatedAt = await knex.schema.hasColumn('users', 'created_at');
    if (!hasCreatedAt) {
      await knex.schema.table('users', function(table) {
        table.timestamp('created_at').defaultTo(knex.fn.now());
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // For safety, do not drop the table or columns automatically
  // You can manually remove columns if needed
  return Promise.resolve();
};
