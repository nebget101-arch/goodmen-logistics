/**
 * Customer Management Module migration
 */
exports.up = async function(knex) {
  // Ensure uuid extension exists
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const hasCustomers = await knex.schema.hasTable('customers');
  if (!hasCustomers) {
    await knex.schema.createTable('customers', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.text('company_name').notNullable();
      table.enu('customer_type', ['FLEET','WALK_IN','INTERNAL','WARRANTY']).defaultTo('WALK_IN');
      table.enu('status', ['ACTIVE','INACTIVE']).defaultTo('ACTIVE');
      table.text('dot_number');
      table.text('address');
      table.text('city');
      table.text('state');
      table.text('zip');
      table.text('tax_id');
      table.text('primary_contact_name');
      table.text('phone');
      table.text('email');
      table.text('secondary_phone');
      table.text('website');
      table.text('billing_address_line1');
      table.text('billing_address_line2');
      table.text('billing_city');
      table.text('billing_state');
      table.text('billing_zip');
      table.text('billing_country');
      table.enu('payment_terms', ['DUE_ON_RECEIPT','NET_15','NET_30','CUSTOM']).defaultTo('DUE_ON_RECEIPT');
      table.integer('payment_terms_custom_days');
      table.decimal('credit_limit', 12, 2);
      table.boolean('tax_exempt').defaultTo(false);
      table.text('billing_notes');
      table.uuid('default_location_id').references('id').inTable('locations').onDelete('SET NULL');
      table.boolean('is_deleted').defaultTo(false);
      table.timestamps(true, true);
    });
  } else {
    const hasCompanyName = await knex.schema.hasColumn('customers', 'company_name');
    const hasName = await knex.schema.hasColumn('customers', 'name');
    if (!hasCompanyName && hasName) {
      await knex.schema.alterTable('customers', function(table) {
        table.renameColumn('name', 'company_name');
      });
    }

    await knex.schema.alterTable('customers', function(table) {
      if (!table.columnInfo) return;
    });

    const addColumnIfMissing = async (column, callback) => {
      const exists = await knex.schema.hasColumn('customers', column);
      if (!exists) {
        await knex.schema.alterTable('customers', callback);
      }
    };

    await addColumnIfMissing('customer_type', table => table.enu('customer_type', ['FLEET','WALK_IN','INTERNAL','WARRANTY']).defaultTo('WALK_IN'));
    await addColumnIfMissing('status', table => table.enu('status', ['ACTIVE','INACTIVE']).defaultTo('ACTIVE'));
    await addColumnIfMissing('tax_id', table => table.text('tax_id'));
    await addColumnIfMissing('dot_number', table => table.text('dot_number'));
    await addColumnIfMissing('address', table => table.text('address'));
    await addColumnIfMissing('city', table => table.text('city'));
    await addColumnIfMissing('state', table => table.text('state'));
    await addColumnIfMissing('zip', table => table.text('zip'));
    await addColumnIfMissing('primary_contact_name', table => table.text('primary_contact_name'));
    await addColumnIfMissing('secondary_phone', table => table.text('secondary_phone'));
    await addColumnIfMissing('website', table => table.text('website'));
    await addColumnIfMissing('billing_address_line1', table => table.text('billing_address_line1'));
    await addColumnIfMissing('billing_address_line2', table => table.text('billing_address_line2'));
    await addColumnIfMissing('billing_city', table => table.text('billing_city'));
    await addColumnIfMissing('billing_state', table => table.text('billing_state'));
    await addColumnIfMissing('billing_zip', table => table.text('billing_zip'));
    await addColumnIfMissing('billing_country', table => table.text('billing_country'));
    await addColumnIfMissing('payment_terms', table => table.enu('payment_terms', ['DUE_ON_RECEIPT','NET_15','NET_30','CUSTOM']).defaultTo('DUE_ON_RECEIPT'));
    await addColumnIfMissing('payment_terms_custom_days', table => table.integer('payment_terms_custom_days'));
    await addColumnIfMissing('credit_limit', table => table.decimal('credit_limit', 12, 2));
    await addColumnIfMissing('tax_exempt', table => table.boolean('tax_exempt').defaultTo(false));
    await addColumnIfMissing('billing_notes', table => table.text('billing_notes'));
    await addColumnIfMissing('default_location_id', table => table.uuid('default_location_id').references('id').inTable('locations').onDelete('SET NULL'));
    await addColumnIfMissing('is_deleted', table => table.boolean('is_deleted').defaultTo(false));
    await addColumnIfMissing('created_at', table => table.timestamp('created_at').defaultTo(knex.fn.now()));
    await addColumnIfMissing('updated_at', table => table.timestamp('updated_at').defaultTo(knex.fn.now()));
  }

  // Indexes
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_customers_type_status ON customers (customer_type, status)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_customers_default_location ON customers (default_location_id)`);
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_customers_company_name_active ON customers (company_name) WHERE is_deleted = false`);

  // Customer notes
  const hasNotes = await knex.schema.hasTable('customer_notes');
  if (!hasNotes) {
    await knex.schema.createTable('customer_notes', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
      table.enu('note_type', ['GENERAL','BILLING','SERVICE_ISSUE']).defaultTo('GENERAL');
      table.text('note').notNullable();
      table.uuid('created_by_user_id').references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_customer_notes_customer_created ON customer_notes (customer_id, created_at DESC)`);

  // Customer pricing rules
  const hasPricing = await knex.schema.hasTable('customer_pricing_rules');
  if (!hasPricing) {
    await knex.schema.createTable('customer_pricing_rules', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('customer_id').notNullable().unique().references('id').inTable('customers').onDelete('CASCADE');
      table.decimal('default_labor_rate', 10, 2);
      table.decimal('parts_discount_percent', 5, 2);
      table.decimal('labor_discount_percent', 5, 2);
      table.decimal('shop_supplies_percent', 5, 2);
      table.decimal('tax_override_percent', 5, 2);
      table.boolean('contract_pricing_enabled').defaultTo(false);
      table.timestamps(true, true);
    });
  }

  // Customer audit log
  const hasAudit = await knex.schema.hasTable('customer_audit_log');
  if (!hasAudit) {
    await knex.schema.createTable('customer_audit_log', function(table) {
      table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
      table.uuid('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
      table.text('field').notNullable();
      table.text('old_value');
      table.text('new_value');
      table.uuid('changed_by_user_id').references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('changed_at').defaultTo(knex.fn.now());
    });
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_customer_audit_customer_changed ON customer_audit_log (customer_id, changed_at DESC)`);

  // Link customer_id to work_orders
  const hasWorkOrderCustomer = await knex.schema.hasColumn('work_orders', 'customer_id');
  if (!hasWorkOrderCustomer) {
    await knex.schema.alterTable('work_orders', function(table) {
      table.uuid('customer_id').references('id').inTable('customers').onDelete('SET NULL');
    });
  }

  // maintenance_records already has customer_id in earlier migration, ensure index
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_maintenance_records_customer ON maintenance_records (customer_id)`);
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('customer_audit_log');
  await knex.schema.dropTableIfExists('customer_pricing_rules');
  await knex.schema.dropTableIfExists('customer_notes');

  const hasWorkOrderCustomer = await knex.schema.hasColumn('work_orders', 'customer_id');
  if (hasWorkOrderCustomer) {
    await knex.schema.alterTable('work_orders', function(table) {
      table.dropColumn('customer_id');
    });
  }
};
