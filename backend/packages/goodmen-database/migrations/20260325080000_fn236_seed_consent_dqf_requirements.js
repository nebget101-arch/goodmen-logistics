/**
 * FN-236: Seed DQF checklist items for consent forms.
 *
 * Adds pre-hire DQF requirement keys so that when a driver signs
 * each consent form, the corresponding checklist item is auto-completed
 * via the CONSENT_DQF_MAP in consent-service.js.
 *
 * Also seeds the employment_application_submitted requirement used by FN-235.
 */

const REQUIREMENTS = [
  {
    key: 'fcra_disclosure_signed',
    label: 'FCRA Disclosure Signed',
    category: 'pre_hire',
    weight: 2
  },
  {
    key: 'fcra_authorization_signed',
    label: 'FCRA Authorization Signed',
    category: 'pre_hire',
    weight: 3
  },
  {
    key: 'release_of_info_dq_safety_signed',
    label: 'Release of Info / DQ & Safety Signed',
    category: 'pre_hire',
    weight: 4
  },
  {
    key: 'drug_alcohol_release_signed',
    label: 'Release of Info / Drug & Alcohol Signed',
    category: 'pre_hire',
    weight: 5
  },
  {
    key: 'employment_application_submitted',
    label: 'Employment Application Submitted',
    category: 'pre_hire',
    weight: 10
  }
];

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) {
    return;
  }

  // Check if the table has a 'category' column (some deployments may not)
  const cols = await knex.raw(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'dqf_requirements' AND column_name = 'category'`
  );
  const hasCategory = cols.rows.length > 0;

  for (const r of REQUIREMENTS) {
    const row = hasCategory
      ? { key: r.key, label: r.label, category: r.category, weight: r.weight }
      : { key: r.key, label: r.label, weight: r.weight };

    await knex('dqf_requirements')
      .insert(row)
      .onConflict('key')
      .ignore();
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  await knex('dqf_requirements')
    .whereIn('key', REQUIREMENTS.map((r) => r.key))
    .del();
};
