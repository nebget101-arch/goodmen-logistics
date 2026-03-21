/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
	// Locations table (idempotent)
	const hasLocations = await knex.schema.hasTable('locations');
	if (!hasLocations) {
		await knex.schema.createTable('locations', table => {
			table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
			table.string('name').notNullable();
			table.string('address');
			table.jsonb('settings');
			table.timestamps(true, true);
		});
	}

	// Add location_id and status to vehicles if not exist
	const hasVehicles = await knex.schema.hasTable('vehicles');
	if (hasVehicles) {
		const hasLocationId = await knex.schema.hasColumn('vehicles', 'location_id');
		if (!hasLocationId) {
			await knex.schema.table('vehicles', table => {
				table.uuid('location_id').references('id').inTable('locations');
			});
		}
		const hasStatus = await knex.schema.hasColumn('vehicles', 'status');
		if (!hasStatus) {
			await knex.schema.table('vehicles', table => {
				table.enu('status', ['active', 'in_maintenance', 'out_of_service']).defaultTo('active');
			});
		}
	}

	// Work orders table (idempotent)
	const hasWorkOrders = await knex.schema.hasTable('work_orders');
	if (!hasWorkOrders && hasVehicles) {
		await knex.schema.createTable('work_orders', table => {
			table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
			table.uuid('vehicle_id').notNullable().references('id').inTable('vehicles');
			table.uuid('location_id').references('id').inTable('locations');
			table.string('description').notNullable();
			table.enu('status', ['open', 'in_progress', 'completed', 'closed']).defaultTo('open');
			table.timestamp('created_at').defaultTo(knex.fn.now());
			table.timestamp('updated_at').defaultTo(knex.fn.now());
		});
	}

	// Work order notes table
	const hasWorkOrdersTable = await knex.schema.hasTable('work_orders');
	if (hasWorkOrdersTable) {
		const hasWorkOrderNotes = await knex.schema.hasTable('work_order_notes');
		if (!hasWorkOrderNotes) {
			await knex.schema.createTable('work_order_notes', table => {
				table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
				table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
				table.text('note');
				table.string('author');
				table.timestamp('created_at').defaultTo(knex.fn.now());
			});
		}

	// Work order attachments table
		const hasWorkOrderAttachments = await knex.schema.hasTable('work_order_attachments');
		if (!hasWorkOrderAttachments) {
			await knex.schema.createTable('work_order_attachments', table => {
				table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
				table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
				table.string('filename');
				table.string('filepath');
				table.string('uploaded_by');
				table.timestamp('uploaded_at').defaultTo(knex.fn.now());
			});
		}

	// Work order labor entries table
		const hasWorkOrderLabor = await knex.schema.hasTable('work_order_labor');
		if (!hasWorkOrderLabor) {
			await knex.schema.createTable('work_order_labor', table => {
				table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
				table.uuid('work_order_id').notNullable().references('id').inTable('work_orders').onDelete('CASCADE');
				table.string('technician');
				table.float('hours');
				table.float('rate');
				table.text('description');
				table.timestamp('created_at').defaultTo(knex.fn.now());
			});
		}
	}
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
	await knex.schema.dropTableIfExists('work_order_labor');
	await knex.schema.dropTableIfExists('work_order_attachments');
	await knex.schema.dropTableIfExists('work_order_notes');
	await knex.schema.dropTableIfExists('work_orders');
	await knex.schema.dropTableIfExists('locations');
	// Optionally remove columns from vehicles
	const hasVehicles = await knex.schema.hasTable('vehicles');
	if (hasVehicles) {
		const hasLocationId = await knex.schema.hasColumn('vehicles', 'location_id');
		const hasStatus = await knex.schema.hasColumn('vehicles', 'status');
		if (hasLocationId || hasStatus) {
			await knex.schema.table('vehicles', table => {
				if (hasLocationId) table.dropColumn('location_id');
				if (hasStatus) table.dropColumn('status');
			});
		}
	}
};
