'use strict';

/**
 * Ensure operating_entities has mailing address columns used by Multi-MC Admin form.
 * Additive + idempotent migration.
 */

async function addColumnIfMissing(knex, tableName, columnName, addFn) {
  const hasColumn = await knex.schema.hasColumn(tableName, columnName);
  if (!hasColumn) {
    await knex.schema.alterTable(tableName, addFn);
  }
}

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('operating_entities');
  if (!hasTable) return;

  await addColumnIfMissing(knex, 'operating_entities', 'address_line1', (table) => {
    table.text('address_line1').nullable();
  });

  await addColumnIfMissing(knex, 'operating_entities', 'city', (table) => {
    table.text('city').nullable();
  });

  await addColumnIfMissing(knex, 'operating_entities', 'state', (table) => {
    table.text('state').nullable();
  });

  await addColumnIfMissing(knex, 'operating_entities', 'zip_code', (table) => {
    table.text('zip_code').nullable();
  });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('operating_entities');
  if (!hasTable) return;

  const hasZip = await knex.schema.hasColumn('operating_entities', 'zip_code');
  const hasState = await knex.schema.hasColumn('operating_entities', 'state');
  const hasCity = await knex.schema.hasColumn('operating_entities', 'city');
  const hasAddressLine1 = await knex.schema.hasColumn('operating_entities', 'address_line1');

  if (hasZip || hasState || hasCity || hasAddressLine1) {
    await knex.schema.alterTable('operating_entities', (table) => {
      if (hasZip) table.dropColumn('zip_code');
      if (hasState) table.dropColumn('state');
      if (hasCity) table.dropColumn('city');
      if (hasAddressLine1) table.dropColumn('address_line1');
    });
  }
};
