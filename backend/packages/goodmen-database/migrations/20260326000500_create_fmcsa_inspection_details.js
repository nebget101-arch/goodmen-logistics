'use strict';

/**
 * Create fmcsa_inspection_details — stores full detailed inspection reports
 * scraped from /SMS/Event/Inspection/{id}.aspx pages.
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('fmcsa_inspection_details', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('monitored_carrier_id').notNullable()
      .references('id').inTable('fmcsa_monitored_carriers').onDelete('CASCADE');
    t.text('inspection_id').notNullable(); // FMCSA internal ID (e.g. 85837168)
    t.text('report_number').nullable();
    t.text('report_state').nullable();
    t.text('state').nullable();
    t.date('inspection_date').nullable();
    t.text('start_time').nullable();
    t.text('end_time').nullable();
    t.text('level').nullable(); // e.g. "III. Driver-Only"
    t.text('facility').nullable(); // e.g. "Roadside", "Fixed Site"
    t.text('post_crash').nullable();
    t.text('hazmat_placard').nullable();
    t.jsonb('vehicles').nullable(); // array of { unit, type, make, plate_state, plate_number, vin }
    t.jsonb('violations').nullable(); // array of { vio_code, section, unit, oos, description, included_in_sms, basic, reason_not_included }
    t.timestamp('scraped_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    'CREATE UNIQUE INDEX idx_fmcsa_insp_details_insp_id ON fmcsa_inspection_details (inspection_id)'
  );
  await knex.schema.raw(
    'CREATE INDEX idx_fmcsa_insp_details_carrier ON fmcsa_inspection_details (monitored_carrier_id, inspection_date DESC)'
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('fmcsa_inspection_details');
};
