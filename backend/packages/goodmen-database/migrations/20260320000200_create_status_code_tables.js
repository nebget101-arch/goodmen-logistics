'use strict';

const LOAD_STATUS_SEED = [
  { code: 'DRAFT', display_label: 'Draft', color_hex: '94A3B8', sort_order: 10, is_terminal: false },
  { code: 'NEW', display_label: 'New', color_hex: '3B82F6', sort_order: 20, is_terminal: false },
  { code: 'DISPATCHED', display_label: 'Dispatched', color_hex: '8B5CF6', sort_order: 30, is_terminal: false },
  { code: 'EN_ROUTE', display_label: 'En Route', color_hex: 'F59E0B', sort_order: 40, is_terminal: false },
  { code: 'IN_TRANSIT', display_label: 'In Transit', color_hex: 'F59E0B', sort_order: 50, is_terminal: false },
  { code: 'PICKED_UP', display_label: 'Picked Up', color_hex: 'F97316', sort_order: 60, is_terminal: false },
  { code: 'PICKED UP', display_label: 'Picked Up (Legacy)', color_hex: 'F97316', sort_order: 61, is_terminal: false },
  { code: 'DELIVERED', display_label: 'Delivered', color_hex: '10B981', sort_order: 70, is_terminal: false },
  { code: 'COMPLETED', display_label: 'Completed', color_hex: '059669', sort_order: 80, is_terminal: true },
  { code: 'TONU', display_label: 'TONU', color_hex: '6B7280', sort_order: 90, is_terminal: true },
  { code: 'CANCELLED', display_label: 'Cancelled', color_hex: 'EF4444', sort_order: 100, is_terminal: true },
  { code: 'CANCELED', display_label: 'Canceled', color_hex: 'EF4444', sort_order: 101, is_terminal: true }
];

const BILLING_STATUS_SEED = [
  { code: 'PENDING', display_label: 'Pending', color_hex: '94A3B8', sort_order: 10, is_terminal: false },
  { code: 'BOL_RECEIVED', display_label: 'BOL Received', color_hex: '3B82F6', sort_order: 20, is_terminal: false },
  { code: 'BOL RECEIVED', display_label: 'BOL Received (Legacy)', color_hex: '3B82F6', sort_order: 21, is_terminal: false },
  { code: 'INVOICED', display_label: 'Invoiced', color_hex: '8B5CF6', sort_order: 30, is_terminal: false },
  { code: 'SENT_TO_FACTORING', display_label: 'Sent to Factoring', color_hex: 'F59E0B', sort_order: 40, is_terminal: false },
  { code: 'SENT TO FACTORING', display_label: 'Sent to Factoring (Legacy)', color_hex: 'F59E0B', sort_order: 41, is_terminal: false },
  { code: 'FUNDED', display_label: 'Funded', color_hex: '10B981', sort_order: 50, is_terminal: true },
  { code: 'PAID', display_label: 'Paid', color_hex: '059669', sort_order: 60, is_terminal: true },
  { code: 'CANCELLED', display_label: 'Cancelled', color_hex: 'EF4444', sort_order: 70, is_terminal: true },
  { code: 'CANCELED', display_label: 'Canceled', color_hex: 'EF4444', sort_order: 71, is_terminal: true }
];

async function upsertSeed(knex, tableName, rows) {
  for (const row of rows) {
    const existing = await knex(tableName).where({ code: row.code }).first('code');
    if (existing) {
      await knex(tableName).where({ code: row.code }).update({
        display_label: row.display_label,
        color_hex: row.color_hex,
        sort_order: row.sort_order,
        is_terminal: row.is_terminal
      });
    } else {
      await knex(tableName).insert(row);
    }
  }
}

exports.up = async function up(knex) {
  const hasLoadTable = await knex.schema.hasTable('load_status_codes');
  if (!hasLoadTable) {
    await knex.schema.createTable('load_status_codes', (table) => {
      table.text('code').primary();
      table.text('display_label').notNullable();
      table.specificType('color_hex', 'char(6)').notNullable();
      table.integer('sort_order').notNullable();
      table.boolean('is_terminal').notNullable().defaultTo(false);
    });
  }

  const hasBillingTable = await knex.schema.hasTable('billing_status_codes');
  if (!hasBillingTable) {
    await knex.schema.createTable('billing_status_codes', (table) => {
      table.text('code').primary();
      table.text('display_label').notNullable();
      table.specificType('color_hex', 'char(6)').notNullable();
      table.integer('sort_order').notNullable();
      table.boolean('is_terminal').notNullable().defaultTo(false);
    });
  }

  await upsertSeed(knex, 'load_status_codes', LOAD_STATUS_SEED);
  await upsertSeed(knex, 'billing_status_codes', BILLING_STATUS_SEED);

  // Optional: keep or remove check constraints. We intentionally keep them for DB-side guardrails.
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('billing_status_codes');
  await knex.schema.dropTableIfExists('load_status_codes');
};
