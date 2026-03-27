/**
 * FN-264: Create driver_mvr_reports table and seed DQF requirement.
 *
 * Tables:
 * - driver_mvr_reports  (MVR report storage with parsed violation/accident data)
 *
 * Seeds:
 * - dqf_requirements row: mvr_data_received (category = pre_hire_checklist, weight = 8)
 */

/* eslint-disable no-await-in-loop */

exports.up = async function up(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  const hasUsers = await knex.schema.hasTable('users');
  const hasTenants = await knex.schema.hasTable('tenants');
  const hasDriverDocs = await knex.schema.hasTable('driver_documents');

  // 1) driver_mvr_reports
  const hasMvrReports = await knex.schema.hasTable('driver_mvr_reports');
  if (!hasMvrReports) {
    await knex.schema.createTable('driver_mvr_reports', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

      const driverId = table.uuid('driver_id').notNullable();
      if (hasDrivers) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }

      const documentId = table.uuid('document_id');
      if (hasDriverDocs) {
        documentId.references('id').inTable('driver_documents').onDelete('SET NULL');
      }

      const tenantId = table.uuid('tenant_id');
      if (hasTenants) {
        tenantId.references('id').inTable('tenants');
      }

      table.date('report_date');
      table.text('report_source'); // 'manual_upload', 'api'
      table.text('license_number');
      table.text('license_state');
      table.text('license_status'); // 'valid', 'suspended', 'revoked', 'expired'
      table.text('license_class');
      table.date('license_expiry');
      table.text('endorsements');
      table.text('restrictions');
      table.jsonb('violations').defaultTo(knex.raw(`'[]'::jsonb`));
      table.jsonb('accidents').defaultTo(knex.raw(`'[]'::jsonb`));
      table.integer('points_total').defaultTo(0);
      table.text('raw_text');
      table.text('extraction_method').defaultTo('ai'); // 'ai' or 'manual'
      table.timestamp('extracted_at', { useTz: true });

      const createdBy = table.uuid('created_by');
      if (hasUsers) {
        createdBy.references('id').inTable('users').onDelete('SET NULL');
      }

      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      // Indexes
      table.index(['driver_id']);
      table.index(['tenant_id']);
      table.index(['report_date']);
      table.index(['license_state']);
    });
  }

  // 2) Seed DQF requirement: mvr_data_received
  const hasRequirements = await knex.schema.hasTable('dqf_requirements');
  if (hasRequirements) {
    // Check if the category column exists (added by fn261 migration)
    const hasCategoryCol = await knex.schema.hasColumn('dqf_requirements', 'category');
    const row = {
      key: 'mvr_data_received',
      label: 'MVR Data Received',
      weight: 8
    };
    if (hasCategoryCol) {
      row.category = 'pre_hire_checklist';
    }

    await knex('dqf_requirements')
      .insert(row)
      .onConflict('key')
      .ignore();
  }
};

exports.down = async function down(knex) {
  // Remove the seeded DQF requirement
  const hasRequirements = await knex.schema.hasTable('dqf_requirements');
  if (hasRequirements) {
    await knex('dqf_requirements')
      .where('key', 'mvr_data_received')
      .del();
  }

  await knex.schema.dropTableIfExists('driver_mvr_reports');
};
