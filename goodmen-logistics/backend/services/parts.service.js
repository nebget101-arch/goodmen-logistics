const db = require('../config/knex');
const dtLogger = require('../utils/dynatrace-logger');

/**
 * Get all active parts with optional filters
 */
async function getParts(filters = {}) {
	try {
		const inventoryAgg = db('inventory')
			.select('part_id')
			.sum({ quantity_on_hand: 'on_hand_qty' })
			.groupBy('part_id')
			.as('inv');

		let query = db('parts as p')
			.leftJoin(inventoryAgg, 'p.id', 'inv.part_id')
			.select('p.*', db.raw('COALESCE(inv.quantity_on_hand, 0) as quantity_on_hand'))
			.where('p.status', 'ACTIVE');

		if (filters.category) {
			query = query.where('p.category', filters.category);
		}
		if (filters.manufacturer) {
			query = query.where('p.manufacturer', filters.manufacturer);
		}
		if (filters.search) {
			query = query.where(function() {
				this.whereRaw('LOWER(sku) LIKE ?', [`%${filters.search.toLowerCase()}%`])
					.orWhereRaw('LOWER(name) LIKE ?', [`%${filters.search.toLowerCase()}%`]);
			});
		}

		const parts = await query.orderBy('p.sku', 'asc');

		dtLogger.info('parts_retrieved', { count: parts.length });

		return parts;
	} catch (error) {
		dtLogger.error('parts_retrieval_failed', { error: error.message });
		throw error;
	}
}

/**
 * Get a single part by ID
 */
async function getPartById(id) {
	try {
		const inventoryAgg = db('inventory')
			.select('part_id')
			.sum({ quantity_on_hand: 'on_hand_qty' })
			.groupBy('part_id')
			.as('inv');

		const part = await db('parts as p')
			.leftJoin(inventoryAgg, 'p.id', 'inv.part_id')
			.select('p.*', db.raw('COALESCE(inv.quantity_on_hand, 0) as quantity_on_hand'))
			.where('p.id', id)
			.first();

		if (!part) {
			throw new Error(`Part ${id} not found`);
		}

		return part;
	} catch (error) {
		dtLogger.error('part_retrieval_failed', { id, error: error.message });
		throw error;
	}
}

/**
 * Get part by SKU
 */
async function getPartBySku(sku) {
	try {
		const inventoryAgg = db('inventory')
			.select('part_id')
			.sum({ quantity_on_hand: 'on_hand_qty' })
			.groupBy('part_id')
			.as('inv');

		const part = await db('parts as p')
			.leftJoin(inventoryAgg, 'p.id', 'inv.part_id')
			.select('p.*', db.raw('COALESCE(inv.quantity_on_hand, 0) as quantity_on_hand'))
			.where('p.sku', sku)
			.first();

		if (!part) {
			throw new Error(`Part with SKU ${sku} not found`);
		}

		return part;
	} catch (error) {
		dtLogger.error('part_by_sku_retrieval_failed', { sku, error: error.message });
		throw error;
	}
}

/**
 * Create a new part
 */
async function createPart(partData) {
	try {
		// Validate required fields
		if (!partData.sku || !partData.name) {
			throw new Error('SKU and name are required');
		}

		// Check for duplicate SKU
		const existing = await db('parts').where('sku', partData.sku).first();
		if (existing) {
			throw new Error(`Part with SKU ${partData.sku} already exists`);
		}

		const part = await db('parts').insert({
			sku: partData.sku.toUpperCase(),
			name: partData.name,
			category: partData.category,
			description: partData.description,
			unit_cost: partData.unit_cost || 0,
			unit_price: partData.unit_price || 0,
			quantity_on_hand: partData.quantity_on_hand || 0,
			reorder_level: partData.reorder_level || 5,
			supplier_id: partData.supplier_id,
			status: 'ACTIVE'
		}).returning('*');

		dtLogger.info('part_created', { id: part[0].id, sku: part[0].sku });

		return part[0];
	} catch (error) {
		dtLogger.error('part_creation_failed', { sku: partData.sku, error: error.message });
		throw error;
	}
}

/**
 * Update an existing part
 */
async function updatePart(id, partData) {
	try {
		// Check part exists
		const existing = await db('parts').where({ id }).first();
		if (!existing) {
			throw new Error(`Part ${id} not found`);
		}

		// If updating SKU, check for duplicates
		if (partData.sku && partData.sku !== existing.sku) {
			const duplicate = await db('parts').where('sku', partData.sku).first();
			if (duplicate) {
				throw new Error(`Part with SKU ${partData.sku} already exists`);
			}
		}

		const updateData = {};
		if (partData.sku) updateData.sku = partData.sku.toUpperCase();
		if (partData.name) updateData.name = partData.name;
		if (partData.category) updateData.category = partData.category;
		if (partData.description !== undefined) updateData.description = partData.description;
		if (partData.unit_cost !== undefined) updateData.unit_cost = partData.unit_cost;
		if (partData.unit_price !== undefined) updateData.unit_price = partData.unit_price;
		if (partData.quantity_on_hand !== undefined) updateData.quantity_on_hand = partData.quantity_on_hand;
		if (partData.reorder_level !== undefined) updateData.reorder_level = partData.reorder_level;
		if (partData.supplier_id !== undefined) updateData.supplier_id = partData.supplier_id;
		// Preserve status or ensure it's ACTIVE (automatic for new parts with quantity > 0)
		if (partData.status !== undefined) {
			updateData.status = partData.status;
		} else {
			// If status not provided in update, preserve existing status
			updateData.status = existing.status || 'ACTIVE';
		}

		const updated = await db('parts').where({ id }).update(updateData).returning('*');

		dtLogger.info('part_updated', { id, sku: updated[0].sku });

		return updated[0];
	} catch (error) {
		dtLogger.error('part_update_failed', { id, error: error.message });
		throw error;
	}
}

/**
 * Delete a part
 */
async function deletePart(id) {
	try {
		const part = await db('parts').where({ id }).first();
		if (!part) {
			throw new Error(`Part ${id} not found`);
		}

		await db('parts').where({ id }).del();

		dtLogger.info('part_deleted', { id, sku: part.sku });

		return { success: true, id };
	} catch (error) {
		dtLogger.error('part_deletion_failed', { id, error: error.message });
		throw error;
	}
}

/**
 * Get part categories (distinct)
 */
async function getCategories() {
	try {
		const categories = await db('parts')
			.where('status', 'ACTIVE')
			.distinct('category')
			.orderBy('category', 'asc');

		return categories.map(c => c.category).filter(c => c);
	} catch (error) {
		dtLogger.error('categories_retrieval_failed', { error: error.message });
		throw error;
	}
}

/**
 * Get all manufacturers from active parts
 */
async function getManufacturers() {
	try {
		const manufacturers = await db('parts')
			.where('status', 'ACTIVE')
			.distinct('manufacturer')
			.orderBy('manufacturer', 'asc');

		return manufacturers.map(m => m.manufacturer).filter(m => m);
	} catch (error) {
		dtLogger.error('manufacturers_retrieval_failed', { error: error.message });
		throw error;
	}
}

module.exports = {
	getParts,
	getPartById,
	getPartBySku,
	createPart,
	updatePart,
	deletePart,
	getCategories,
	getManufacturers
};
