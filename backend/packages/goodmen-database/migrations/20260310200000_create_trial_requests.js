'use strict';

/**
 * Creates the trial_requests table for marketing website lead capture.
 * Records submitted free trial requests from the public-facing website.
 */
exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  if (!(await knex.schema.hasTable('trial_requests'))) {
    await knex.schema.createTable('trial_requests', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.text('company_name').notNullable();
      table.text('contact_name').notNullable();
      table.text('email').notNullable();
      table.text('phone').notNullable();
      table.text('fleet_size').nullable();
      table.text('current_system').nullable();
      // basic | multi_mc | end_to_end
      table.text('requested_plan').notNullable().defaultTo('basic');
      table.boolean('wants_demo_assistance').notNullable().defaultTo(false);
      table.text('notes').nullable();
      // e.g. marketing_website, referral, direct
      table.text('source').notNullable().defaultTo('marketing_website');
      // new | contacted | approved | rejected | converted | trial_created
      table.text('status').notNullable().defaultTo('new');
      table.timestamps(true, true);
    });

    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_trial_requests_status ON trial_requests(status)'
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_trial_requests_email ON trial_requests(email)'
    );
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS idx_trial_requests_created_at ON trial_requests(created_at DESC)'
    );
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('trial_requests');
};
