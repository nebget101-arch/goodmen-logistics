/**
 * Invoicing & Payments tables
 */
exports.up = async function(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  await knex.schema.createTable('invoices', table => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.text('invoice_number').notNullable().unique();
    table.uuid('work_order_id').references('id').inTable('work_orders').onDelete('SET NULL');
    table.uuid('customer_id').notNullable().references('id').inTable('customers').onDelete('RESTRICT');
    table.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('RESTRICT');
    table.enu('status', ['DRAFT','SENT','PARTIAL','PAID','VOID']).defaultTo('DRAFT');
    table.date('issued_date');
    table.date('due_date');
    table.text('payment_terms');
    table.text('notes');
    table.decimal('subtotal_labor', 12, 2).defaultTo(0);
    table.decimal('subtotal_parts', 12, 2).defaultTo(0);
    table.decimal('subtotal_fees', 12, 2).defaultTo(0);
    table.enu('discount_type', ['NONE','PERCENT','AMOUNT']).defaultTo('NONE');
    table.decimal('discount_value', 12, 2).defaultTo(0);
    table.decimal('tax_rate_percent', 6, 3).defaultTo(0);
    table.decimal('tax_amount', 12, 2).defaultTo(0);
    table.decimal('total_amount', 12, 2).defaultTo(0);
    table.decimal('amount_paid', 12, 2).defaultTo(0);
    table.decimal('balance_due', 12, 2).defaultTo(0);
    table.text('voided_reason');
    table.timestamp('voided_at');
    table.uuid('created_by_user_id').references('id').inTable('users').onDelete('SET NULL');
    table.boolean('is_deleted').defaultTo(false);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('invoice_line_items', table => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    table.enu('line_type', ['LABOR','PART','FEE','ADJUSTMENT']).notNullable();
    table.text('source_ref_type');
    table.uuid('source_ref_id');
    table.text('description').notNullable();
    table.decimal('quantity', 12, 3).defaultTo(1);
    table.decimal('unit_price', 12, 2).defaultTo(0);
    table.boolean('taxable').defaultTo(false);
    table.decimal('line_total', 12, 2).defaultTo(0);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('invoice_payments', table => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    table.date('payment_date').notNullable();
    table.decimal('amount', 12, 2).notNullable();
    table.enu('method', ['CASH','CHECK','CARD','ACH','WIRE','ZELLE','OTHER']).notNullable();
    table.text('reference_number');
    table.text('memo');
    table.uuid('received_by_user_id').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('invoice_documents', table => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    table.enu('doc_type', ['INVOICE_PDF','SUPPORTING']).notNullable();
    table.text('file_name').notNullable();
    table.text('mime_type').notNullable();
    table.bigint('file_size_bytes').notNullable();
    table.text('storage_key').notNullable();
    table.uuid('uploaded_by_user_id').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('invoice_events', table => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    table.text('event_type').notNullable();
    table.text('from_status');
    table.text('to_status');
    table.jsonb('data_json');
    table.uuid('created_by_user_id').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_invoices_customer_status ON invoices (customer_id, status)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_invoices_location_issued ON invoices (location_id, issued_date)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_invoices_work_order ON invoices (work_order_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON invoice_line_items (invoice_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_invoice_line_items_type ON invoice_line_items (line_type)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_date ON invoice_payments (invoice_id, payment_date)');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_invoice_documents_invoice_type ON invoice_documents (invoice_id, doc_type)');

  const hasInvoicedInvoiceId = await knex.schema.hasColumn('work_orders', 'invoiced_invoice_id');
  if (!hasInvoicedInvoiceId) {
    await knex.schema.alterTable('work_orders', table => {
      table.uuid('invoiced_invoice_id').references('id').inTable('invoices').onDelete('SET NULL');
    });
  }
};

exports.down = async function(knex) {
  const hasInvoicedInvoiceId = await knex.schema.hasColumn('work_orders', 'invoiced_invoice_id');
  if (hasInvoicedInvoiceId) {
    await knex.schema.alterTable('work_orders', table => {
      table.dropColumn('invoiced_invoice_id');
    });
  }
  await knex.schema.dropTableIfExists('invoice_events');
  await knex.schema.dropTableIfExists('invoice_documents');
  await knex.schema.dropTableIfExists('invoice_payments');
  await knex.schema.dropTableIfExists('invoice_line_items');
  await knex.schema.dropTableIfExists('invoices');
};
