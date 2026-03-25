/**
 * FN-257: Add deleted_at column to driver_documents for soft-delete support
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('driver_documents', 'deleted_at');
  if (!hasColumn) {
    await knex.schema.alterTable('driver_documents', (table) => {
      table.timestamp('deleted_at', { useTz: true }).nullable().defaultTo(null);
    });
  }
};

exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('driver_documents', 'deleted_at');
  if (hasColumn) {
    await knex.schema.alterTable('driver_documents', (table) => {
      table.dropColumn('deleted_at');
    });
  }
};
