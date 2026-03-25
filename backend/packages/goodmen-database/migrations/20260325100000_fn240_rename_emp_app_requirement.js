/**
 * FN-240: Rename the DQF requirement label for employment_application_submitted.
 *
 * Changes "Employment Application Submitted" -> "Employment Application Document"
 * so the checklist reflects that the item is about the document artifact,
 * not just the act of submission.
 */

const REQUIREMENT_KEY = 'employment_application_submitted';
const OLD_LABEL = 'Employment Application Submitted';
const NEW_LABEL = 'Employment Application Document';

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  await knex('dqf_requirements')
    .where('key', REQUIREMENT_KEY)
    .update({ label: NEW_LABEL });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  await knex('dqf_requirements')
    .where('key', REQUIREMENT_KEY)
    .update({ label: OLD_LABEL });
};
