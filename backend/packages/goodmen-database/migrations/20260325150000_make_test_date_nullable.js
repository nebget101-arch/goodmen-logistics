/**
 * Make test_date nullable on drug_alcohol_tests table.
 * Tests can be scheduled before a date is known.
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('drug_alcohol_tests');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('drug_alcohol_tests', 'test_date');
  if (!hasColumn) return;

  await knex.raw(`
    ALTER TABLE drug_alcohol_tests
    ALTER COLUMN test_date DROP NOT NULL
  `);
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('drug_alcohol_tests');
  if (!hasTable) return;

  // Set any NULLs to today before re-adding constraint
  await knex.raw(`
    UPDATE drug_alcohol_tests SET test_date = CURRENT_DATE WHERE test_date IS NULL
  `);

  await knex.raw(`
    ALTER TABLE drug_alcohol_tests
    ALTER COLUMN test_date SET NOT NULL
  `);
};
