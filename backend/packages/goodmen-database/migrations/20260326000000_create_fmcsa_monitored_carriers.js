'use strict';

/**
 * Create fmcsa_monitored_carriers — platform-level table of carriers
 * whose FMCSA SAFER data is periodically scraped.
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('fmcsa_monitored_carriers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('dot_number').notNullable().unique();
    t.text('mc_number').nullable();
    t.text('legal_name').nullable();
    t.text('dba_name').nullable();
    t.boolean('monitoring_active').notNullable().defaultTo(true);
    t.text('source').notNullable().defaultTo('operating_entity'); // operating_entity | manual
    t.uuid('created_by').nullable();
    t.timestamps(true, true);
  });

  await knex.schema.raw(
    'CREATE INDEX idx_fmcsa_carriers_active ON fmcsa_monitored_carriers (monitoring_active) WHERE monitoring_active = true'
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('fmcsa_monitored_carriers');
};
