'use strict';

/**
 * Create fmcsa_scrape_jobs — audit log of scrape job executions.
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('fmcsa_scrape_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('job_type').notNullable(); // daily_scrape, manual_trigger, single_carrier
    t.text('status').notNullable().defaultTo('queued'); // queued, running, completed, failed
    t.integer('total_carriers').notNullable().defaultTo(0);
    t.integer('completed_count').notNullable().defaultTo(0);
    t.integer('failed_count').notNullable().defaultTo(0);
    t.timestamp('started_at', { useTz: true }).nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.text('error_message').nullable();
    t.uuid('triggered_by').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    'CREATE INDEX idx_fmcsa_jobs_status ON fmcsa_scrape_jobs (status, created_at DESC)'
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('fmcsa_scrape_jobs');
};
