'use strict';

/**
 * FN-134: Track purchased user seats above plan includedUsers (Stripe subscription add-on).
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  await knex.schema.alterTable('tenants', (table) => {
    table.integer('extra_paid_seats').notNullable().defaultTo(0);
    table.text('stripe_extra_seats_subscription_item_id').nullable();
  });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  await knex.schema.alterTable('tenants', (table) => {
    table.dropColumn('extra_paid_seats');
    table.dropColumn('stripe_extra_seats_subscription_item_id');
  });
};
