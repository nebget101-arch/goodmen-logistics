/**
 * FN-205: Enhance drug & alcohol testing schema and add annual compliance tracking.
 *
 * Changes:
 * - Adds new columns to drug_alcohol_tests (substance_type, panel_details,
 *   collection_site, collection_date, result_date, mro_name, mro_verified,
 *   ccf_number, reported_to_clearinghouse, clearinghouse_reported_at,
 *   lab_name, notes)
 * - Creates annual_compliance_items table
 * - Seeds 9 new DQF requirements into dqf_requirements
 */

/* eslint-disable no-await-in-loop */

const NEW_DQF_KEYS = [
  'road_test_certificate',
  'nrcme_verification',
  'annual_mvr_inquiry',
  'annual_driving_record_review',
  'annual_clearinghouse_query',
  'eldt_certificate',
  'medical_variance_spe',
  'fcra_authorization',
  'psp_consent',
];

exports.up = async function up(knex) {
  const hasDrivers = await knex.schema.hasTable('drivers');
  const hasTenants = await knex.schema.hasTable('tenants');
  const hasUsers = await knex.schema.hasTable('users');
  const hasDriverDocuments = await knex.schema.hasTable('driver_documents');

  // 1) Add columns to drug_alcohol_tests
  const hasDrugTests = await knex.schema.hasTable('drug_alcohol_tests');
  if (hasDrugTests) {
    const columnsToAdd = [
      { name: 'substance_type', fn: (t) => t.text('substance_type') },
      { name: 'panel_details', fn: (t) => t.jsonb('panel_details') },
      { name: 'collection_site', fn: (t) => t.string('collection_site', 255) },
      { name: 'collection_date', fn: (t) => t.date('collection_date') },
      { name: 'result_date', fn: (t) => t.date('result_date') },
      { name: 'mro_name', fn: (t) => t.string('mro_name', 255) },
      { name: 'mro_verified', fn: (t) => t.boolean('mro_verified') },
      { name: 'ccf_number', fn: (t) => t.string('ccf_number', 100) },
      {
        name: 'reported_to_clearinghouse',
        fn: (t) => t.boolean('reported_to_clearinghouse').defaultTo(false),
      },
      {
        name: 'clearinghouse_reported_at',
        fn: (t) => t.timestamp('clearinghouse_reported_at', { useTz: true }),
      },
      { name: 'lab_name', fn: (t) => t.string('lab_name', 255) },
      { name: 'notes', fn: (t) => t.text('notes') },
    ];

    for (const col of columnsToAdd) {
      const exists = await knex.schema.hasColumn('drug_alcohol_tests', col.name);
      if (!exists) {
        await knex.schema.alterTable('drug_alcohol_tests', (table) => {
          col.fn(table);
        });
      }
    }
  }

  // 2) Create annual_compliance_items table
  const hasComplianceItems = await knex.schema.hasTable('annual_compliance_items');
  if (!hasComplianceItems) {
    await knex.schema.createTable('annual_compliance_items', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));

      const driverId = table.uuid('driver_id').notNullable();
      if (hasDrivers) {
        driverId.references('id').inTable('drivers').onDelete('CASCADE');
      }

      const tenantId = table.uuid('tenant_id').notNullable();
      if (hasTenants) {
        tenantId.references('id').inTable('tenants').onDelete('CASCADE');
      }

      table.text('compliance_type').notNullable();
      table.integer('compliance_year').notNullable();
      table.text('status').notNullable().defaultTo('pending');
      table.date('due_date').notNullable();
      table.timestamp('completed_at', { useTz: true });

      const completedBy = table.uuid('completed_by');
      if (hasUsers) {
        completedBy.references('id').inTable('users').onDelete('SET NULL');
      }

      const evidenceDocId = table.uuid('evidence_document_id');
      if (hasDriverDocuments) {
        evidenceDocId.references('id').inTable('driver_documents').onDelete('SET NULL');
      }

      table.string('reviewer_name', 255);
      table.text('review_notes');
      table.text('determination');

      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.unique(['driver_id', 'compliance_type', 'compliance_year']);
      table.index(['driver_id']);
      table.index(['tenant_id']);
      table.index(['status']);
      table.index(['due_date']);
      table.index(['compliance_year']);
    });
  }

  // 3) Seed new DQF requirements
  const hasRequirements = await knex.schema.hasTable('dqf_requirements');
  if (!hasRequirements) {
    return;
  }

  const newRequirements = [
    { key: 'road_test_certificate', label: 'Road Test Certificate (\u00A7391.31)', weight: 8 },
    { key: 'nrcme_verification', label: 'NRCME Verification (\u00A7391.51(b)(9))', weight: 5 },
    { key: 'annual_mvr_inquiry', label: 'Annual MVR Inquiry (\u00A7391.25)', weight: 8 },
    { key: 'annual_driving_record_review', label: 'Annual Driving Record Review (\u00A7391.25)', weight: 8 },
    { key: 'annual_clearinghouse_query', label: 'Annual Clearinghouse Limited Query (\u00A7382.701)', weight: 8 },
    { key: 'eldt_certificate', label: 'Entry-Level Driver Training Certificate (\u00A7380.509)', weight: 3 },
    { key: 'medical_variance_spe', label: 'Medical Variance/SPE Certificate (\u00A7391.49)', weight: 3 },
    { key: 'fcra_authorization', label: 'FCRA Background Check Authorization', weight: 5 },
    { key: 'psp_consent', label: 'PSP Report Consent', weight: 3 },
  ];

  for (const r of newRequirements) {
    await knex('dqf_requirements')
      .insert(r)
      .onConflict('key')
      .ignore();
  }
};

exports.down = async function down(knex) {
  // 1) Delete seeded DQF requirements
  const hasRequirements = await knex.schema.hasTable('dqf_requirements');
  if (hasRequirements) {
    await knex('dqf_requirements').whereIn('key', NEW_DQF_KEYS).del();
  }

  // 2) Drop annual_compliance_items table
  await knex.schema.dropTableIfExists('annual_compliance_items');

  // 3) Remove added columns from drug_alcohol_tests
  const hasDrugTests = await knex.schema.hasTable('drug_alcohol_tests');
  if (hasDrugTests) {
    const columnsToRemove = [
      'substance_type',
      'panel_details',
      'collection_site',
      'collection_date',
      'result_date',
      'mro_name',
      'mro_verified',
      'ccf_number',
      'reported_to_clearinghouse',
      'clearinghouse_reported_at',
      'lab_name',
      'notes',
    ];

    for (const col of columnsToRemove) {
      const exists = await knex.schema.hasColumn('drug_alcohol_tests', col);
      if (exists) {
        await knex.schema.alterTable('drug_alcohol_tests', (table) => {
          table.dropColumn(col);
        });
      }
    }
  }
};
