/**
 * Add barcode, transfer, and direct sale schema for inventory workflows.
 *
 * Notes:
 * - Keeps existing `inventory` as the source table for per-location stock.
 * - Adds a compatibility view `inventory_by_location` mapped to `inventory`.
 * - Extends inventory audit shape with `tx_type` + `performed_by` while preserving
 *   legacy columns (`transaction_type`, `performed_by_user_id`).
 *
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_MIGRATIONS !== 'true') {
    return;
  }
  const hasUsers = await knex.schema.hasTable('users');
  const hasInvoices = await knex.schema.hasTable('invoices');

  // 1) Multiple barcodes per part
  if (!(await knex.schema.hasTable('part_barcodes'))) {
    await knex.schema.createTable('part_barcodes', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.string('barcode_value', 128).notNullable().unique();
      table.uuid('part_id').notNullable().references('id').inTable('parts').onDelete('CASCADE');
      table.integer('pack_qty').notNullable().defaultTo(1);
      table.string('vendor', 255);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamps(true, true);

      table.index('part_id');
      table.index('barcode_value');
    });
  }

  // 2) Transfer header
  if (!(await knex.schema.hasTable('inventory_transfers'))) {
    await knex.schema.createTable('inventory_transfers', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.string('transfer_number', 64).notNullable().unique();
      table.uuid('from_location_id').notNullable().references('id').inTable('locations').onDelete('RESTRICT');
      table.uuid('to_location_id').notNullable().references('id').inTable('locations').onDelete('RESTRICT');
      table.enu('status', ['DRAFT', 'SENT', 'RECEIVED', 'CANCELLED']).notNullable().defaultTo('DRAFT');
      if (hasUsers) {
        table.uuid('created_by_user_id').references('id').inTable('users').onDelete('SET NULL');
        table.uuid('sent_by_user_id').references('id').inTable('users').onDelete('SET NULL');
        table.uuid('received_by_user_id').references('id').inTable('users').onDelete('SET NULL');
      } else {
        table.uuid('created_by_user_id');
        table.uuid('sent_by_user_id');
        table.uuid('received_by_user_id');
      }
      table.timestamp('sent_at');
      table.timestamp('received_at');
      table.text('notes');
      table.timestamps(true, true);

      table.index('from_location_id');
      table.index('to_location_id');
      table.index('status');
      table.index('created_at');
    });
  }

  // 3) Transfer lines
  if (!(await knex.schema.hasTable('inventory_transfer_lines'))) {
    await knex.schema.createTable('inventory_transfer_lines', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('transfer_id').notNullable().references('id').inTable('inventory_transfers').onDelete('CASCADE');
      table.uuid('part_id').notNullable().references('id').inTable('parts').onDelete('RESTRICT');
      table.integer('qty').notNullable();
      table.integer('qty_received');
      table.decimal('unit_cost_at_time', 10, 2);
      table.text('notes');
      table.timestamps(true, true);

      table.index('transfer_id');
      table.index('part_id');
      table.index(['transfer_id', 'part_id']);
    });
  }

  // 4) Direct customer sales (no work order required)
  if (!(await knex.schema.hasTable('customer_sales'))) {
    await knex.schema.createTable('customer_sales', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.string('sale_number', 64).notNullable().unique();
      table.uuid('customer_id').notNullable().references('id').inTable('customers').onDelete('RESTRICT');
      table.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('RESTRICT');
      if (hasInvoices) {
        table.uuid('invoice_id').references('id').inTable('invoices').onDelete('SET NULL');
      } else {
        table.uuid('invoice_id');
      }
      table.enu('status', ['DRAFT', 'COMPLETED', 'VOID']).notNullable().defaultTo('DRAFT');
      table.decimal('subtotal', 12, 2).notNullable().defaultTo(0);
      table.decimal('tax_amount', 12, 2).notNullable().defaultTo(0);
      table.decimal('total_amount', 12, 2).notNullable().defaultTo(0);
      table.text('notes');
      if (hasUsers) {
        table.uuid('created_by_user_id').references('id').inTable('users').onDelete('SET NULL');
      } else {
        table.uuid('created_by_user_id');
      }
      table.timestamp('completed_at');
      table.timestamps(true, true);

      table.index('customer_id');
      table.index('location_id');
      table.index('status');
      table.index('created_at');
    });
  }

  if (!(await knex.schema.hasTable('customer_sale_lines'))) {
    await knex.schema.createTable('customer_sale_lines', table => {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('sale_id').notNullable().references('id').inTable('customer_sales').onDelete('CASCADE');
      table.uuid('part_id').notNullable().references('id').inTable('parts').onDelete('RESTRICT');
      table.uuid('barcode_id').references('id').inTable('part_barcodes').onDelete('SET NULL');
      table.integer('qty').notNullable();
      table.decimal('unit_price', 10, 2).notNullable().defaultTo(0);
      table.boolean('taxable').notNullable().defaultTo(false);
      table.decimal('line_total', 12, 2).notNullable().defaultTo(0);
      table.timestamps(true, true);

      table.index('sale_id');
      table.index('part_id');
      table.index(['sale_id', 'part_id']);
    });
  }

  // 5) Compatibility extension for inventory audit shape
  // Existing table has: transaction_type, performed_by_user_id.
  // Add: tx_type, performed_by to align with new API contracts.
  if (await knex.schema.hasTable('inventory_transactions')) {
    const hasTxType = await knex.schema.hasColumn('inventory_transactions', 'tx_type');
    if (!hasTxType) {
      await knex.schema.table('inventory_transactions', table => {
        table.enu('tx_type', ['RECEIVE', 'TRANSFER_OUT', 'TRANSFER_IN', 'CONSUME', 'SALE', 'RETURN', 'ADJUST']);
      });

      await knex.raw(`
        UPDATE inventory_transactions
        SET tx_type = CASE transaction_type
          WHEN 'RECEIVE' THEN 'RECEIVE'
          WHEN 'ADJUST' THEN 'ADJUST'
          WHEN 'CYCLE_COUNT_ADJUST' THEN 'ADJUST'
          ELSE NULL
        END
      `);

      await knex.raw('CREATE INDEX IF NOT EXISTS idx_inventory_transactions_tx_type ON inventory_transactions(tx_type)');
    }

    const hasPerformedBy = await knex.schema.hasColumn('inventory_transactions', 'performed_by');
    if (!hasPerformedBy) {
      await knex.schema.table('inventory_transactions', table => {
        if (hasUsers) {
          table.uuid('performed_by').references('id').inTable('users').onDelete('SET NULL');
        } else {
          table.uuid('performed_by');
        }
      });

      await knex.raw(`
        UPDATE inventory_transactions
        SET performed_by = performed_by_user_id
        WHERE performed_by IS NULL
      `);

      await knex.raw('CREATE INDEX IF NOT EXISTS idx_inventory_transactions_performed_by ON inventory_transactions(performed_by)');
    }
  }

  // 6) Alias view expected by new docs/contracts
  // inventory_by_location(part_id, location_id, on_hand_qty, reserved_qty)
  await knex.raw(`
    CREATE OR REPLACE VIEW inventory_by_location AS
    SELECT
      part_id,
      location_id,
      on_hand_qty,
      reserved_qty
    FROM inventory
  `);
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP VIEW IF EXISTS inventory_by_location');

  if (await knex.schema.hasTable('inventory_transactions')) {
    if (await knex.schema.hasColumn('inventory_transactions', 'performed_by')) {
      await knex.schema.table('inventory_transactions', table => {
        table.dropColumn('performed_by');
      });
    }

    if (await knex.schema.hasColumn('inventory_transactions', 'tx_type')) {
      await knex.schema.table('inventory_transactions', table => {
        table.dropColumn('tx_type');
      });
    }
  }

  await knex.schema.dropTableIfExists('customer_sale_lines');
  await knex.schema.dropTableIfExists('customer_sales');
  await knex.schema.dropTableIfExists('inventory_transfer_lines');
  await knex.schema.dropTableIfExists('inventory_transfers');
  await knex.schema.dropTableIfExists('part_barcodes');
};
