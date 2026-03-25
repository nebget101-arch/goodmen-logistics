/**
 * FN-222: Add employer_email column to employment_application_employers
 * so the email captured in the onboarding form is persisted and available
 * for syncing to driver_past_employers.
 */
exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('employment_application_employers');
  if (hasTable) {
    const hasCol = await knex.schema.hasColumn('employment_application_employers', 'employer_email');
    if (!hasCol) {
      await knex.schema.alterTable('employment_application_employers', (t) => {
        t.text('employer_email');
      });
    }
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('employment_application_employers');
  if (hasTable) {
    const hasCol = await knex.schema.hasColumn('employment_application_employers', 'employer_email');
    if (hasCol) {
      await knex.schema.alterTable('employment_application_employers', (t) => {
        t.dropColumn('employer_email');
      });
    }
  }
};
