const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const inventoryService = require('../services/inventory.service');
const db = require('../internal/db').knex;

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
 * @openapi
 * /api/inventory:
 *   get:
 *     summary: List inventory
 *     tags:
 *       - Inventory
 *     parameters:
 *       - in: query
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Inventory list returned
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
 * @openapi
 * /api/inventory/alerts:
 *   get:
 *     summary: Get inventory alerts
 *     description: Returns low-stock and out-of-stock alerts for a location. Supports severity filter (ALL, LOW, OUT).
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Location UUID
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [ALL, LOW, OUT]
 *           default: ALL
 *         description: Alert severity filter
 *     responses:
 *       200:
 *         description: Alerts list returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing locationId
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/inventory/status/{locationId}:
 *   get:
 *     summary: Get inventory status summary
 *     description: Returns aggregate inventory status metrics (total SKUs, on-hand, reserved, alert counts) for a location.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Location UUID
 *     responses:
 *       200:
 *         description: Status summary returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/inventory/location-summary:
 *   get:
 *     summary: Get inventory totals by location
 *     description: Returns on-hand and reserved quantities grouped by location across all active inventory rows.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Location summary returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       on_hand_qty:
 *                         type: number
 *                       reserved_qty:
 *                         type: number
 *                       row_count:
 *                         type: integer
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/inventory/{id}:
 *   put:
 *     summary: Update inventory settings
 *     description: Updates min stock level, bin location, and reorder quantity for an inventory record. Requires Admin or Parts Manager role.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Inventory record UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               minStockLevel:
 *                 type: number
 *                 description: Minimum stock level threshold
 *               binLocation:
 *                 type: string
 *                 description: Physical bin location identifier
 *               reorderQty:
 *                 type: number
 *                 description: Default reorder quantity
 *     responses:
 *       200:
 *         description: Inventory record updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       404:
 *         description: Inventory record not found
 *       400:
 *         description: Invalid input
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
 * @openapi
 * /api/inventory/receive:
 *   post:
 *     summary: Receive inventory
 *     description: Adds stock to inventory and writes a RECEIVE transaction. Transaction type RECEIVE increases on-hand quantity. Requires Admin, Parts Manager, or Shop Manager role.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - locationId
 *               - partId
 *               - qty
 *             properties:
 *               locationId:
 *                 type: string
 *                 format: uuid
 *               partId:
 *                 type: string
 *                 format: uuid
 *               qty:
 *                 type: number
 *                 description: Quantity to receive
 *               unitCostAtTime:
 *                 type: number
 *                 description: Unit cost at time of receipt
 *               referenceType:
 *                 type: string
 *                 description: Reference document type (e.g. PO, RECEIVING_TICKET)
 *               referenceId:
 *                 type: string
 *                 description: Reference document UUID
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Inventory received and RECEIVE transaction created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Missing required fields or invalid input
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
			notes,
			context: req.context || null
		});

		res.status(201).json({ success: true, data: result });
	} catch (error) {
		dtLogger.error('inventory_receive_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/inventory/transfer:
 *   post:
 *     summary: Create inventory transfer
 *     description: Creates an inter-location transfer and immediately posts a TRANSFER_OUT transaction reducing the source location stock. Requires Admin, Parts Manager, or Shop Manager role.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fromLocationId
 *               - toLocationId
 *               - lines
 *             properties:
 *               fromLocationId:
 *                 type: string
 *                 format: uuid
 *               toLocationId:
 *                 type: string
 *                 format: uuid
 *               lines:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     partId:
 *                       type: string
 *                       format: uuid
 *                     qty:
 *                       type: number
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Transfer created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid input or insufficient stock
 */
router.post('/transfer', authMiddleware, requireRole(['admin', 'parts_manager', 'shop_manager']), async (req, res) => {
	try {
		const { fromLocationId, toLocationId, lines, notes } = req.body || {};
		const result = await inventoryService.createTransfer({
			fromLocationId,
			toLocationId,
			lines,
			performedBy: req.user?.id,
			notes,
			context: req.context || null
		});

		res.status(201).json({ success: true, data: result });
	} catch (error) {
		dtLogger.error('inventory_transfer_create_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/inventory/transfer/{id}/receive:
 *   post:
 *     summary: Receive an inventory transfer
 *     description: Confirms receipt of a transfer at the destination location and posts a TRANSFER_IN transaction increasing the destination stock. Requires Admin, Parts Manager, or Shop Manager role.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Transfer UUID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transfer received and TRANSFER_IN transaction posted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid transfer or already received
 */
router.post('/transfer/:id/receive', authMiddleware, requireRole(['admin', 'parts_manager', 'shop_manager']), async (req, res) => {
	try {
		const result = await inventoryService.receiveTransfer({
			transferId: req.params.id,
			receivedBy: req.user?.id,
			notes: req.body?.notes,
			context: req.context || null
		});

		res.json({ success: true, data: result });
	} catch (error) {
		dtLogger.error('inventory_transfer_receive_failed', { transferId: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/inventory/consume:
 *   post:
 *     summary: Consume inventory for a work order
 *     description: Deducts stock for work-order usage and writes an ISSUE transaction. Transaction type ISSUE decreases on-hand quantity. Requires Admin, Parts Manager, Shop Manager, or Technician role.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - locationId
 *               - partId
 *               - qty
 *               - workOrderId
 *             properties:
 *               locationId:
 *                 type: string
 *                 format: uuid
 *               partId:
 *                 type: string
 *                 format: uuid
 *               qty:
 *                 type: number
 *               workOrderId:
 *                 type: string
 *                 format: uuid
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Inventory consumed and ISSUE transaction created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Missing required fields or insufficient stock
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
 * @openapi
 * /api/inventory/sale:
 *   post:
 *     summary: Create a direct customer sale
 *     description: Processes a counter sale (no work order) by deducting stock via ISSUE transactions and creating an invoice. Requires Admin, Parts Manager, Shop Manager, Service Advisor, or Accounting role.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customerId
 *               - locationId
 *               - items
 *             properties:
 *               customerId:
 *                 type: string
 *                 format: uuid
 *               locationId:
 *                 type: string
 *                 format: uuid
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     partId:
 *                       type: string
 *                       format: uuid
 *                     qty:
 *                       type: number
 *                     unitPrice:
 *                       type: number
 *               notes:
 *                 type: string
 *               taxRatePercent:
 *                 type: number
 *     responses:
 *       201:
 *         description: Sale processed, invoice created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       400:
 *         description: Missing required fields or insufficient stock
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
			performedBy: req.user?.id,
			context: req.context || null
		});

		res.status(201).json({ success: true, data: result });
	} catch (error) {
		dtLogger.error('inventory_sale_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/inventory/transactions:
 *   get:
 *     summary: List inventory transactions
 *     description: Returns an audit trail of inventory transactions. Supported transaction types are RECEIVE, ADJUST, RESERVE, ISSUE, and RETURN. Filterable by location, user, transaction type, reference, and date range.
 *     tags:
 *       - Inventory
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: locationId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by location
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by user who performed the transaction
 *       - in: query
 *         name: txType
 *         schema:
 *           type: string
 *           enum: [RECEIVE, ADJUST, RESERVE, ISSUE, RETURN, TRANSFER_OUT, TRANSFER_IN, CONSUME, CYCLE_COUNT_ADJUST]
 *         description: Filter by transaction type
 *       - in: query
 *         name: referenceType
 *         schema:
 *           type: string
 *         description: Filter by reference document type
 *       - in: query
 *         name: referenceId
 *         schema:
 *           type: string
 *         description: Filter by reference document UUID
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date filter (inclusive)
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: End date filter (inclusive)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Max rows to return
 *     responses:
 *       200:
 *         description: Transaction list returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
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
		}, req.context || null);

		res.json({ success: true, data });
	} catch (error) {
		dtLogger.error('inventory_transactions_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

module.exports = router;
