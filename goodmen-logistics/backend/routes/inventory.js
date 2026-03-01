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
 * GET /api/inventory/location-summary
 * Get inventory totals grouped by location.
 */
router.get('/location-summary', authMiddleware, async (_req, res) => {
	try {
		const summary = await db
			.select(
				'locations.id',
				'locations.name',
				db.raw('COALESCE(SUM(inventory_by_location.on_hand_qty), 0) as on_hand_qty'),
				db.raw('COALESCE(SUM(inventory_by_location.reserved_qty), 0) as reserved_qty'),
				db.raw('COUNT(*) as row_count')
			)
			.from('inventory_by_location')
			.join('locations', 'locations.id', 'inventory_by_location.location_id')
			.groupBy('locations.id', 'locations.name')
			.orderBy('locations.name', 'asc');

		res.json({ success: true, data: summary });
	} catch (error) {
		dtLogger.error('inventory_location_summary_failed', { error: error.message });
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

/**
 * POST /api/inventory/receive
 * Add stock to inventory and write RECEIVE transaction
 */
router.post('/receive', authMiddleware, requireRole(['admin', 'parts_manager', 'shop_manager']), async (req, res) => {
	try {
		const { locationId, partId, qty, unitCostAtTime, referenceType, referenceId, notes } = req.body || {};
		if (!locationId || !partId || !qty) {
			return res.status(400).json({ error: 'locationId, partId and qty are required' });
		}

		const result = await inventoryService.receiveInventory({
			locationId,
			partId,
			qty,
			unitCostAtTime,
			referenceType,
			referenceId,
			performedBy: req.user?.id,
			notes
		});

		res.status(201).json({ success: true, data: result });
	} catch (error) {
		dtLogger.error('inventory_receive_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * POST /api/inventory/transfer
 * Create + send a transfer (TRANSFER_OUT posted immediately)
 */
router.post('/transfer', authMiddleware, requireRole(['admin', 'parts_manager', 'shop_manager']), async (req, res) => {
	try {
		const { fromLocationId, toLocationId, lines, notes } = req.body || {};
		const result = await inventoryService.createTransfer({
			fromLocationId,
			toLocationId,
			lines,
			performedBy: req.user?.id,
			notes
		});

		res.status(201).json({ success: true, data: result });
	} catch (error) {
		dtLogger.error('inventory_transfer_create_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * POST /api/inventory/transfer/:id/receive
 * Confirm transfer receipt (posts TRANSFER_IN)
 */
router.post('/transfer/:id/receive', authMiddleware, requireRole(['admin', 'parts_manager', 'shop_manager']), async (req, res) => {
	try {
		const result = await inventoryService.receiveTransfer({
			transferId: req.params.id,
			receivedBy: req.user?.id,
			notes: req.body?.notes
		});

		res.json({ success: true, data: result });
	} catch (error) {
		dtLogger.error('inventory_transfer_receive_failed', { transferId: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * POST /api/inventory/consume
 * Deduct stock for work order usage (CONSUME)
 */
router.post('/consume', authMiddleware, requireRole(['admin', 'parts_manager', 'shop_manager', 'technician']), async (req, res) => {
	try {
		const { locationId, partId, qty, workOrderId, notes } = req.body || {};
		if (!locationId || !partId || !qty || !workOrderId) {
			return res.status(400).json({ error: 'locationId, partId, qty and workOrderId are required' });
		}

		const result = await inventoryService.consumeInventory({
			locationId,
			partId,
			qty,
			referenceType: 'WORK_ORDER',
			referenceId: workOrderId,
			performedBy: req.user?.id,
			notes
		});

		res.status(201).json({ success: true, data: result });
	} catch (error) {
		dtLogger.error('inventory_consume_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * POST /api/inventory/sale
 * Direct customer sale (no work order): deduct stock + create invoice
 */
router.post('/sale', authMiddleware, requireRole(['admin', 'parts_manager', 'shop_manager', 'service_advisor', 'accounting']), async (req, res) => {
	try {
		const { customerId, locationId, items, notes, taxRatePercent } = req.body || {};
		if (!customerId || !locationId || !Array.isArray(items) || items.length === 0) {
			return res.status(400).json({ error: 'customerId, locationId and items[] are required' });
		}

		const result = await inventoryService.createDirectSale({
			customerId,
			locationId,
			items,
			notes,
			taxRatePercent,
			performedBy: req.user?.id
		});

		res.status(201).json({ success: true, data: result });
	} catch (error) {
		dtLogger.error('inventory_sale_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * GET /api/inventory/transactions
 * Audit trail filters: date, location, user, tx type, reference
 */
router.get('/transactions', authMiddleware, async (req, res) => {
	try {
		const data = await inventoryService.listTransactions({
			locationId: req.query.locationId,
			userId: req.query.userId,
			txType: req.query.txType,
			referenceType: req.query.referenceType,
			referenceId: req.query.referenceId,
			dateFrom: req.query.dateFrom,
			dateTo: req.query.dateTo,
			limit: req.query.limit
		});

		res.json({ success: true, data });
	} catch (error) {
		dtLogger.error('inventory_transactions_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

module.exports = router;
