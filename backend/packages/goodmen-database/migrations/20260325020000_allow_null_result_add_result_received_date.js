/**
 * FN-217: Allow drug_alcohol_tests.result to be NULL (test may be scheduled
 * before results arrive) and add result_received_date column to capture when
 * the lab result was sent back to the company.
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE drug_alcohol_tests
      ALTER COLUMN result DROP NOT NULL
  `);

  const hasCol = await knex.schema.hasColumn('drug_alcohol_tests', 'result_received_date');
  if (!hasCol) {
    await knex.schema.alterTable('drug_alcohol_tests', (t) => {
      t.date('result_received_date').nullable().comment('Date the lab result was sent back to the company');
    });
  }
};

exports.down = async function (knex) {
  await knex.raw(`
    UPDATE drug_alcohol_tests SET result = 'pending' WHERE result IS NULL
  `);
  await knex.raw(`
    ALTER TABLE drug_alcohol_tests
      ALTER COLUMN result SET NOT NULL
  `);

  const hasCol = await knex.schema.hasColumn('drug_alcohol_tests', 'result_received_date');
  if (hasCol) {
    await knex.schema.alterTable('drug_alcohol_tests', (t) => {
      t.dropColumn('result_received_date');
    });
  }
};
