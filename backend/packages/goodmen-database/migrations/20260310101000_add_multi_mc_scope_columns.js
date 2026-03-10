'use strict';

/**
 * Multi-MC foundation (Phase 2)
 *
 * Adds nullable scope columns to existing business tables.
 *
 * Design rules:
 * - `tenant_id` is added broadly to root and independently queried business tables.
 * - `operating_entity_id` is added only to selected operational roots that can belong
 *   to a specific MC / company entity today without duplicating master data.
 * - Child/detail tables intentionally inherit scope from their parent/root table for now.
 *
 * Deferred to later phases:
 * - NOT NULL enforcement after all writes are context-aware
 * - effective-dated assignment bridge tables for drivers / vehicles / equipment
 * - entity scoping on child tables that later prove to require direct independent filtering
 */

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

async function addScopedColumn(knex, tableName, columnName, referencedTable, indexName) {
  const hasTable = await knex.schema.hasTable(tableName);
  if (!hasTable) {
    return;
  }

  const hasColumn = await knex.schema.hasColumn(tableName, columnName);
  if (!hasColumn) {
    await knex.schema.alterTable(tableName, (table) => {
      table
        .uuid(columnName)
        .nullable()
        .references('id')
        .inTable(referencedTable)
        .onDelete('RESTRICT');
    });
  }

  await knex.raw(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columnName})`);
}

exports.up = async function up(knex) {
  for (const tableName of TENANT_SCOPED_TABLES) {
    await addScopedColumn(knex, tableName, 'tenant_id', 'tenants', `idx_${tableName}_tenant_id`);
  }

  for (const tableName of OPERATING_ENTITY_SCOPED_TABLES) {
    await addScopedColumn(
      knex,
      tableName,
      'operating_entity_id',
      'operating_entities',
      `idx_${tableName}_operating_entity_id`
    );
  }

  for (const tableName of OPERATING_ENTITY_SCOPED_TABLES) {
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) {
      continue;
    }

    const hasTenantId = await knex.schema.hasColumn(tableName, 'tenant_id');
    const hasOperatingEntityId = await knex.schema.hasColumn(tableName, 'operating_entity_id');
    if (!hasTenantId || !hasOperatingEntityId) {
      continue;
    }

    await knex.raw(
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_tenant_operating_entity ON ${tableName}(tenant_id, operating_entity_id)`
    );
  }
};

exports.down = async function down(knex) {
  for (const tableName of OPERATING_ENTITY_SCOPED_TABLES.slice().reverse()) {
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) {
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(tableName, 'operating_entity_id');
    if (!hasColumn) {
      continue;
    }

    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('operating_entity_id');
    });
  }

  for (const tableName of TENANT_SCOPED_TABLES.slice().reverse()) {
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) {
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(tableName, 'tenant_id');
    if (!hasColumn) {
      continue;
    }

    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('tenant_id');
    });
  }
};
