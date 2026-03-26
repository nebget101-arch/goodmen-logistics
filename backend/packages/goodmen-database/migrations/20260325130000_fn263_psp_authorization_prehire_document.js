/**
 * FN-263: Add PSP Authorization Document to Pre-Hire Documents section.
 *
 * This creates a new DQF requirement 'psp_authorization_document' that appears
 * under Pre-Hire Documents (Before Driving) with upload/download capability.
 * It auto-completes when the driver signs the PSP consent form.
 */

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  // Check if it already exists
  const existing = await knex('dqf_requirements').where({ key: 'psp_authorization_document' }).first();
  if (existing) return;

  await knex('dqf_requirements').insert({
    key: 'psp_authorization_document',
    label: 'PSP Authorization Document',
    weight: 3,
    category: 'pre_hire'
  });
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  await knex('dqf_requirements').where({ key: 'psp_authorization_document' }).del();
  await knex('dqf_driver_status').where({ requirement_key: 'psp_authorization_document' }).del();
};
