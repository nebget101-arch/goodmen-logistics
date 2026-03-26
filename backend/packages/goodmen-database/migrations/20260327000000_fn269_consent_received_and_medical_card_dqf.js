/**
 * FN-269: Seed new DQF requirements for consent received tracking and medical card.
 *
 * New requirements (all category: 'pre_hire_checklist'):
 * - medical_card_received (weight 3) — auto-completes on Medical Examiner's Certificate upload
 * - fcra_disclosure_received (weight 2) — auto-completes when FCRA Disclosure is signed
 * - fcra_authorization_received (weight 2) — auto-completes when FCRA Authorization is signed
 * - release_of_info_dq_safety_received (weight 2) — auto-completes when Release of Info (DQ & Safety) is signed
 * - drug_alcohol_release_received (weight 2) — auto-completes when Drug & Alcohol Release is signed
 * - mvr_disclosure_received (weight 2) — auto-completes when MVR Disclosure is signed
 * - mvr_release_of_liability_received (weight 2) — auto-completes when MVR Release of Liability is signed
 */

const NEW_REQUIREMENTS = [
  { key: 'medical_card_received', label: 'Medical Card Received', weight: 3, category: 'pre_hire_checklist' },
  { key: 'fcra_disclosure_received', label: 'FCRA Disclosure Received', weight: 2, category: 'pre_hire_checklist' },
  { key: 'fcra_authorization_received', label: 'FCRA Authorization Received', weight: 2, category: 'pre_hire_checklist' },
  { key: 'release_of_info_dq_safety_received', label: 'Release of Info (DQ & Safety) Received', weight: 2, category: 'pre_hire_checklist' },
  { key: 'drug_alcohol_release_received', label: 'Drug & Alcohol Release Received', weight: 2, category: 'pre_hire_checklist' },
  { key: 'mvr_disclosure_received', label: 'MVR Disclosure Received', weight: 2, category: 'pre_hire_checklist' },
  { key: 'mvr_release_of_liability_received', label: 'MVR Release of Liability Received', weight: 2, category: 'pre_hire_checklist' }
];

exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  for (const req of NEW_REQUIREMENTS) {
    const existing = await knex('dqf_requirements').where({ key: req.key }).first();
    if (!existing) {
      await knex('dqf_requirements').insert(req);
    }
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  const keys = NEW_REQUIREMENTS.map(r => r.key);
  await knex('dqf_driver_status').whereIn('requirement_key', keys).del();
  await knex('dqf_requirements').whereIn('key', keys).del();
};
