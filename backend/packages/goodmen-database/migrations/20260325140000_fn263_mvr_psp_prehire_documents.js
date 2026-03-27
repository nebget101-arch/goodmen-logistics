/**
 * FN-263: Add MVR Report Document and ensure PSP Authorization Document
 * exist as Pre-Hire Documents requirements.
 *
 * - mvr_report_document: auto-completed when MVR report is uploaded/extracted
 * - psp_authorization_document: auto-completed when PSP consent is signed
 */

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  const requirements = [
    {
      key: 'mvr_report_document',
      label: 'MVR Report',
      weight: 3,
      category: 'pre_hire'
    },
    {
      key: 'psp_authorization_document',
      label: 'PSP Authorization Document',
      weight: 3,
      category: 'pre_hire'
    }
  ];

  for (const req of requirements) {
    const existing = await knex('dqf_requirements').where({ key: req.key }).first();
    if (!existing) {
      await knex('dqf_requirements').insert(req);
    }
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  await knex('dqf_requirements').whereIn('key', ['mvr_report_document', 'psp_authorization_document']).del();
  await knex('dqf_driver_status').whereIn('requirement_key', ['mvr_report_document', 'psp_authorization_document']).del();
};
