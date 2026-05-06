'use strict';

/**
 * FN-1417: Create the `fmcsa` schema and skeleton tables for the FMCSA
 * reference dataset (carriers, authorities, inspections, violations, crashes,
 * BASIC scores, and import-run audit log).
 *
 * Phase 1 of FN-1411 (FMCSA reference dataset) — this story stands up the
 * schema and accessor; later stories (FN-1413/FN-1414/FN-1415) populate it
 * from FMCSA SAFER snapshot files.
 *
 * Indexes (per acceptance criteria):
 *   - GIN trigram on fmcsa.carriers.legal_name, fmcsa.carriers.dba_name
 *   - b-tree on fmcsa.carriers.mc_number
 *   - b-tree on fmcsa.inspections.dot, fmcsa.inspections.inspection_date
 *   - b-tree on fmcsa.crashes.dot
 */

const SCHEMA = 'fmcsa';

exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await knex.raw(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);

  // fmcsa.carriers — DOT-keyed master record
  await knex.schema.withSchema(SCHEMA).createTable('carriers', (t) => {
    t.bigInteger('dot').primary();
    t.text('mc_number').nullable();
    t.text('mx_number').nullable();
    t.text('ff_number').nullable();
    t.text('legal_name').nullable();
    t.text('dba_name').nullable();
    t.text('address_line1').nullable();
    t.text('address_line2').nullable();
    t.text('city').nullable();
    t.text('state').nullable();
    t.text('zip_code').nullable();
    t.text('country').nullable();
    t.text('phone').nullable();
    t.text('fax').nullable();
    t.text('email').nullable();
    t.integer('power_units').nullable();
    t.integer('drivers').nullable();
    t.bigInteger('mileage').nullable();
    t.integer('mileage_year').nullable();
    t.boolean('hazmat_flag').notNullable().defaultTo(false);
    t.boolean('passenger_flag').notNullable().defaultTo(false);
    t.text('operation_classification').nullable();
    t.text('status').nullable();
    t.timestamp('fmcsa_synced_at', { useTz: true }).nullable();
    t.timestamps(true, true);
  });

  // fmcsa.authorities — composite PK (dot, mc_number, authority_type)
  await knex.schema.withSchema(SCHEMA).createTable('authorities', (t) => {
    t.bigInteger('dot').notNullable();
    t.text('mc_number').notNullable();
    t.text('authority_type').notNullable();
    t.text('status').nullable();
    t.timestamp('authority_status_changed_at', { useTz: true }).nullable();
    t.jsonb('insurance_carriers').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    t.jsonb('insurance_amounts').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    t.timestamp('fmcsa_synced_at', { useTz: true }).nullable();
    t.timestamps(true, true);
    t.primary(['dot', 'mc_number', 'authority_type']);
  });

  // fmcsa.inspections — inspection_report_number is the natural PK
  await knex.schema.withSchema(SCHEMA).createTable('inspections', (t) => {
    t.text('inspection_report_number').primary();
    t.bigInteger('dot').notNullable();
    t.date('inspection_date').notNullable();
    t.text('state').nullable();
    t.integer('level').nullable();
    t.integer('vehicle_count').notNullable().defaultTo(0);
    t.integer('driver_count').notNullable().defaultTo(0);
    t.integer('hazmat_count').notNullable().defaultTo(0);
    t.integer('vehicle_oos_count').notNullable().defaultTo(0);
    t.integer('driver_oos_count').notNullable().defaultTo(0);
    t.integer('hazmat_oos_count').notNullable().defaultTo(0);
    t.integer('severity_weight').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  // fmcsa.violations — composite PK (inspection_report_number, violation_code, sequence)
  await knex.schema.withSchema(SCHEMA).createTable('violations', (t) => {
    t.text('inspection_report_number').notNullable();
    t.text('violation_code').notNullable();
    t.integer('sequence').notNullable();
    t.text('description').nullable();
    t.boolean('oos_flag').notNullable().defaultTo(false);
    t.integer('severity_weight').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.primary(['inspection_report_number', 'violation_code', 'sequence']);
    t.foreign('inspection_report_number')
      .references('inspection_report_number')
      .inTable(`${SCHEMA}.inspections`)
      .onDelete('CASCADE');
  });

  // fmcsa.crashes — crash_report_number PK
  await knex.schema.withSchema(SCHEMA).createTable('crashes', (t) => {
    t.text('crash_report_number').primary();
    t.bigInteger('dot').notNullable();
    t.date('crash_date').notNullable();
    t.text('state').nullable();
    t.boolean('fatal_flag').notNullable().defaultTo(false);
    t.boolean('injury_flag').notNullable().defaultTo(false);
    t.boolean('tow_flag').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  // fmcsa.basic_scores — composite PK (dot, basic, computed_at)
  await knex.schema.withSchema(SCHEMA).createTable('basic_scores', (t) => {
    t.bigInteger('dot').notNullable();
    t.text('basic').notNullable();
    t.timestamp('computed_at', { useTz: true }).notNullable();
    t.decimal('measure_value', 12, 4).nullable();
    t.decimal('percentile', 6, 3).nullable();
    t.text('safety_event_group').nullable();
    t.timestamps(true, true);
    t.primary(['dot', 'basic', 'computed_at']);
  });

  // fmcsa.import_runs — audit log for FMCSA import jobs
  await knex.schema.withSchema(SCHEMA).createTable('import_runs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.text('file').notNullable();
    t.text('triggered_by').notNullable();
    t.uuid('triggered_by_user_id').nullable();
    t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('finished_at', { useTz: true }).nullable();
    t.text('status').notNullable().defaultTo('running');
    t.integer('rows_inserted').notNullable().defaultTo(0);
    t.integer('rows_updated').notNullable().defaultTo(0);
    t.integer('rows_skipped').notNullable().defaultTo(0);
    t.text('error_message').nullable();
    t.timestamps(true, true);
  });

  // CHECK constraints for enum-like columns on import_runs
  await knex.raw(`
    ALTER TABLE ${SCHEMA}.import_runs
    ADD CONSTRAINT import_runs_file_check
    CHECK (file IN ('census', 'authority', 'inspections', 'crashes', 'sms'))
  `);
  await knex.raw(`
    ALTER TABLE ${SCHEMA}.import_runs
    ADD CONSTRAINT import_runs_triggered_by_check
    CHECK (triggered_by IN ('manual', 'cron'))
  `);

  // Indexes (acceptance criteria)
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS carriers_legal_name_trgm_idx
       ON ${SCHEMA}.carriers USING gin (legal_name gin_trgm_ops)`
  );
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS carriers_dba_name_trgm_idx
       ON ${SCHEMA}.carriers USING gin (dba_name gin_trgm_ops)`
  );
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS carriers_mc_number_idx
       ON ${SCHEMA}.carriers (mc_number)`
  );
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS inspections_dot_idx
       ON ${SCHEMA}.inspections (dot)`
  );
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS inspections_inspection_date_idx
       ON ${SCHEMA}.inspections (inspection_date)`
  );
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS crashes_dot_idx
       ON ${SCHEMA}.crashes (dot)`
  );
};

exports.down = async function down(knex) {
  // Drop schema CASCADE removes tables, indexes, constraints in one shot.
  // Extensions (pg_trgm, uuid-ossp) are intentionally left in place because
  // other parts of the app rely on them.
  await knex.raw(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
};
