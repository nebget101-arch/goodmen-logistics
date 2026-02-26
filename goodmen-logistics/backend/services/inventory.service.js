const db = require('../config/knex');
const dtLogger = require('../utils/dynatrace-logger');

/**
 * Create an inventory transaction (append-only audit log)
 * Handles qty changes, updates inventory levels, computes alerts
 */
async function createTransaction(locationId, partId, transactionType, qtyChange, {
	unitCostAtTime = null,
	referenceType = null,
	referenceId = null,
	performedByUserId = null,
	notes = null
} = {}) {
	const trx = await db.transaction();

	try {
		// 1. Create transaction record (immutable)
		const transaction = await trx('inventory_transactions').insert({
			location_id: locationId,
			part_id: partId,
			transaction_type: transactionType,
			qty_change: qtyChange,
			unit_cost_at_time: unitCostAtTime,
			reference_type: referenceType,
			reference_id: referenceId,
			performed_by_user_id: performedByUserId,
			notes: notes
		}).returning('*');

		// 2. Update inventory on_hand_qty
		const inventory = await trx('inventory')
			.where({ location_id: locationId, part_id: partId })
			.increment('on_hand_qty', qtyChange)
			.returning('*');

		if (!inventory || inventory.length === 0) {
			throw new Error(`Inventory record not found for location ${locationId}, part ${partId}`);
		}

		const updatedInventory = inventory[0];

		// 3. Validate no negative inventory
		if (updatedInventory.on_hand_qty < 0) {
			await trx.rollback();
			throw new Error(`Inventory cannot be negative. Current: ${updatedInventory.on_hand_qty}`);
		}

		// Update last_received_at for RECEIVE type
		if (transactionType === 'RECEIVE') {
			await trx('inventory')
				.where({ location_id: locationId, part_id: partId })
				.update({ last_received_at: db.fn.now() });
		}

		// Update last_counted_at for CYCLE_COUNT_ADJUST type
		if (transactionType === 'CYCLE_COUNT_ADJUST') {
			await trx('inventory')
				.where({ location_id: locationId, part_id: partId })
				.update({ last_counted_at: db.fn.now() });
		}

		await trx.commit();

		dtLogger.info('inventory_transaction_created', {
			transactionType,
			locationId,
			partId,
			qtyChange,
			newOnHand: updatedInventory.on_hand_qty
		});

		return {
			transaction: transaction[0],
			inventory: updatedInventory
		};
	} catch (error) {
		await trx.rollback();
		dtLogger.error('inventory_transaction_failed', { locationId, partId, error: error.message });
		throw error;
	}
}

/**
 * Get alerts for a location (low stock + out of stock)
 * Returns computed alerts based on current inventory vs min levels
 */
async function getAlerts(locationId, filters = {}) {
	try {
		let query = db('inventory')
			.join('parts', 'inventory.part_id', 'parts.id')
			.select(
				'inventory.location_id',
				'inventory.part_id',
				'parts.sku',
				'parts.name',
				'inventory.on_hand_qty',
				'inventory.min_stock_level',
				'inventory.available_qty as availableQty',
				db.raw(`
					CASE 
						WHEN inventory.on_hand_qty = 0 THEN 'OUT'
						WHEN (inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level THEN 'LOW'
						ELSE 'NORMAL'
					END as severity
				`),
				'inventory.updated_at as lastActivity'
			)
			.where({ 'inventory.location_id': locationId });

		// Filter by severity if provided
		if (filters.severity && filters.severity !== 'ALL') {
			if (filters.severity === 'OUT') {
				query = query.whereRaw('inventory.on_hand_qty = 0');
			} else if (filters.severity === 'LOW') {
				query = query.whereRaw('(inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level')
					.andWhereRaw('inventory.on_hand_qty > 0');
			}
		} else {
			// Default: return OUT or LOW
			query = query.whereRaw(
				'inventory.on_hand_qty = 0 OR (inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level'
			);
		}

		const alerts = await query.orderBy('inventory.on_hand_qty', 'asc');

		dtLogger.info('alerts_retrieved', { locationId, count: alerts.length });

		return alerts;
	} catch (error) {
		dtLogger.error('alerts_retrieval_failed', { locationId, error: error.message });
		throw error;
	}
}

/**
 * Validate that an inventory operation is allowed
 */
async function validateInventoryOperation(locationId, partId, requiredQty, operationType = 'ADJUST') {
	try {
		const part = await db('parts').where({ id: partId }).first();
		if (!part) {
			throw new Error(`Part ${partId} not found`);
		}

		const inventory = await db('inventory')
			.where({ location_id: locationId, part_id: partId })
			.first();

		if (!inventory) {
			throw new Error(`Inventory record not found for location ${locationId}, part ${partId}`);
		}

		if (requiredQty < 0 && operationType !== 'ADJUST') {
			throw new Error(`Required quantity must be positive for ${operationType}`);
		}

		return { part, inventory };
	} catch (error) {
		dtLogger.error('inventory_validation_failed', { locationId, partId, error: error.message });
		throw error;
	}
}

/**
 * Get available quantity for a part at a location
 */
async function getAvailableQty(locationId, partId) {
	try {
		const inventory = await db('inventory')
			.where({ location_id: locationId, part_id: partId })
			.select(
				'on_hand_qty',
				'reserved_qty',
				db.raw('(on_hand_qty - reserved_qty) as available_qty')
			)
			.first();

		return inventory ? (inventory.on_hand_qty - inventory.reserved_qty) : 0;
	} catch (error) {
		dtLogger.error('available_qty_retrieval_failed', { locationId, partId, error: error.message });
		throw error;
	}
}

/**
 * Get inventory status for a location (summary)
 */
async function getInventoryStatus(locationId) {
	try {
		const status = await db('inventory')
			.where('location_id', locationId)
			.select(
				db.raw('COUNT(*) as total_items'),
				db.raw('COUNT(CASE WHEN on_hand_qty = 0 THEN 1 END) as out_of_stock'),
				db.raw('COUNT(CASE WHEN (on_hand_qty - reserved_qty) <= min_stock_level AND on_hand_qty > 0 THEN 1 END) as low_stock'),
				db.raw('SUM(on_hand_qty) as total_on_hand'),
				db.raw('SUM(reserved_qty) as total_reserved')
			)
			.first();

		return status;
	} catch (error) {
		dtLogger.error('inventory_status_retrieval_failed', { locationId, error: error.message });
		throw error;
	}
}

module.exports = {
	createTransaction,
	getAlerts,
	validateInventoryOperation,
	getAvailableQty,
	getInventoryStatus
};
