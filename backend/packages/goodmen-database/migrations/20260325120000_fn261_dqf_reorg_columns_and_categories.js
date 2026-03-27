/**
 * FN-261: DQF checklist reorganization.
 *
 * 1. Add `exclude_from_dqf` boolean column (default false) to dqf_requirements.
 * 2. Add `category` text column to dqf_requirements (if not already present).
 * 3. Assign categories to all requirement keys.
 * 4. Set `exclude_from_dqf = true` for requirements that should not count
 *    toward DQF completeness (duplicates, optional items, "other" bucket).
 * 5. Seed new requirement: `employment_verification_received`.
 * 6. Move `annual_clearinghouse_limited_query` alias
 *    (`annual_clearinghouse_query`) to `annual` category.
 * 7. Move `pre_employment_drug_test_scheduled` to `pre_hire_checklist` category.
 */

/* eslint-disable no-await-in-loop */

/**
 * Category assignments for every known requirement key.
 */
const CATEGORY_MAP = {
  // --- pre_hire_checklist ---
  employment_application_completed: 'pre_hire_checklist',
  employment_application_signed: 'pre_hire_checklist',
  employment_application_submitted: 'pre_hire_checklist',
  mvr_authorization_signed: 'pre_hire_checklist',
  cdl_on_file: 'pre_hire_checklist',
  driver_license_front_on_file: 'pre_hire_checklist',
  driver_license_back_on_file: 'pre_hire_checklist',
  medical_card_front_on_file: 'pre_hire_checklist',
  medical_card_back_on_file: 'pre_hire_checklist',
  pre_employment_drug_test_scheduled: 'pre_hire_checklist',
  pre_employment_drug_test_completed: 'pre_hire_checklist',
  pre_employment_drug_test_submitted: 'pre_hire_checklist',
  clearinghouse_consent_sent: 'pre_hire_checklist',
  clearinghouse_consent_received: 'pre_hire_checklist',
  clearinghouse_result_received: 'pre_hire_checklist',
  fcra_disclosure_signed: 'pre_hire_checklist',
  fcra_authorization_signed: 'pre_hire_checklist',
  release_of_info_dq_safety_signed: 'pre_hire_checklist',
  drug_alcohol_release_signed: 'pre_hire_checklist',
  fcra_authorization: 'pre_hire_checklist',
  psp_consent: 'pre_hire_checklist',

  // --- within_30_days ---
  employment_verification_submitted: 'within_30_days',
  employment_verification_received: 'within_30_days',

  // --- annual ---
  annual_mvr_inquiry: 'annual',
  annual_driving_record_review: 'annual',
  annual_clearinghouse_query: 'annual',

  // --- other (excluded from DQF by default) ---
  green_card_on_file: 'other',
  road_test_certificate: 'other',
  nrcme_verification: 'other',
  release_of_info_signed: 'other',
  eldt_certificate: 'other',
  medical_variance_spe: 'other',
  medical_cert_on_file: 'other',
};

/**
 * Keys to mark as exclude_from_dqf = true.
 * These are duplicates, optional, or "other" items that
 * should not count toward DQF percentage.
 */
const EXCLUDED_KEYS = [
  // "other" category — entirely excluded
  'green_card_on_file',
  'road_test_certificate',
  'nrcme_verification',
  'eldt_certificate',
  'medical_variance_spe',
  // duplicates
  'release_of_info_signed',            // duplicate of release_of_info_dq_safety_signed
  'employment_application_signed',     // duplicate of employment_application_submitted
  'medical_cert_on_file',              // duplicate of medical_card_front/back
];

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  // 1) Add exclude_from_dqf column if missing
  const hasExcludeCol = await knex.schema.hasColumn('dqf_requirements', 'exclude_from_dqf');
  if (!hasExcludeCol) {
    await knex.schema.alterTable('dqf_requirements', (table) => {
      table.boolean('exclude_from_dqf').notNullable().defaultTo(false);
    });
  }

  // 2) Add category column if missing
  const hasCategoryCol = await knex.schema.hasColumn('dqf_requirements', 'category');
  if (!hasCategoryCol) {
    await knex.schema.alterTable('dqf_requirements', (table) => {
      table.text('category');
    });
  }

  // 3) Update category for every known requirement key
  for (const [key, category] of Object.entries(CATEGORY_MAP)) {
    await knex('dqf_requirements')
      .where('key', key)
      .update({ category });
  }

  // 4) Set exclude_from_dqf = true for excluded keys
  await knex('dqf_requirements')
    .whereIn('key', EXCLUDED_KEYS)
    .update({ exclude_from_dqf: true });

  // 5) Seed employment_verification_received
  await knex('dqf_requirements')
    .insert({
      key: 'employment_verification_received',
      label: 'Employment Verification Received',
      weight: 8,
      category: 'within_30_days',
      exclude_from_dqf: false,
    })
    .onConflict('key')
    .ignore();
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('dqf_requirements');
  if (!hasTable) return;

  // Remove the new requirement
  await knex('dqf_requirements')
    .where('key', 'employment_verification_received')
    .del();

  // Reset exclude_from_dqf back to false
  const hasExcludeCol = await knex.schema.hasColumn('dqf_requirements', 'exclude_from_dqf');
  if (hasExcludeCol) {
    await knex('dqf_requirements').update({ exclude_from_dqf: false });
  }

  // Clear category values (set to null)
  const hasCategoryCol = await knex.schema.hasColumn('dqf_requirements', 'category');
  if (hasCategoryCol) {
    await knex('dqf_requirements').update({ category: null });
  }

  // Note: we don't drop the columns themselves since other migrations
  // (e.g. fn236) may also reference the category column.
};
