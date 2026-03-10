'use strict';

/**
 * Multi-MC foundation (Phase 2)
 *
 * Bootstraps a default tenant and operating entity, then backfills nullable scope columns
 * so existing single-company deployments continue to behave exactly as before.
 */

const DEFAULT_TENANT_NAME = 'FleetNeuron Default Tenant';
const DEFAULT_OPERATING_ENTITY_NAME = 'FleetNeuron Default Operating Entity';

const TENANT_SCOPED_TABLES = [
  'users',
  'locations',
  'customers',
  'customer_vehicles',
  'customer_audit_log',
  'drivers',
  'vehicles',
  'brokers',
  'payees',
  'parts',
  'communication_consents',
  'expense_payment_categories',
  'driver_compensation_profiles',
  'expense_responsibility_profiles',
  'driver_payee_assignments',
  'recurring_deduction_rules',
  'loads',
  'payroll_periods',
  'settlements',
  'driver_onboarding_packets',
  'imported_expense_sources',
  'work_orders',
  'invoices',
  'receiving_tickets',
  'inventory_adjustments',
  'cycle_counts',
  'inventory_transfers',
  'customer_sales'
];

const OPERATING_ENTITY_SCOPED_TABLES = [
  'loads',
  'invoices',
  'payroll_periods',
  'settlements',
  'driver_onboarding_packets'
];

async function getOrCreateDefaultTenant(knex) {
  let tenant = await knex('tenants').where({ name: DEFAULT_TENANT_NAME }).first();

  if (!tenant) {
    const inserted = await knex('tenants')
      .insert({
        name: DEFAULT_TENANT_NAME,
        legal_name: DEFAULT_TENANT_NAME,
        status: 'active'
      })
      .returning(['id', 'name']);

    tenant = Array.isArray(inserted) ? inserted[0] : inserted;
  }

  return tenant;
}

async function getOrCreateDefaultOperatingEntity(knex, tenantId) {
  let entity = await knex('operating_entities')
    .where({ tenant_id: tenantId, name: DEFAULT_OPERATING_ENTITY_NAME })
    .first();

  if (!entity) {
    const inserted = await knex('operating_entities')
      .insert({
        tenant_id: tenantId,
        entity_type: 'carrier',
        name: DEFAULT_OPERATING_ENTITY_NAME,
        legal_name: DEFAULT_OPERATING_ENTITY_NAME,
        is_active: true,
        default_currency: 'USD'
      })
      .returning(['id', 'tenant_id', 'name']);

    entity = Array.isArray(inserted) ? inserted[0] : inserted;
  }

  return entity;
}

async function backfillColumn(knex, tableName, columnName, value) {
  const hasTable = await knex.schema.hasTable(tableName);
  if (!hasTable) {
    return;
  }

  const hasColumn = await knex.schema.hasColumn(tableName, columnName);
  if (!hasColumn) {
    return;
  }

  await knex(tableName).whereNull(columnName).update({ [columnName]: value });
}

exports.up = async function up(knex) {
  const hasTenantsTable = await knex.schema.hasTable('tenants');
  const hasEntitiesTable = await knex.schema.hasTable('operating_entities');

  if (!hasTenantsTable || !hasEntitiesTable) {
    return;
  }

  const tenant = await getOrCreateDefaultTenant(knex);
  const tenantId = tenant.id;

  const entity = await getOrCreateDefaultOperatingEntity(knex, tenantId);
  const operatingEntityId = entity.id;

  for (const tableName of TENANT_SCOPED_TABLES) {
    await backfillColumn(knex, tableName, 'tenant_id', tenantId);
  }

  for (const tableName of OPERATING_ENTITY_SCOPED_TABLES) {
    await backfillColumn(knex, tableName, 'operating_entity_id', operatingEntityId);
  }

  const usersTableExists = await knex.schema.hasTable('users');
  if (!usersTableExists) {
    return;
  }

  const users = await knex('users').select('id', 'role');
  if (!users.length) {
    return;
  }

  const tenantMembershipRows = users.map((user) => ({
    user_id: user.id,
    tenant_id: tenantId,
    membership_role: user.role || 'member',
    is_default: true,
    is_active: true
  }));

  const entityAccessRows = users.map((user) => ({
    user_id: user.id,
    operating_entity_id: operatingEntityId,
    access_level: user.role || 'full',
    is_default: true,
    is_active: true
  }));

  await knex('user_tenant_memberships')
    .insert(tenantMembershipRows)
    .onConflict(['user_id', 'tenant_id'])
    .ignore();

  await knex('user_operating_entities')
    .insert(entityAccessRows)
    .onConflict(['user_id', 'operating_entity_id'])
    .ignore();
};

exports.down = async function down(knex) {
  const tenant = await knex.schema.hasTable('tenants')
    ? await knex('tenants').where({ name: DEFAULT_TENANT_NAME }).first()
    : null;

  if (!tenant) {
    return;
  }

  const entity = await knex.schema.hasTable('operating_entities')
    ? await knex('operating_entities')
        .where({ tenant_id: tenant.id, name: DEFAULT_OPERATING_ENTITY_NAME })
        .first()
    : null;

  if (entity && (await knex.schema.hasTable('user_operating_entities'))) {
    await knex('user_operating_entities').where({ operating_entity_id: entity.id }).del();
  }

  if (await knex.schema.hasTable('user_tenant_memberships')) {
    await knex('user_tenant_memberships').where({ tenant_id: tenant.id }).del();
  }

  if (entity) {
    for (const tableName of OPERATING_ENTITY_SCOPED_TABLES) {
      const hasTable = await knex.schema.hasTable(tableName);
      const hasColumn = hasTable && (await knex.schema.hasColumn(tableName, 'operating_entity_id'));
      if (hasColumn) {
        await knex(tableName).where({ operating_entity_id: entity.id }).update({ operating_entity_id: null });
      }
    }

    await knex('operating_entities').where({ id: entity.id }).del();
  }

  for (const tableName of TENANT_SCOPED_TABLES) {
    const hasTable = await knex.schema.hasTable(tableName);
    const hasColumn = hasTable && (await knex.schema.hasColumn(tableName, 'tenant_id'));
    if (hasColumn) {
      await knex(tableName).where({ tenant_id: tenant.id }).update({ tenant_id: null });
    }
  }

  await knex('tenants').where({ id: tenant.id }).del();
};
