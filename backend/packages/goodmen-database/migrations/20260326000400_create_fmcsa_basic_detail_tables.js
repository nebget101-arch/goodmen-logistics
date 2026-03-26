'use strict';

/**
 * Create tables for SMS BASIC detail page data:
 * - fmcsa_basic_details: per-BASIC measure, safety event group, investigation results
 * - fmcsa_basic_measures_history: carrier measure over time data points
 * - fmcsa_violations: violation summary records
 * - fmcsa_inspection_history: individual inspection records with violations
 */

exports.up = async function up(knex) {
  // 1. BASIC detail records — one row per BASIC category per snapshot
  await knex.schema.createTable('fmcsa_basic_details', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('monitored_carrier_id').notNullable()
      .references('id').inTable('fmcsa_monitored_carriers').onDelete('CASCADE');
    t.text('basic_name').notNullable(); // e.g. 'UnsafeDriving', 'HOSCompliance'
    t.decimal('measure_value', 10, 4).nullable(); // e.g. 2.44
    t.integer('percentile').nullable(); // 0-100
    t.integer('threshold').nullable(); // intervention threshold
    t.text('safety_event_group').nullable(); // e.g. "3-8 driver inspections with..."
    t.integer('acute_critical_violations').nullable().defaultTo(0);
    t.text('investigation_results_text').nullable(); // raw text
    t.text('record_period').nullable(); // e.g. "24 months ending February 27, 2026"
    t.timestamp('scraped_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.jsonb('raw_json').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    'CREATE INDEX idx_fmcsa_basic_details_carrier ON fmcsa_basic_details (monitored_carrier_id, basic_name, scraped_at DESC)'
  );

  // 2. Carrier measure over time — monthly data points per BASIC
  await knex.schema.createTable('fmcsa_basic_measures_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('basic_detail_id').notNullable()
      .references('id').inTable('fmcsa_basic_details').onDelete('CASCADE');
    t.date('snapshot_date').notNullable(); // e.g. 2025-09-26
    t.decimal('measure_value', 10, 4).nullable();
    t.decimal('history_value', 10, 4).nullable(); // the "History" line value
    t.text('release_type').nullable(); // M, Q, S (Monthly, Quarterly, Semi-Annual)
    t.integer('release_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    'CREATE INDEX idx_fmcsa_measures_hist_detail ON fmcsa_basic_measures_history (basic_detail_id, snapshot_date)'
  );

  // 3. Violation summary records per BASIC
  await knex.schema.createTable('fmcsa_violations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('basic_detail_id').notNullable()
      .references('id').inTable('fmcsa_basic_details').onDelete('CASCADE');
    t.text('violation_code').nullable(); // e.g. "392.16-D"
    t.text('description').nullable();
    t.integer('violation_count').nullable();
    t.integer('oos_violation_count').nullable();
    t.integer('severity_weight').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    'CREATE INDEX idx_fmcsa_violations_detail ON fmcsa_violations (basic_detail_id)'
  );

  // 4. Inspection history records per BASIC (with inline violation rows)
  await knex.schema.createTable('fmcsa_inspection_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('basic_detail_id').notNullable()
      .references('id').inTable('fmcsa_basic_details').onDelete('CASCADE');
    t.date('inspection_date').nullable();
    t.text('report_number').nullable();
    t.text('report_state').nullable();
    t.text('plate_number').nullable();
    t.text('plate_state').nullable();
    t.text('vehicle_type').nullable();
    t.integer('severity_weight').nullable();
    t.integer('time_weight').nullable();
    t.integer('total_weight').nullable();
    t.jsonb('violations').nullable(); // array of { code, description, weight }
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    'CREATE INDEX idx_fmcsa_insp_hist_detail ON fmcsa_inspection_history (basic_detail_id, inspection_date DESC)'
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('fmcsa_inspection_history');
  await knex.schema.dropTableIfExists('fmcsa_violations');
  await knex.schema.dropTableIfExists('fmcsa_basic_measures_history');
  await knex.schema.dropTableIfExists('fmcsa_basic_details');
};
