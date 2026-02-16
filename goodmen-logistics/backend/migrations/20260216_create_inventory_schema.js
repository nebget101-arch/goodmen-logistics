/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
	// Parts table (master data for parts catalog)
	await knex.schema.createTable('parts', table => {
		table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
		table.string('sku').notNullable().unique();
		table.string('name').notNullable();
		table.string('category').notNullable();
		table.string('manufacturer');
		table.string('uom').defaultTo('each'); // each, box, gallon, set, etc.
		table.decimal('default_cost', 10, 2).defaultTo(0);
		table.decimal('default_retail_price', 10, 2).defaultTo(0);
		table.boolean('taxable').defaultTo(false);
		table.boolean('is_active').defaultTo(true);
		table.text('description');
		table.string('barcode');
		table.string('image_url');
		table.boolean('core_item').defaultTo(false);
		table.boolean('hazmat').defaultTo(false);
		table.integer('warranty_days');
		table.integer('reorder_point_default');
		table.integer('reorder_qty_default');
		table.string('preferred_vendor_name');
		table.text('notes');
		table.timestamps(true, true);
	});

	// Inventory table (per-location inventory levels)
	await knex.schema.createTable('inventory', table => {
		table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
		table.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
		table.uuid('part_id').notNullable().references('id').inTable('parts').onDelete('CASCADE');
		table.integer('on_hand_qty').defaultTo(0);
		table.integer('reserved_qty').defaultTo(0);
		table.string('bin_location');
		table.integer('min_stock_level').defaultTo(0);
		table.integer('reorder_qty');
		table.timestamp('last_counted_at');
		table.timestamp('last_received_at');
		table.timestamp('last_issued_at');
		table.timestamps(true, true);
		// Unique constraint: one inventory record per location-part combo
		table.unique(['location_id', 'part_id']);
	});

	// Receiving tickets
	await knex.schema.createTable('receiving_tickets', table => {
		table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
		table.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
		table.string('ticket_number').notNullable().unique();
		table.string('vendor_name');
		table.string('reference_number');
		table.enu('status', ['DRAFT', 'POSTED']).defaultTo('DRAFT');
		table.uuid('created_by').notNullable().references('id').inTable('users').onDelete('SET NULL');
		table.uuid('posted_by').references('id').inTable('users').onDelete('SET NULL');
		table.timestamp('posted_at');
		table.timestamps(true, true);
	});

	// Receiving ticket line items
	await knex.schema.createTable('receiving_ticket_lines', table => {
		table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
		table.uuid('ticket_id').notNullable().references('id').inTable('receiving_tickets').onDelete('CASCADE');
		table.uuid('part_id').notNullable().references('id').inTable('parts').onDelete('CASCADE');
		table.integer('qty_received').notNullable();
		table.decimal('unit_cost', 10, 2);
		table.string('bin_location_override');
		table.timestamps(true, true);
	});

	// Inventory adjustments
	await knex.schema.createTable('inventory_adjustments', table => {
		table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
		table.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
		table.uuid('part_id').notNullable().references('id').inTable('parts').onDelete('CASCADE');
		table.enu('adjustment_type', ['SET_TO_QTY', 'DELTA']).notNullable();
		table.integer('set_to_qty');
		table.integer('delta_qty');
		table.enu('reason_code', ['DAMAGED', 'LOST', 'FOUND', 'DATA_CORRECTION', 'RETURN_TO_VENDOR', 'OTHER']).notNullable();
		table.text('notes');
		table.string('attachment_url');
		table.enu('status', ['DRAFT', 'POSTED']).defaultTo('DRAFT');
		table.uuid('created_by').notNullable().references('id').inTable('users').onDelete('SET NULL');
		table.uuid('posted_by').references('id').inTable('users').onDelete('SET NULL');
		table.timestamp('posted_at');
		table.timestamps(true, true);
	});

	// Cycle counts
	await knex.schema.createTable('cycle_counts', table => {
		table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
		table.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
		table.enu('method', ['CATEGORY', 'BIN_RANGE', 'SELECTED_PARTS']).notNullable();
		table.jsonb('filter_value');
		table.uuid('assigned_to_user_id').references('id').inTable('users').onDelete('SET NULL');
		table.timestamp('count_date');
		table.enu('status', ['DRAFT', 'COUNTING', 'SUBMITTED', 'APPROVED']).defaultTo('DRAFT');
		table.uuid('created_by').notNullable().references('id').inTable('users').onDelete('SET NULL');
		table.uuid('approved_by').references('id').inTable('users').onDelete('SET NULL');
		table.timestamp('approved_at');
		table.timestamps(true, true);
	});

	// Cycle count line items
	await knex.schema.createTable('cycle_count_lines', table => {
		table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
		table.uuid('cycle_count_id').notNullable().references('id').inTable('cycle_counts').onDelete('CASCADE');
		table.uuid('part_id').notNullable().references('id').inTable('parts').onDelete('CASCADE');
		table.integer('system_on_hand_qty').notNullable();
		table.integer('counted_qty');
		table.text('notes');
		table.timestamps(true, true);
	});

	// Inventory transactions (append-only audit log)
	await knex.schema.createTable('inventory_transactions', table => {
		table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
		table.uuid('location_id').notNullable().references('id').inTable('locations').onDelete('CASCADE');
		table.uuid('part_id').notNullable().references('id').inTable('parts').onDelete('CASCADE');
		table.enu('transaction_type', ['RECEIVE', 'ADJUST', 'CYCLE_COUNT_ADJUST']).notNullable();
		table.integer('qty_change').notNullable();
		table.decimal('unit_cost_at_time', 10, 2);
		table.enu('reference_type', ['RECEIVING_TICKET', 'ADJUSTMENT', 'CYCLE_COUNT']).notNullable();
		table.uuid('reference_id').notNullable();
		table.uuid('performed_by_user_id').references('id').inTable('users').onDelete('SET NULL');
		table.text('notes');
		table.timestamp('created_at').defaultTo(knex.fn.now());
		// Create index on frequently queried fields
		table.index('location_id');
		table.index('part_id');
		table.index('transaction_type');
		table.index('created_at');
		table.index(['location_id', 'created_at']);
	});

	// Create index on parts table for common queries
	await knex.schema.table('parts', table => {
		table.index('sku');
		table.index('is_active');
		table.index('category');
	});

	// Create index on inventory for common queries
	await knex.schema.table('inventory', table => {
		table.index('location_id');
		table.index('part_id');
		table.index(['location_id', 'part_id']);
	});

	// Create index on receiving_tickets
	await knex.schema.table('receiving_tickets', table => {
		table.index('location_id');
		table.index('status');
		table.index('created_at');
	});

	// Create index on cycle_counts
	await knex.schema.table('cycle_counts', table => {
		table.index('location_id');
		table.index('status');
		table.index('created_at');
	});
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
	await knex.schema.dropTableIfExists('inventory_transactions');
	await knex.schema.dropTableIfExists('cycle_count_lines');
	await knex.schema.dropTableIfExists('cycle_counts');
	await knex.schema.dropTableIfExists('inventory_adjustments');
	await knex.schema.dropTableIfExists('receiving_ticket_lines');
	await knex.schema.dropTableIfExists('receiving_tickets');
	await knex.schema.dropTableIfExists('inventory');
	await knex.schema.dropTableIfExists('parts');
};
