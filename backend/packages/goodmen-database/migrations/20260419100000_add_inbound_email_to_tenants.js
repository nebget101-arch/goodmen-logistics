'use strict';

/**
 * FN-759 — Email-to-Load: Add inbound_email_address to tenants.
 *
 * Adds a unique, nullable inbound email address per tenant, and backfills
 * existing tenants with an address of the form `loads-<slug>@inbound.fleetneuron.ai`
 * where <slug> is derived from the tenant name (with an id-suffix to guarantee
 * uniqueness across tenants that might slugify to the same value).
 */

const INBOUND_DOMAIN = 'inbound.fleetneuron.ai';

function slugifyName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function buildAddress(name, id) {
  const base = slugifyName(name) || 'tenant';
  const suffix = String(id).replace(/-/g, '').slice(0, 8);
  return `loads-${base}-${suffix}@${INBOUND_DOMAIN}`;
}

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('tenants', 'inbound_email_address');
  if (!hasColumn) {
    await knex.schema.alterTable('tenants', (table) => {
      table.text('inbound_email_address').nullable();
    });
    await knex.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_inbound_email_address ' +
        'ON tenants (inbound_email_address) WHERE inbound_email_address IS NOT NULL'
    );
  }

  const tenants = await knex('tenants')
    .select('id', 'name')
    .whereNull('inbound_email_address');

  for (const tenant of tenants) {
    const address = buildAddress(tenant.name, tenant.id);
    await knex('tenants')
      .where({ id: tenant.id })
      .update({ inbound_email_address: address });
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('tenants');
  if (!hasTable) return;

  await knex.raw('DROP INDEX IF EXISTS uq_tenants_inbound_email_address');

  const hasColumn = await knex.schema.hasColumn('tenants', 'inbound_email_address');
  if (hasColumn) {
    await knex.schema.alterTable('tenants', (table) => {
      table.dropColumn('inbound_email_address');
    });
  }
};
