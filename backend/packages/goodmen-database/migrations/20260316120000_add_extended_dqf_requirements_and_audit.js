/**
 * Extended DQF requirements and audit logging.
 *
 * Tables:
 * - dqf_status_changes (audit log for requirement status changes)
 * - driver_past_employers (employment verification history)
 *
 * Inserts new requirement keys into dqf_requirements table:
 * - driver_license_front_on_file, driver_license_back_on_file
 * - medical_card_front_on_file, medical_card_back_on_file
 * - green_card_on_file
 * - pre_employment_drug_test_scheduled, pre_employment_drug_test_completed
 * - clearinghouse_consent_sent, clearinghouse_consent_received
 * - employment_verification_submitted
 * - release_of_info_signed
 */

/* eslint-disable no-await-in-loop */

exports.up = async function up(knex) {
  // 1) dqf_status_changes audit table
  const hasAudit = await knex.schema.hasTable('dqf_status_changes');
  if (!hasAudit) {
    await knex.schema.createTable('dqf_status_changes', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('driver_id').notNullable().references('id').inTable('drivers').onDelete('CASCADE');
      table.text('requirement_key').notNullable();
      table.text('old_status').defaultTo('missing');
      table.text('new_status').notNullable();
      table.uuid('changed_by_user_id').references('id').inTable('users');
      table.timestamp('changed_at', { useTz: true }).defaultTo(knex.fn.now());
      table.text('note');
      table.index(['driver_id']);
      table.index(['requirement_key']);
      table.index(['changed_at']);
    });
  }

  // 2) driver_past_employers table
  const hasEmps = await knex.schema.hasTable('driver_past_employers');
  if (!hasEmps) {
    await knex.schema.createTable('driver_past_employers', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('driver_id').notNullable().references('id').inTable('drivers').onDelete('CASCADE');
      table.text('employer_name').notNullable();
      table.text('contact_name');
      table.text('contact_phone');
      table.date('start_date');
      table.date('end_date');
      table.text('reason_for_leaving');
      table.timestamp('verification_sent_at', { useTz: true });
      table.timestamp('verification_received_at', { useTz: true });
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.index(['driver_id']);
    });
  }

  // 3) Seed extended dqf_requirements
  const newRequirements = [
    {
      key: 'driver_license_front_on_file',
      label: 'Driver license (front) on file',
      weight: 5
    },
    {
      key: 'driver_license_back_on_file',
      label: 'Driver license (back) on file',
      weight: 5
    },
    {
      key: 'medical_card_front_on_file',
      label: 'Medical certificate (front) on file',
      weight: 10
    },
    {
      key: 'medical_card_back_on_file',
      label: 'Medical certificate (back) on file',
      weight: 5
    },
    {
      key: 'green_card_on_file',
      label: 'Green card on file',
      weight: 5
    },
    {
      key: 'pre_employment_drug_test_scheduled',
      label: 'Pre-employment drug test scheduled',
      weight: 8
    },
    {
      key: 'pre_employment_drug_test_completed',
      label: 'Pre-employment drug test completed',
      weight: 15
    },
    {
      key: 'clearinghouse_consent_sent',
      label: 'Clearinghouse consent sent',
      weight: 5
    },
    {
      key: 'clearinghouse_consent_received',
      label: 'Clearinghouse consent received',
      weight: 10
    },
    {
      key: 'employment_verification_submitted',
      label: 'Employment verification submitted',
      weight: 10
    },
    {
      key: 'release_of_info_signed',
      label: 'Release of information signed',
      weight: 8
    }
  ];

  for (const r of newRequirements) {
    await knex('dqf_requirements')
      .insert(r)
      .onConflict('key')
      .ignore();
  }
};

exports.down = async function down(knex) {
  // Delete the new requirements we added
  await knex('dqf_requirements').whereIn('key', [
    'driver_license_front_on_file',
    'driver_license_back_on_file',
    'medical_card_front_on_file',
    'medical_card_back_on_file',
    'green_card_on_file',
    'pre_employment_drug_test_scheduled',
    'pre_employment_drug_test_completed',
    'clearinghouse_consent_sent',
    'clearinghouse_consent_received',
    'employment_verification_submitted',
    'release_of_info_signed'
  ]).del();

  await knex.schema.dropTableIfExists('driver_past_employers');
  await knex.schema.dropTableIfExists('dqf_status_changes');
};
