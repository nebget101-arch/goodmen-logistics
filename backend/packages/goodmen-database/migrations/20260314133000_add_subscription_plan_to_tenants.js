'use strict';

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('tenants', 'subscription_plan');
  if (!hasColumn) {
    await knex.schema.alterTable('tenants', (table) => {
      table.text('subscription_plan').nullable();
    });
  }

  await knex('tenants')
    .whereNull('subscription_plan')
    .update({ subscription_plan: 'end_to_end' });

  await knex.raw("ALTER TABLE tenants ALTER COLUMN subscription_plan SET DEFAULT 'end_to_end'");
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_tenants_subscription_plan ON tenants(subscription_plan)');
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  await knex.raw('DROP INDEX IF EXISTS idx_tenants_subscription_plan');

  const hasColumn = await knex.schema.hasColumn('tenants', 'subscription_plan');
  if (hasColumn) {
    await knex.schema.alterTable('tenants', (table) => {
      table.dropColumn('subscription_plan');
    });
  }
};
