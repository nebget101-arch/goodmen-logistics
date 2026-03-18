'use strict';

/**
 * FN-72: Add trial and Stripe columns to tenants
 * Adds trial_start, trial_end, trial_status, stripe_customer_id, stripe_payment_method_id, stripe_subscription_id
 * - All columns nullable
 * - Unique indexes on stripe_customer_id and stripe_subscription_id (where not null)
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  await knex.schema.alterTable('tenants', (table) => {
    table.timestamp('trial_start', { useTz: true }).nullable();
    table.timestamp('trial_end', { useTz: true }).nullable();
    table.string('trial_status', 20).nullable(); // active, expired, converted
    table.text('stripe_customer_id').nullable();
    table.text('stripe_payment_method_id').nullable();
    table.text('stripe_subscription_id').nullable();
  });

  // Unique indexes (where not null)
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_stripe_customer_id_not_null ON tenants(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL');
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_stripe_subscription_id_not_null ON tenants(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL');
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  // Drop indexes first
  await knex.raw('DROP INDEX IF EXISTS uq_tenants_stripe_customer_id_not_null');
  await knex.raw('DROP INDEX IF EXISTS uq_tenants_stripe_subscription_id_not_null');

  await knex.schema.alterTable('tenants', (table) => {
    table.dropColumn('trial_start');
    table.dropColumn('trial_end');
    table.dropColumn('trial_status');
    table.dropColumn('stripe_customer_id');
    table.dropColumn('stripe_payment_method_id');
    table.dropColumn('stripe_subscription_id');
  });
};
