const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const inventoryService = require('../services/inventory.service');
const db = require('../config/knex');

/**
 * Permission helpers
 */
function requireRole(allowedRoles) {
	return (req, res, next) => {
		const userRole = req.user?.role || 'technician';
		if (!allowedRoles.includes(userRole)) {
			return res.status(403).json({ error: `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}` });
		}
		next();
	};
}

/**
 * GET /api/inventory
 * Get inventory for a location
 */
router.get('/', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;
		if (!locationId) {
			return res.status(400).json({ error: 'locationId query parameter is required' });
		}

		let query = db('inventory')
			.where('location_id', locationId)
			.join('parts', 'inventory.part_id', 'parts.id')
			.select(
				'inventory.id',
				'inventory.location_id',
				'inventory.part_id',
				'inventory.on_hand_qty',
				'inventory.reserved_qty',
				db.raw('(inventory.on_hand_qty - inventory.reserved_qty) as available_qty'),
				'inventory.bin_location',
				'inventory.min_stock_level',
				'inventory.reorder_qty',
				'inventory.last_counted_at',
				'inventory.last_received_at',
				'inventory.last_issued_at',
				'inventory.updated_at',
				'parts.sku',
				'parts.name',
				'parts.category',
				'parts.manufacturer',
				'parts.uom',
				'parts.default_cost',
				'parts.default_retail_price',
				db.raw(`
					CASE 
						WHEN inventory.on_hand_qty = 0 THEN 'OUT'
						WHEN (inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level THEN 'LOW'
						ELSE 'NORMAL'
					END as status
				`)
			)
			.where('parts.is_active', true);

		// Filter by category if provided
		if (req.query.category) {
			query = query.where('parts.category', req.query.category);
		}

		// Filter by search term
		if (req.query.search) {
			query = query.where(function() {
				this.whereRaw('LOWER(parts.sku) LIKE ?', [`%${req.query.search.toLowerCase()}%`])
					.orWhereRaw('LOWER(parts.name) LIKE ?', [`%${req.query.search.toLowerCase()}%`]);
			});
		}

		const inventory = await query.orderBy('parts.sku', 'asc');

		res.json({
			success: true,
			data: inventory
		});
	} catch (error) {
		dtLogger.error('inventory_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/inventory/alerts
 * Get alerts (low stock + out of stock) for a location
 */
router.get('/alerts', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;
		if (!locationId) {
			return res.status(400).json({ error: 'locationId query parameter is required' });
		}

		const filters = {
			severity: req.query.severity || 'ALL'
		};

		const alerts = await inventoryService.getAlerts(locationId, filters);

		res.json({
			success: true,
			data: alerts
		});
	} catch (error) {
		dtLogger.error('alerts_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/inventory/status/:locationId
 * Get inventory status summary for a location
 */
router.get('/status/:locationId', authMiddleware, async (req, res) => {
	try {
		const status = await inventoryService.getInventoryStatus(req.params.locationId);

		res.json({
			success: true,
			data: status
		});
	} catch (error) {
		dtLogger.error('inventory_status_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * PUT /api/inventory/:id
 * Update inventory min level and bin location
 * Requires: Admin or Parts Manager role
 */
router.put('/:id', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const { minStockLevel, binLocation, reorderQty } = req.body;

		const inventory = await db('inventory').where({ id: req.params.id }).first();
		if (!inventory) {
			return res.status(404).json({ error: 'Inventory record not found' });
		}

		const updated = await db('inventory')
			.where({ id: req.params.id })
			.update({
				min_stock_level: minStockLevel !== undefined ? minStockLevel : inventory.min_stock_level,
				bin_location: binLocation !== undefined ? binLocation : inventory.bin_location,
				reorder_qty: reorderQty !== undefined ? reorderQty : inventory.reorder_qty
			})
			.returning('*');

		res.json({
			success: true,
			data: updated[0],
			message: 'Inventory updated successfully'
		});
	} catch (error) {
		dtLogger.error('inventory_update_failed', { id: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

module.exports = router;
