/**
 * FN-231: Rename 'Pre-employment drug test completed' to 'Pre-Employment Drug Test'
 * in Pre-Hire Documents section for cleaner display.
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  await knex('dqf_requirements')
    .where('key', 'pre_employment_drug_test_completed')
    .update({ label: 'Pre-Employment Drug Test' });
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  await knex('dqf_requirements')
    .where('key', 'pre_employment_drug_test_completed')
    .update({ label: 'Pre-employment drug test completed' });
};
