'use strict';

/**
 * Backfill migration for work-order detail tables.
 *
 * These tables were historically skipped on fresh DBs when `work_orders`
 * was missing at the time older migrations ran. This migration creates them
 * idempotently after baseline parity has been restored.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasWorkOrders = await knex.schema.hasTable('work_orders');
  if (!hasWorkOrders) {
    return;
  }

  const hasUsers = await knex.schema.hasTable('users');
  const hasParts = await knex.schema.hasTable('parts');
  const hasLocations = await knex.schema.hasTable('locations');

  const hasWorkOrderNotes = await knex.schema.hasTable('work_order_notes');
  if (!hasWorkOrderNotes) {
    await knex.schema.createTable('work_order_notes', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
      table.text('note');
      table.string('author');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['work_order_id']);
    });
  }

  const hasWorkOrderAttachments = await knex.schema.hasTable('work_order_attachments');
  if (!hasWorkOrderAttachments) {
    await knex.schema.createTable('work_order_attachments', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
      table.string('filename');
      table.string('filepath');
      table.string('uploaded_by');
      table.timestamp('uploaded_at').defaultTo(knex.fn.now());
      table.index(['work_order_id']);
    });
  }

  const hasWorkOrderLabor = await knex.schema.hasTable('work_order_labor');
  if (!hasWorkOrderLabor) {
    await knex.schema.createTable('work_order_labor', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
      table.string('technician');
      table.float('hours');
      table.float('rate');
      table.text('description');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['work_order_id']);
    });
  }

  const hasLaborItems = await knex.schema.hasTable('work_order_labor_items');
  if (!hasLaborItems) {
    await knex.schema.createTable('work_order_labor_items', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
      table.text('description').notNullable();
      table.decimal('hours', 10, 2).defaultTo(0);
      table.decimal('labor_rate', 12, 2).defaultTo(0);
      table.boolean('taxable').defaultTo(false);
      table.decimal('line_total', 12, 2).defaultTo(0);
      table.timestamps(true, true);
      table.index('work_order_id');
    });
  }

  const hasPartItems = await knex.schema.hasTable('work_order_part_items');
  if (!hasPartItems) {
    await knex.schema.createTable('work_order_part_items', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');

      const partId = table.uuid('part_id').notNullable();
      if (hasParts) {
        partId.references('id').inTable('parts');
      }

      const locationId = table.uuid('location_id').notNullable();
      if (hasLocations) {
        locationId.references('id').inTable('locations');
      }

      table.decimal('qty_requested', 12, 3).defaultTo(0);
      table.decimal('qty_reserved', 12, 3).defaultTo(0);
      table.decimal('qty_issued', 12, 3).defaultTo(0);
      table.decimal('unit_price', 12, 2).defaultTo(0);
      table.boolean('taxable').defaultTo(true);
      table.enu('status', ['RESERVED', 'ISSUED', 'BACKORDERED', 'RETURNED']).defaultTo('RESERVED');
      table.decimal('line_total', 12, 2).defaultTo(0);
      table.timestamps(true, true);
      table.index('work_order_id');
      table.index('part_id');
    });
  }

  const hasFees = await knex.schema.hasTable('work_order_fees');
  if (!hasFees) {
    await knex.schema.createTable('work_order_fees', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
      table.enu('fee_type', ['SHOP_SUPPLIES', 'ENV', 'MISC']).notNullable();
      table.decimal('amount', 12, 2).defaultTo(0);
      table.boolean('taxable').defaultTo(false);
      table.timestamps(true, true);
      table.index('work_order_id');
    });
  }

  const hasDocuments = await knex.schema.hasTable('work_order_documents');
  if (!hasDocuments) {
    await knex.schema.createTable('work_order_documents', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
      table.string('file_name').notNullable();
      table.string('mime_type').notNullable();
      table.bigint('file_size_bytes').notNullable();
      table.string('storage_key').notNullable();

      const uploadedByUserId = table.uuid('uploaded_by_user_id');
      if (hasUsers) {
        uploadedByUserId.references('id').inTable('users');
      }

      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index('work_order_id');
    });
  }
};

/**
 * Keep rollback intentionally non-destructive.
 *
 * @param {import('knex').Knex} _knex
 */
exports.down = async function down(_knex) {
  // no-op
};
