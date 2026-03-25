/**
 * FN-218: Seed new DQF requirement keys for the Pre-Hire Checklist section.
 *
 * New keys added:
 *   - clearinghouse_consent_sent
 *   - clearinghouse_consent_received
 *   - clearinghouse_result_received
 *   - employment_verification_submitted
 *   - pre_employment_drug_test_submitted
 *
 * Existing keys that will be re-categorized in the frontend:
 *   - employment_application_completed  (already seeded)
 *   - cdl_on_file                       (already seeded)
 *   - mvr_authorization_signed          (already seeded)
 *   - psp_consent                       (already seeded)
 */

const NEW_KEYS = [
  { key: 'clearinghouse_consent_sent', label: 'Clearinghouse Full Query Consent Sent', weight: 5 },
  { key: 'clearinghouse_consent_received', label: 'Clearinghouse Full Query Consent Received', weight: 5 },
  { key: 'clearinghouse_result_received', label: 'Clearinghouse Query Result Received', weight: 5 },
  { key: 'employment_verification_submitted', label: 'Employment Verification Submitted (§391.23)', weight: 5 },
  { key: 'pre_employment_drug_test_submitted', label: 'Pre-Employment Drug Test Submitted (§382.301)', weight: 5 },
];

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  for (const r of NEW_KEYS) {
    await knex('dqf_requirements')
      .insert(r)
      .onConflict('key')
      .ignore();
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  await knex('dqf_requirements')
    .whereIn('key', NEW_KEYS.map((r) => r.key))
    .del();
};
