/**
 * Align parts table schema with bulk upload expectations.
 * Adds missing columns and renames existing ones for consistency.
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
	// Check which columns exist
	const hasUnitCost = await knex.schema.hasColumn('parts', 'unit_cost');
	const hasUnitPrice = await knex.schema.hasColumn('parts', 'unit_price');
	const hasStatus = await knex.schema.hasColumn('parts', 'status');
	const hasReorderLevel = await knex.schema.hasColumn('parts', 'reorder_level');
	const hasQuantityOnHand = await knex.schema.hasColumn('parts', 'quantity_on_hand');
	const hasSupplierId = await knex.schema.hasColumn('parts', 'supplier_id');
	
	await knex.schema.alterTable('parts', table => {
		// Add unit_cost and unit_price if they don't exist
		if (!hasUnitCost) {
			table.decimal('unit_cost', 10, 2).defaultTo(0);
		}
		if (!hasUnitPrice) {
			table.decimal('unit_price', 10, 2).defaultTo(0);
		}
		
		// Add status column if it doesn't exist
		if (!hasStatus) {
			table.string('status').defaultTo('ACTIVE');
		}
		
		// Add reorder_level if it doesn't exist
		if (!hasReorderLevel) {
			table.integer('reorder_level').defaultTo(5);
		}
		
		// Add quantity_on_hand if it doesn't exist
		if (!hasQuantityOnHand) {
			table.integer('quantity_on_hand').defaultTo(0);
		}
		
		// Add supplier_id if it doesn't exist
		if (!hasSupplierId) {
			table.uuid('supplier_id');
		}
	});
	
	// Copy data from old columns to new ones if they exist
	const hasDefaultCost = await knex.schema.hasColumn('parts', 'default_cost');
	const hasDefaultRetailPrice = await knex.schema.hasColumn('parts', 'default_retail_price');
	const hasIsActive = await knex.schema.hasColumn('parts', 'is_active');
	const hasReorderPointDefault = await knex.schema.hasColumn('parts', 'reorder_point_default');
	
	if (hasDefaultCost) {
		await knex.raw(`
			UPDATE parts 
			SET unit_cost = COALESCE(default_cost, 0)
			WHERE unit_cost = 0 OR unit_cost IS NULL
		`);
	}
	
	if (hasDefaultRetailPrice) {
		await knex.raw(`
			UPDATE parts 
			SET unit_price = COALESCE(default_retail_price, 0)
			WHERE unit_price = 0 OR unit_price IS NULL
		`);
	}
	
	if (hasIsActive) {
		await knex.raw(`
			UPDATE parts 
			SET status = CASE WHEN is_active = true THEN 'ACTIVE' ELSE 'INACTIVE' END
			WHERE status = 'ACTIVE' OR status IS NULL
		`);
	}
	
	if (hasReorderPointDefault) {
		await knex.raw(`
			UPDATE parts 
			SET reorder_level = COALESCE(reorder_point_default, 5)
			WHERE reorder_level IS NULL OR reorder_level = 0
		`);
	}
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
	await knex.schema.alterTable('parts', table => {
		table.dropColumn('unit_cost');
		table.dropColumn('unit_price');
		table.dropColumn('status');
		table.dropColumn('reorder_level');
		table.dropColumn('quantity_on_hand');
		table.dropColumn('supplier_id');
	});
};
