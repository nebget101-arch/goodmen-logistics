'use strict';

const TABLE_RENAMES = [
  ['customers', 'shop_clients']
];

const COLUMN_RENAMES = [
  ['customer_notes', 'customer_id', 'shop_client_id'],
  ['customer_pricing_rules', 'customer_id', 'shop_client_id'],
  ['customer_audit_log', 'customer_id', 'shop_client_id'],
  ['customer_credit_balance', 'customer_id', 'shop_client_id'],
  ['customer_credit_transactions', 'customer_id', 'shop_client_id'],
  ['customer_vehicles', 'customer_id', 'shop_client_id'],
  ['work_orders', 'customer_id', 'shop_client_id'],
  ['invoices', 'customer_id', 'shop_client_id'],
  ['direct_sales', 'customer_id', 'shop_client_id']
];

const INDEX_RENAMES = [
  ['idx_customers_type_status', 'idx_shop_clients_type_status'],
  ['idx_customers_default_location', 'idx_shop_clients_default_location'],
  ['uniq_customers_company_name_active', 'uniq_shop_clients_company_name_active'],
  ['idx_customer_notes_customer_created', 'idx_customer_notes_shop_client_created'],
  ['idx_customer_audit_customer_changed', 'idx_customer_audit_shop_client_changed'],
  ['idx_customer_credit_tx_customer', 'idx_customer_credit_tx_shop_client'],
  ['idx_customer_vehicles_customer', 'idx_customer_vehicles_shop_client'],
  ['idx_invoices_customer_status', 'idx_invoices_shop_client_status']
];

const CONSTRAINT_RENAMES = [
  ['customer_notes_customer_id_foreign', 'customer_notes_shop_client_id_foreign'],
  ['customer_pricing_rules_customer_id_foreign', 'customer_pricing_rules_shop_client_id_foreign'],
  ['customer_pricing_rules_customer_id_unique', 'customer_pricing_rules_shop_client_id_unique'],
  ['customer_audit_log_customer_id_foreign', 'customer_audit_log_shop_client_id_foreign'],
  ['customer_credit_balance_customer_id_foreign', 'customer_credit_balance_shop_client_id_foreign'],
  ['customer_credit_balance_customer_id_unique', 'customer_credit_balance_shop_client_id_unique'],
  ['customer_credit_transactions_customer_id_foreign', 'customer_credit_transactions_shop_client_id_foreign'],
  ['customer_vehicles_customer_id_foreign', 'customer_vehicles_shop_client_id_foreign'],
  ['work_orders_customer_id_foreign', 'work_orders_shop_client_id_foreign'],
  ['invoices_customer_id_foreign', 'invoices_shop_client_id_foreign'],
  ['direct_sales_customer_id_foreign', 'direct_sales_shop_client_id_foreign']
];

const CONSTRAINT_TABLES = {
  customer_notes_customer_id_foreign: 'customer_notes',
  customer_pricing_rules_customer_id_foreign: 'customer_pricing_rules',
  customer_pricing_rules_customer_id_unique: 'customer_pricing_rules',
  customer_audit_log_customer_id_foreign: 'customer_audit_log',
  customer_credit_balance_customer_id_foreign: 'customer_credit_balance',
  customer_credit_balance_customer_id_unique: 'customer_credit_balance',
  customer_credit_transactions_customer_id_foreign: 'customer_credit_transactions',
  customer_vehicles_customer_id_foreign: 'customer_vehicles',
  work_orders_customer_id_foreign: 'work_orders',
  invoices_customer_id_foreign: 'invoices',
  direct_sales_customer_id_foreign: 'direct_sales'
};

async function hasTable(knex, tableName) {
  return knex.schema.hasTable(tableName);
}

async function hasColumn(knex, tableName, columnName) {
  return knex.schema.hasColumn(tableName, columnName);
}

async function renameIndexIfExists(knex, oldName, newName) {
  const result = await knex.raw(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?`,
    [oldName]
  );
  if (result.rows.length) {
    await knex.raw(`ALTER INDEX ?? RENAME TO ??`, [oldName, newName]);
  }
}

async function renameConstraintIfExists(knex, tableName, oldName, newName) {
  const result = await knex.raw(
    `SELECT 1
     FROM information_schema.table_constraints
     WHERE table_schema = current_schema()
       AND table_name = ?
       AND constraint_name = ?`,
    [tableName, oldName]
  );
  if (result.rows.length) {
    await knex.raw(`ALTER TABLE ?? RENAME CONSTRAINT ?? TO ??`, [tableName, oldName, newName]);
  }
}

async function renameViewDefinitions(knex, fromColumn, toColumn, fromTable, toTable) {
  const views = ['all_vehicles'];
  for (const viewName of views) {
    const exists = await knex.raw(
      `SELECT 1 FROM information_schema.views WHERE table_schema = current_schema() AND table_name = ?`,
      [viewName]
    );
    if (!exists.rows.length) continue;
    const definitionResult = await knex.raw(
      `SELECT definition FROM pg_views WHERE schemaname = current_schema() AND viewname = ?`,
      [viewName]
    );
    const definition = definitionResult.rows[0]?.definition;
    if (!definition || !definition.includes(fromColumn)) continue;
    await knex.raw(`DROP VIEW IF EXISTS ??`, [viewName]);
    await knex.raw(
      `CREATE VIEW ?? AS ${definition.replaceAll(fromColumn, toColumn).replaceAll(fromTable, toTable)}`,
      [viewName]
    );
  }
}

exports.up = async function up(knex) {
  for (const [from, to] of TABLE_RENAMES) {
    if (await hasTable(knex, from) && !(await hasTable(knex, to))) {
      await knex.raw('ALTER TABLE ?? RENAME TO ??', [from, to]);
    }
  }

  for (const [tableName, fromColumn, toColumn] of COLUMN_RENAMES) {
    if (await hasTable(knex, tableName) && await hasColumn(knex, tableName, fromColumn) && !(await hasColumn(knex, tableName, toColumn))) {
      await knex.raw('ALTER TABLE ?? RENAME COLUMN ?? TO ??', [tableName, fromColumn, toColumn]);
    }
  }

  for (const [oldName, newName] of INDEX_RENAMES) {
    await renameIndexIfExists(knex, oldName, newName);
  }

  for (const [oldName, newName] of CONSTRAINT_RENAMES) {
    const tableName = CONSTRAINT_TABLES[oldName];
    if (tableName && await hasTable(knex, tableName)) {
      await renameConstraintIfExists(knex, tableName, oldName, newName);
    }
  }

  await renameViewDefinitions(knex, 'customer_id', 'shop_client_id', 'customers', 'shop_clients');
};

exports.down = async function down(knex) {
  await renameViewDefinitions(knex, 'shop_client_id', 'customer_id', 'shop_clients', 'customers');

  for (const [oldName, newName] of [...CONSTRAINT_RENAMES].reverse()) {
    const tableName = CONSTRAINT_TABLES[oldName];
    if (tableName && await hasTable(knex, tableName)) {
      await renameConstraintIfExists(knex, tableName, newName, oldName);
    }
  }

  for (const [oldName, newName] of [...INDEX_RENAMES].reverse()) {
    await renameIndexIfExists(knex, newName, oldName);
  }

  for (const [tableName, fromColumn, toColumn] of [...COLUMN_RENAMES].reverse()) {
    if (await hasTable(knex, tableName) && await hasColumn(knex, tableName, toColumn) && !(await hasColumn(knex, tableName, fromColumn))) {
      await knex.raw('ALTER TABLE ?? RENAME COLUMN ?? TO ??', [tableName, toColumn, fromColumn]);
    }
  }

  for (const [from, to] of [...TABLE_RENAMES].reverse()) {
    if (await hasTable(knex, to) && !(await hasTable(knex, from))) {
      await knex.raw('ALTER TABLE ?? RENAME TO ??', [to, from]);
    }
  }
};
