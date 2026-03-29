'use strict';

/**
 * Create fmcsa_safety_snapshots — stores each scrape result as a point-in-time
 * record of SMS scores, licensing, insurance, and carrier info.
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('fmcsa_safety_snapshots', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('monitored_carrier_id').notNullable()
      .references('id').inTable('fmcsa_monitored_carriers').onDelete('CASCADE');
    t.timestamp('scraped_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('source').notNullable().defaultTo('safer_website');

    // SMS BASIC Scores (percentiles 0-100)
    t.decimal('unsafe_driving_score', 5, 1).nullable();
    t.decimal('hos_compliance_score', 5, 1).nullable();
    t.decimal('vehicle_maintenance_score', 5, 1).nullable();
    t.decimal('controlled_substances_score', 5, 1).nullable();
    t.decimal('driver_fitness_score', 5, 1).nullable();
    t.decimal('crash_indicator_score', 5, 1).nullable();
    t.decimal('hazmat_score', 5, 1).nullable();

    // Licensing / Operating Authority
    t.text('operating_status').nullable();
    t.text('authority_common').nullable();
    t.text('authority_contract').nullable();
    t.text('authority_broker').nullable();

    // Insurance
    t.text('bipd_insurance_required').nullable();
    t.text('bipd_insurance_on_file').nullable();
    t.text('cargo_insurance_required').nullable();
    t.text('cargo_insurance_on_file').nullable();
    t.text('bond_insurance_required').nullable();
    t.text('bond_insurance_on_file').nullable();

    // Carrier Info
    t.text('safety_rating').nullable();
    t.date('safety_rating_date').nullable();
    t.integer('total_drivers').nullable();
    t.integer('total_power_units').nullable();
    t.integer('mcs150_mileage').nullable();
    t.integer('mcs150_mileage_year').nullable();
    t.date('out_of_service_date').nullable();

    // Raw data for re-parsing
    t.jsonb('raw_json').nullable();

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    'CREATE INDEX idx_fmcsa_snapshots_carrier_date ON fmcsa_safety_snapshots (monitored_carrier_id, scraped_at DESC)'
  );
  await knex.schema.raw(
    'CREATE INDEX idx_fmcsa_snapshots_scraped_at ON fmcsa_safety_snapshots (scraped_at DESC)'
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('fmcsa_safety_snapshots');
};
