'use strict';

/**
 * FN-477: Create mvr_extracted_records table for storing AI-extracted MVR data.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('mvr_extracted_records'))) {
    await knex.schema.createTable('mvr_extracted_records', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('tenant_id').notNullable();
      t.uuid('driver_id').notNullable().references('id').inTable('drivers').onDelete('CASCADE');
      t.uuid('document_id').nullable(); // FK to DQF document upload
      t.text('report_source').notNullable().defaultTo('mvr'); // mvr, psp
      t.date('report_date').nullable();
      t.integer('report_period_years').nullable();
      // Driver info from report
      t.text('license_number').nullable();
      t.text('license_state').nullable();
      t.text('license_class').nullable();
      t.text('license_status').nullable();
      t.jsonb('endorsements').nullable();
      t.jsonb('restrictions').nullable();
      // Extracted records
      t.jsonb('moving_violations').nullable();
      t.jsonb('accidents').nullable();
      t.jsonb('suspensions').nullable();
      // Risk assessment from AI
      t.integer('total_violations').notNullable().defaultTo(0);
      t.integer('total_accidents').notNullable().defaultTo(0);
      t.integer('total_suspensions').notNullable().defaultTo(0);
      t.integer('major_violations_count').notNullable().defaultTo(0);
      t.jsonb('red_flags').nullable();
      t.text('risk_level').notNullable().defaultTo('low'); // low, medium, high, critical
      t.text('hire_recommendation').nullable(); // recommend, caution, decline
      t.text('hire_recommendation_reason').nullable();
      t.decimal('ai_confidence', 5, 4).nullable();
      t.jsonb('ai_warnings').nullable();
      t.integer('ai_processing_time_ms').nullable();
      t.timestamps(true, true);
    });
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_mvr_records_tenant ON mvr_extracted_records(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_mvr_records_driver ON mvr_extracted_records(driver_id)');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_mvr_records_doc ON mvr_extracted_records(document_id) WHERE document_id IS NOT NULL');
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('mvr_extracted_records');
};
