const db = require('../config/knex');
const dtLogger = require('../utils/dynatrace-logger');

/**
 * Get all active parts with optional filters
 */
async function getParts(filters = {}) {
	try {
		let query = db('parts').where('is_active', true);

		if (filters.category) {
			query = query.where('category', filters.category);
		}
		if (filters.manufacturer) {
			query = query.where('manufacturer', filters.manufacturer);
		}
		if (filters.search) {
			query = query.where(function() {
				this.whereRaw('LOWER(sku) LIKE ?', [`%${filters.search.toLowerCase()}%`])
					.orWhereRaw('LOWER(name) LIKE ?', [`%${filters.search.toLowerCase()}%`])
					.orWhereRaw('LOWER(barcode) LIKE ?', [`%${filters.search.toLowerCase()}%`]);
			});
		}

		const parts = await query.orderBy('sku', 'asc');

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
		const part = await db('parts').where({ id, is_active: true }).first();

		if (!part) {
			throw new Error(`Part ${id} not found or is inactive`);
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
		const part = await db('parts').where({ sku }).first();

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
		if (!partData.sku || !partData.name || !partData.category || !partData.manufacturer) {
			throw new Error('SKU, name, category, and manufacturer are required');
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
			manufacturer: partData.manufacturer,
			uom: partData.uom || 'each',
			default_cost: partData.default_cost || 0,
			default_retail_price: partData.default_retail_price || 0,
			taxable: partData.taxable !== false,
			is_active: true,
			description: partData.description,
			barcode: partData.barcode,
			image_url: partData.image_url,
			core_item: partData.core_item || false,
			hazmat: partData.hazmat || false,
			warranty_days: partData.warranty_days,
			reorder_point_default: partData.reorder_point_default,
			reorder_qty_default: partData.reorder_qty_default,
			preferred_vendor_name: partData.preferred_vendor_name,
			notes: partData.notes
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

		const updated = await db('parts').where({ id }).update({
			sku: partData.sku ? partData.sku.toUpperCase() : existing.sku,
			name: partData.name || existing.name,
			category: partData.category || existing.category,
			manufacturer: partData.manufacturer || existing.manufacturer,
			uom: partData.uom || existing.uom,
			default_cost: partData.default_cost !== undefined ? partData.default_cost : existing.default_cost,
			default_retail_price: partData.default_retail_price !== undefined ? partData.default_retail_price : existing.default_retail_price,
			taxable: partData.taxable !== undefined ? partData.taxable : existing.taxable,
			description: partData.description !== undefined ? partData.description : existing.description,
			barcode: partData.barcode !== undefined ? partData.barcode : existing.barcode,
			image_url: partData.image_url !== undefined ? partData.image_url : existing.image_url,
			core_item: partData.core_item !== undefined ? partData.core_item : existing.core_item,
			hazmat: partData.hazmat !== undefined ? partData.hazmat : existing.hazmat,
			warranty_days: partData.warranty_days !== undefined ? partData.warranty_days : existing.warranty_days,
			reorder_point_default: partData.reorder_point_default !== undefined ? partData.reorder_point_default : existing.reorder_point_default,
			reorder_qty_default: partData.reorder_qty_default !== undefined ? partData.reorder_qty_default : existing.reorder_qty_default,
			preferred_vendor_name: partData.preferred_vendor_name !== undefined ? partData.preferred_vendor_name : existing.preferred_vendor_name,
			notes: partData.notes !== undefined ? partData.notes : existing.notes
		}).returning('*');

		dtLogger.info('part_updated', { id, sku: updated[0].sku });

		return updated[0];
	} catch (error) {
		dtLogger.error('part_update_failed', { id, error: error.message });
		throw error;
	}
}

/**
 * Deactivate a part (soft delete)
 * Check if part is used in any active receiving/adjustment before deactivating
 */
async function deactivatePart(id) {
	try {
		const part = await db('parts').where({ id }).first();
		if (!part) {
			throw new Error(`Part ${id} not found`);
		}

		if (!part.is_active) {
			throw new Error(`Part is already inactive`);
		}

		// Check for active receiving tickets with this part
		const activeReceiving = await db('receiving_ticket_lines')
			.join('receiving_tickets', 'receiving_ticket_lines.ticket_id', 'receiving_tickets.id')
			.where({ 'receiving_ticket_lines.part_id': id, 'receiving_tickets.status': 'DRAFT' })
			.first();

		if (activeReceiving) {
			throw new Error(`Cannot deactivate part: it's referenced in active receiving tickets`);
		}

		// Check for active adjustments
		const activeAdjustment = await db('inventory_adjustments')
			.where({ part_id: id, status: 'DRAFT' })
			.first();

		if (activeAdjustment) {
			throw new Error(`Cannot deactivate part: it's referenced in active adjustments`);
		}

		const updated = await db('parts').where({ id }).update({
			is_active: false
		}).returning('*');

		dtLogger.info('part_deactivated', { id, sku: part.sku });

		return updated[0];
	} catch (error) {
		dtLogger.error('part_deactivation_failed', { id, error: error.message });
		throw error;
	}
}

/**
 * Get part categories (distinct)
 */
async function getCategories() {
	try {
		const categories = await db('parts')
			.where('is_active', true)
			.distinct('category')
			.orderBy('category', 'asc');

		return categories.map(c => c.category);
	} catch (error) {
		dtLogger.error('categories_retrieval_failed', { error: error.message });
		throw error;
	}
}

/**
 * Get part manufacturers (distinct)
 */
async function getManufacturers() {
	try {
		const manufacturers = await db('parts')
			.where('is_active', true)
			.distinct('manufacturer')
			.orderBy('manufacturer', 'asc');

		return manufacturers.map(m => m.manufacturer);
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
	deactivatePart,
	getCategories,
	getManufacturers
};
