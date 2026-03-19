'use strict';

exports.up = async function up(knex) {
  const hasTrialRequests = await knex.schema.hasTable('trial_requests');
  if (hasTrialRequests) {
    const hasDot = await knex.schema.hasColumn('trial_requests', 'dot_number');
    const hasMc = await knex.schema.hasColumn('trial_requests', 'mc_number');

    if (!hasDot || !hasMc) {
      await knex.schema.alterTable('trial_requests', (table) => {
        if (!hasDot) table.string('dot_number', 20).nullable();
        if (!hasMc) table.string('mc_number', 20).nullable();
      });
    }

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_trial_requests_dot ON trial_requests(dot_number)');
  }

  const hasTenants = await knex.schema.hasTable('tenants');
  if (hasTenants) {
    const tenantHasDot = await knex.schema.hasColumn('tenants', 'dot_number');
    const tenantHasMc = await knex.schema.hasColumn('tenants', 'mc_number');

    if (!tenantHasDot || !tenantHasMc) {
      await knex.schema.alterTable('tenants', (table) => {
        if (!tenantHasDot) table.string('dot_number', 20).nullable();
        if (!tenantHasMc) table.string('mc_number', 20).nullable();
      });
    }
  }
};

exports.down = async function down(knex) {
  const hasTrialRequests = await knex.schema.hasTable('trial_requests');
  if (hasTrialRequests) {
    await knex.raw('DROP INDEX IF EXISTS idx_trial_requests_dot');

    const hasDot = await knex.schema.hasColumn('trial_requests', 'dot_number');
    const hasMc = await knex.schema.hasColumn('trial_requests', 'mc_number');

    if (hasDot || hasMc) {
      await knex.schema.alterTable('trial_requests', (table) => {
        if (hasDot) table.dropColumn('dot_number');
        if (hasMc) table.dropColumn('mc_number');
      });
    }
  }

  const hasTenants = await knex.schema.hasTable('tenants');
  if (hasTenants) {
    const tenantHasDot = await knex.schema.hasColumn('tenants', 'dot_number');
    const tenantHasMc = await knex.schema.hasColumn('tenants', 'mc_number');

    if (tenantHasDot || tenantHasMc) {
      await knex.schema.alterTable('tenants', (table) => {
        if (tenantHasDot) table.dropColumn('dot_number');
        if (tenantHasMc) table.dropColumn('mc_number');
      });
    }
  }
};
