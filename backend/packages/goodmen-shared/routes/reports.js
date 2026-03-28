const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const db = require('../internal/db').knex;

const v2Cache = new Map();
const V2_CACHE_TTL_MS = 60 * 1000;

let hasCompletedAtPromise = null;
function hasCompletedAtColumn() {
	if (!hasCompletedAtPromise) {
		hasCompletedAtPromise = db.schema.hasColumn('work_orders', 'completed_at');
	}
	return hasCompletedAtPromise;
}

function requireRole(allowedRoles) {
	return (req, res, next) => {
		const userRole = req.user?.role || 'technician';
		if (!allowedRoles.includes(userRole)) {
			return res.status(403).json({ error: `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}` });
		}
		next();
	};
}

function applyDateFilters(qb, dateField, from, to) {
	if (from) qb.andWhere(dateField, '>=', from);
	if (to) qb.andWhere(dateField, '<=', to);
}

function applyTenantFilter(qb, req, column = 'tenant_id') {
	if (req.context?.tenantId) {
		qb.andWhere(column, req.context.tenantId);
	}
}

function applyEntityFilter(qb, req, column = 'operating_entity_id') {
	if (req.context?.operatingEntityId) {
		qb.andWhere(function () {
			this.where(column, req.context.operatingEntityId)
				.orWhereNull(column);
		});
	}
}

/**
 * @openapi
 * /api/reports/inventory-status:
 *   get:
 *     summary: Inventory status report
 *     tags:
 *       - Reports
 *     responses:
 *       200:
 *         description: Inventory status returned
 */
router.get('/inventory-status', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;

		let query = db('inventory')
			.join('parts', 'inventory.part_id', 'parts.id')
			.join('locations', 'inventory.location_id', 'locations.id')
			.select(
				'locations.name as location_name',
				'parts.sku',
				'parts.name as part_name',
				'parts.category',
				'parts.manufacturer',
				'parts.unit_cost',
				'inventory.on_hand_qty',
				'inventory.reserved_qty',
				db.raw('(inventory.on_hand_qty - inventory.reserved_qty) as available_qty'),
				'inventory.bin_location',
				'inventory.min_stock_level',
				'inventory.reorder_qty',
				db.raw(`
					CASE 
						WHEN inventory.on_hand_qty = 0 THEN 'OUT'
						WHEN (inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level THEN 'LOW'
						ELSE 'NORMAL'
					END as status
				`),
				'inventory.last_counted_at',
				'inventory.last_received_at'
			)
			.where('parts.status', 'ACTIVE')
			.modify((qb) => applyTenantFilter(qb, req, 'locations.tenant_id'));

		if (locationId) {
			query = query.where('inventory.location_id', locationId);
		}

		if (req.query.category) {
			query = query.where('parts.category', req.query.category);
		}

		if (req.query.status) {
			if (req.query.status === 'OUT') {
				query = query.whereRaw('inventory.on_hand_qty = 0');
			} else if (req.query.status === 'LOW') {
				query = query.whereRaw('(inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level')
					.andWhereRaw('inventory.on_hand_qty > 0');
			}
		}

		const report = await query.orderBy('parts.sku', 'asc').limit(limit).offset(offset);

		dtLogger.info('inventory_status_report_generated', { rows: report.length });

		res.json({
			success: true,
			data: report,
			count: report.length,
			limit,
			offset
		});
	} catch (error) {
		dtLogger.error('inventory_status_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/reports/low-stock
 * Low and out of stock items report
 */
router.get('/low-stock', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;

		let query = db('inventory')
			.join('parts', 'inventory.part_id', 'parts.id')
			.join('locations', 'inventory.location_id', 'locations.id')
			.select(
				'locations.id as location_id',
				'locations.name as location_name',
				'parts.id as part_id',
				'parts.sku',
				'parts.name as part_name',
				'parts.category',
				'inventory.on_hand_qty',
				'inventory.reserved_qty',
				db.raw('(inventory.on_hand_qty - inventory.reserved_qty) as available_qty'),
				'inventory.min_stock_level',
				'inventory.reorder_qty',
				db.raw(`
					CASE 
						WHEN inventory.on_hand_qty = 0 THEN 'OUT'
						WHEN (inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level THEN 'LOW'
						ELSE 'NORMAL'
					END as severity
				`)
			)
			.where('parts.status', 'ACTIVE')
			.whereRaw(
				'inventory.on_hand_qty = 0 OR (inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level'
			)
			.modify((qb) => applyTenantFilter(qb, req, 'locations.tenant_id'));

		if (locationId) {
			query = query.where('inventory.location_id', locationId);
		}

		const report = await query.orderBy('locations.name', 'asc').orderBy('severity', 'asc').limit(limit).offset(offset);

		dtLogger.info('low_stock_report_generated', { rows: report.length });

		res.json({
			success: true,
			data: report,
			count: report.length,
			limit,
			offset
		});
	} catch (error) {
		dtLogger.error('low_stock_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/reports/valuation
 * Inventory valuation report: on-hand qty * cost
 */
router.get('/valuation', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;

		let query = db('inventory')
			.join('parts', 'inventory.part_id', 'parts.id')
			.join('locations', 'inventory.location_id', 'locations.id')
			.select(
				'locations.name as location_name',
				'parts.sku',
				'parts.name as part_name',
				'parts.category',
				'parts.unit_cost',
				'inventory.on_hand_qty',
				db.raw('(inventory.on_hand_qty * COALESCE(parts.unit_cost, 0))::numeric as total_value')
			)
			.where('parts.status', 'ACTIVE')
			.andWhereRaw('inventory.on_hand_qty > 0')
			.modify((qb) => applyTenantFilter(qb, req, 'locations.tenant_id'));

		if (locationId) {
			query = query.where('inventory.location_id', locationId);
		}

		const rows = await query.orderBy('parts.sku', 'asc').limit(limit).offset(offset);

		// Calculate totals
		const totals = await db('inventory')
			.join('parts', 'inventory.part_id', 'parts.id')
			.join('locations', 'inventory.location_id', 'locations.id')
			.select(
				db.raw('SUM(inventory.on_hand_qty)::integer as total_qty'),
				db.raw('SUM(inventory.on_hand_qty * COALESCE(parts.unit_cost, 0))::numeric as total_value')
			)
			.where('parts.status', 'ACTIVE')
			.andWhereRaw('inventory.on_hand_qty > 0')
			.modify((qb) => applyTenantFilter(qb, req, 'locations.tenant_id'))
			.modify(qb => {
				if (locationId) qb.where('inventory.location_id', locationId);
			})
			.first();

		dtLogger.info('valuation_report_generated', { rows: rows.length, totalValue: totals.total_value });

		res.json({
			success: true,
			data: rows,
			count: rows.length,
			limit,
			offset,
			summary: {
				totalQuantity: totals.total_qty || 0,
				totalValue: totals.total_value || 0
			}
		});
	} catch (error) {
		dtLogger.error('valuation_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/reports/movement
 * Stock movement report: InventoryTransaction history
 */
router.get('/movement', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;
		const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

		let query = db('inventory_transactions')
			.join('parts', 'inventory_transactions.part_id', 'parts.id')
			.join('locations', 'inventory_transactions.location_id', 'locations.id')
			.leftJoin('users', 'inventory_transactions.performed_by_user_id', 'users.id')
			.select(
				'locations.name as location_name',
				'parts.sku',
				'parts.name as part_name',
				'inventory_transactions.transaction_type',
				'inventory_transactions.qty_change',
				'inventory_transactions.reference_type',
				'inventory_transactions.notes',
				'users.name as performed_by_name',
				'inventory_transactions.created_at'
			)
			.whereBetween('inventory_transactions.created_at', [startDate, endDate])
			.modify((qb) => applyTenantFilter(qb, req, 'locations.tenant_id'));

		if (locationId) {
			query = query.where('inventory_transactions.location_id', locationId);
		}

		if (req.query.transactionType) {
			query = query.where('inventory_transactions.transaction_type', req.query.transactionType);
		}

		if (req.query.partId) {
			query = query.where('inventory_transactions.part_id', req.query.partId);
		}

		const transactions = await query.orderBy('inventory_transactions.created_at', 'desc');

		dtLogger.info('movement_report_generated', { rows: transactions.length });

		res.json({
			success: true,
			data: transactions,
			count: transactions.length,
			filters: {
				startDate: startDate.toISOString(),
				endDate: endDate.toISOString()
			}
		});
	} catch (error) {
		dtLogger.error('movement_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/reports/cycle-variance
 * Cycle count variance report
 */
router.get('/cycle-variance', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;

		let query = db('cycle_count_lines')
			.join('cycle_counts', 'cycle_count_lines.cycle_count_id', 'cycle_counts.id')
			.join('parts', 'cycle_count_lines.part_id', 'parts.id')
			.join('locations', 'cycle_counts.location_id', 'locations.id')
			.select(
				'cycle_counts.id as cycle_count_id',
				'locations.name as location_name',
				'parts.sku',
				'parts.name as part_name',
				'cycle_count_lines.system_on_hand_qty',
				'cycle_count_lines.counted_qty',
				db.raw('(cycle_count_lines.counted_qty - cycle_count_lines.system_on_hand_qty) as variance_qty'),
				'cycle_counts.status',
				'cycle_counts.count_date',
				'cycle_counts.created_at'
			)
			.where('cycle_counts.status', 'APPROVED')
			.whereRaw('cycle_count_lines.counted_qty != cycle_count_lines.system_on_hand_qty')
			.modify((qb) => applyTenantFilter(qb, req, 'locations.tenant_id'));

		if (locationId) {
			query = query.where('cycle_counts.location_id', locationId);
		}

		const variances = await query
			.orderBy('cycle_counts.created_at', 'desc')
			.orderBy(db.raw('ABS(variance_qty)'), 'desc');

		// Calculate summary
		const summary = await db('cycle_count_lines')
			.join('cycle_counts', 'cycle_count_lines.cycle_count_id', 'cycle_counts.id')
			.join('locations', 'cycle_counts.location_id', 'locations.id')
			.select(
				db.raw('COUNT(*) as total_lines'),
				db.raw('COUNT(CASE WHEN cycle_count_lines.counted_qty != cycle_count_lines.system_on_hand_qty THEN 1 END) as variance_lines'),
				db.raw('SUM(ABS(cycle_count_lines.counted_qty - cycle_count_lines.system_on_hand_qty))::integer as total_variance_qty')
			)
			.where('cycle_counts.status', 'APPROVED')
			.modify((qb) => applyTenantFilter(qb, req, 'locations.tenant_id'))
			.modify(qb => {
				if (locationId) qb.where('cycle_counts.location_id', locationId);
			})
			.first();

		dtLogger.info('cycle_variance_report_generated', { rows: variances.length });

		res.json({
			success: true,
			data: variances,
			count: variances.length,
			summary: summary
		});
	} catch (error) {
		dtLogger.error('cycle_variance_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

// Customer reports
router.get('/shop-clients/summary', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId, customerId } = req.query;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;

		const invoiceAgg = db('invoices')
			.where({ is_deleted: false })
			.modify(qb => {
				applyDateFilters(qb, 'issued_date', dateFrom, dateTo);
				if (locationId) qb.andWhere('location_id', locationId);
				if (customerId) qb.andWhere('shop_client_id', customerId);
			})
			.groupBy('shop_client_id')
			.select(
				'shop_client_id',
				db.raw('COUNT(*) as invoice_count'),
				db.raw('SUM(total_amount) as total_invoiced'),
				db.raw('SUM(amount_paid) as total_paid'),
				db.raw('SUM(balance_due) as total_outstanding'),
				db.raw('MAX(issued_date) as last_invoice_date')
			);

		const workOrderAgg = db('work_orders')
			.modify(qb => {
				applyDateFilters(qb, 'created_at', dateFrom, dateTo);
				if (locationId) qb.andWhere('location_id', locationId);
				if (customerId) qb.andWhere('shop_client_id', customerId);
			})
			.groupBy('shop_client_id')
			.select(
				'shop_client_id',
				db.raw('COUNT(*) as work_orders_count'),
				db.raw('MAX(created_at) as last_work_order_date')
			);

		const rows = await db('shop_clients as c')
			.leftJoin(invoiceAgg.as('inv'), 'c.id', 'inv.shop_client_id')
			.leftJoin(workOrderAgg.as('wo'), 'c.id', 'wo.shop_client_id')
			.where('c.is_deleted', false)
			.modify(qb => {
				if (customerId) qb.andWhere('c.id', customerId);
			})
			.select(
				'c.id as shop_client_id',
				'c.company_name',
				db.raw('c.primary_contact_name as contact_name'),
				'c.phone',
				'c.email',
				db.raw('COALESCE(inv.invoice_count, 0) as invoice_count'),
				db.raw('COALESCE(inv.total_invoiced, 0) as total_invoiced'),
				db.raw('COALESCE(inv.total_paid, 0) as total_paid'),
				db.raw('COALESCE(inv.total_outstanding, 0) as total_outstanding'),
				db.raw('inv.last_invoice_date as last_invoice_date'),
				db.raw('COALESCE(wo.work_orders_count, 0) as work_orders_count'),
				db.raw('wo.last_work_order_date as last_work_order_date')
			)
			.orderBy('total_invoiced', 'desc')
			.limit(limit)
			.offset(offset);

		dtLogger.info('customer_summary_report_generated', { rows: rows.length });

		res.json({
			success: true,
			data: rows,
			count: rows.length,
			limit,
			offset
		});
	} catch (error) {
		dtLogger.error('customer_summary_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

router.get('/shop-clients/activity', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId, customerId } = req.query;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;

		const invoiceAgg = db('invoices')
			.where({ is_deleted: false })
			.modify(qb => {
				applyDateFilters(qb, 'issued_date', dateFrom, dateTo);
				if (locationId) qb.andWhere('location_id', locationId);
				if (customerId) qb.andWhere('shop_client_id', customerId);
			})
			.groupBy('shop_client_id')
			.select(
				'shop_client_id',
				db.raw('COUNT(*) as invoice_count'),
				db.raw('SUM(total_amount) as total_invoiced'),
				db.raw('SUM(amount_paid) as total_paid'),
				db.raw('SUM(balance_due) as total_outstanding'),
				db.raw('MAX(issued_date) as last_invoice_date')
			);

		const workOrderAgg = db('work_orders')
			.modify(qb => {
				applyDateFilters(qb, 'created_at', dateFrom, dateTo);
				if (locationId) qb.andWhere('location_id', locationId);
				if (customerId) qb.andWhere('shop_client_id', customerId);
			})
			.groupBy('shop_client_id')
			.select(
				'shop_client_id',
				db.raw('COUNT(*) as work_orders_count'),
				db.raw('MAX(created_at) as last_work_order_date')
			);

		const rows = await db('shop_clients as c')
			.leftJoin(invoiceAgg.as('inv'), 'c.id', 'inv.shop_client_id')
			.leftJoin(workOrderAgg.as('wo'), 'c.id', 'wo.shop_client_id')
			.where('c.is_deleted', false)
			.modify(qb => {
				if (customerId) qb.andWhere('c.id', customerId);
			})
			.select(
				'c.id as shop_client_id',
				'c.company_name',
				db.raw('c.primary_contact_name as contact_name'),
				'c.phone',
				'c.email',
				db.raw('COALESCE(inv.invoice_count, 0) as invoice_count'),
				db.raw('COALESCE(wo.work_orders_count, 0) as work_orders_count'),
				db.raw('COALESCE(inv.total_invoiced, 0) as total_invoiced'),
				db.raw('COALESCE(inv.total_paid, 0) as total_paid'),
				db.raw('COALESCE(inv.total_outstanding, 0) as total_outstanding'),
				db.raw('inv.last_invoice_date as last_invoice_date'),
				db.raw('wo.last_work_order_date as last_work_order_date')
			)
			.orderByRaw('COALESCE(inv.invoice_count, 0) + COALESCE(wo.work_orders_count, 0) DESC')
			.limit(limit)
			.offset(offset);

		dtLogger.info('customer_activity_report_generated', { rows: rows.length });

		res.json({
			success: true,
			data: rows,
			count: rows.length,
			limit,
			offset
		});
	} catch (error) {
		dtLogger.error('customer_activity_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

router.get('/shop-clients/aging', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
	try {
		const { asOfDate, locationId, customerId } = req.query;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;
		const asOf = asOfDate || new Date().toISOString().slice(0, 10);

		const rows = await db('invoices as i')
			.join('shop_clients as c', 'i.shop_client_id', 'c.id')
			.where({ 'i.is_deleted': false })
			.andWhere('i.balance_due', '>', 0)
			.andWhere('i.status', '!=', 'VOID')
			.modify(qb => {
				if (locationId) qb.andWhere('i.location_id', locationId);
				if (customerId) qb.andWhere('i.shop_client_id', customerId);
			})
			.select(
				'c.id as shop_client_id',
				'c.company_name',
				db.raw(`SUM(CASE WHEN DATE_PART('day', ?::date - i.due_date) <= 30 THEN i.balance_due ELSE 0 END) as bucket_0_30`, [asOf]),
				db.raw(`SUM(CASE WHEN DATE_PART('day', ?::date - i.due_date) BETWEEN 31 AND 60 THEN i.balance_due ELSE 0 END) as bucket_31_60`, [asOf]),
				db.raw(`SUM(CASE WHEN DATE_PART('day', ?::date - i.due_date) BETWEEN 61 AND 90 THEN i.balance_due ELSE 0 END) as bucket_61_90`, [asOf]),
				db.raw(`SUM(CASE WHEN DATE_PART('day', ?::date - i.due_date) > 90 THEN i.balance_due ELSE 0 END) as bucket_90_plus`, [asOf]),
				db.raw('SUM(i.balance_due) as total_outstanding')
			)
			.groupBy('c.id', 'c.company_name')
			.orderBy('total_outstanding', 'desc')
			.limit(limit)
			.offset(offset);

		dtLogger.info('customer_aging_report_generated', { rows: rows.length, asOf });

		res.json({ success: true, data: rows, asOf, limit, offset });
	} catch (error) {
		dtLogger.error('customer_aging_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

// Vehicle reports
router.get('/vehicles/summary', authMiddleware, requireRole(['admin', 'service_advisor', 'safety']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId, status, companyOwned } = req.query;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;

		let query = db('all_vehicles as v')
			.leftJoin('locations as l', 'v.location_id', 'l.id')
			.select(
				'v.id as vehicle_id',
				'v.unit_number',
				'v.vin',
				'v.make',
				'v.model',
				'v.year',
				'v.status',
				'v.mileage',
				'v.next_pm_due',
				'v.next_pm_mileage',
				'v.inspection_expiry',
				'v.registration_expiry',
				'v.insurance_expiry',
				'l.name as location_name'
			);

		if (locationId) query = query.where('v.location_id', locationId);
		if (status) query = query.where('v.status', status);

		if (dateFrom || dateTo) {
			const from = dateFrom || '1900-01-01';
			const to = dateTo || '9999-12-31';
			query = query.whereBetween('v.next_pm_due', [from, to]);
		}

		const rows = await query.orderBy('v.unit_number', 'asc').limit(limit).offset(offset);

		dtLogger.info('vehicle_summary_report_generated', { rows: rows.length });

		res.json({ success: true, data: rows, count: rows.length, limit, offset });
	} catch (error) {
		dtLogger.error('vehicle_summary_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

router.get('/vehicles/status', authMiddleware, requireRole(['admin', 'service_advisor', 'safety']), async (req, res) => {
	try {
		const { locationId } = req.query;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;
		let base = db('all_vehicles');
		if (locationId) base = base.where('location_id', locationId);

		const rows = await base
			.select('status', db.raw('COUNT(*) as count'))
			.groupBy('status')
			.orderBy('count', 'desc')
			.limit(limit)
			.offset(offset);

		dtLogger.info('vehicle_status_report_generated', { rows: rows.length });

		res.json({ success: true, data: rows, count: rows.length, limit, offset });
	} catch (error) {
		dtLogger.error('vehicle_status_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

router.get('/vehicles/maintenance', authMiddleware, requireRole(['admin', 'service_advisor', 'safety']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId } = req.query;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;
		const from = dateFrom || new Date().toISOString().slice(0, 10);
		const to = dateTo || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

		let query = db('all_vehicles as v')
			.leftJoin('locations as l', 'v.location_id', 'l.id')
			.whereNotNull('v.next_pm_due')
			.whereBetween('v.next_pm_due', [from, to])
			.select(
				'v.id as vehicle_id',
				'v.unit_number',
				'v.vin',
				'v.make',
				'v.model',
				'v.year',
				'v.status',
				'v.mileage',
				'v.next_pm_due',
				'v.next_pm_mileage',
				'l.name as location_name'
			);

		if (locationId) query = query.andWhere('v.location_id', locationId);

		const rows = await query.orderBy('v.next_pm_due', 'asc').limit(limit).offset(offset);

		dtLogger.info('vehicle_maintenance_report_generated', { rows: rows.length, from, to });

		res.json({ success: true, data: rows, count: rows.length, range: { from, to }, limit, offset });
	} catch (error) {
		dtLogger.error('vehicle_maintenance_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

// =========================
// New Reports & Analytics
// =========================

// Dashboard KPIs
router.get('/dashboard/kpis', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor', 'technician']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId } = req.query;
		const from = dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
		const to = dateTo || new Date().toISOString().slice(0, 10);

		let invoiceBase = db('invoices').where({ is_deleted: false });
		applyDateFilters(invoiceBase, 'issued_date', from, to);
		if (locationId) invoiceBase = invoiceBase.andWhere('location_id', locationId);

		const revenue = await invoiceBase.clone().select(
			db.raw('SUM(total_amount) as total_revenue'),
			db.raw('SUM(balance_due) as total_outstanding')
		).first();

		let workOrdersBase = db('work_orders');
		applyDateFilters(workOrdersBase, 'created_at', from, to);
		if (locationId) workOrdersBase = workOrdersBase.andWhere('location_id', locationId);
		const openWorkOrders = await workOrdersBase.clone()
			.whereNotIn('status', ['completed', 'closed', 'canceled'])
			.count('* as count')
			.first();

		const hasCompletedAt = await hasCompletedAtColumn();
		const completionColumn = hasCompletedAt ? 'completed_at' : 'updated_at';
		const avgCompletion = await workOrdersBase.clone()
			.whereNotNull(completionColumn)
			.select(db.raw(`AVG(EXTRACT(EPOCH FROM (${completionColumn} - created_at)) / 3600)::numeric as avg_completion_hours`))
			.first();

		let vehiclesBase = db('all_vehicles');
		if (locationId) vehiclesBase = vehiclesBase.where('location_id', locationId);
		const vehiclesOut = await vehiclesBase.clone()
			.whereIn('status', ['OUT_OF_SERVICE', 'out_of_service'])
			.count('* as count')
			.first();

		let inventoryBase = db('inventory')
			.join('parts', 'inventory.part_id', 'parts.id')
			.where('parts.status', 'ACTIVE');
		if (locationId) inventoryBase = inventoryBase.andWhere('inventory.location_id', locationId);
		const inventoryValue = await inventoryBase.clone().select(
			db.raw('SUM(inventory.on_hand_qty * COALESCE(parts.unit_cost, 0))::numeric as total_value'),
			db.raw('SUM(CASE WHEN inventory.on_hand_qty = 0 OR (inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level THEN 1 ELSE 0 END)::integer as low_stock_items')
		).first();

		res.json({
			success: true,
			data: {
				totalRevenueMtd: Number(revenue?.total_revenue || 0),
				outstandingBalance: Number(revenue?.total_outstanding || 0),
				openWorkOrders: Number(openWorkOrders?.count || 0),
				vehiclesOutOfService: Number(vehiclesOut?.count || 0),
				inventoryValue: Number(inventoryValue?.total_value || 0),
				lowStockItems: Number(inventoryValue?.low_stock_items || 0),
				avgCompletionHours: Number(avgCompletion?.avg_completion_hours || 0)
			}
		});
	} catch (error) {
		dtLogger.error('dashboard_kpis_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

// Dashboard charts
router.get('/dashboard/charts', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor', 'technician']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId } = req.query;
		const from = dateFrom || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
		const to = dateTo || new Date().toISOString().slice(0, 10);

		let revenueBase = db('invoices').where({ is_deleted: false });
		applyDateFilters(revenueBase, 'issued_date', from, to);
		if (locationId) revenueBase = revenueBase.andWhere('location_id', locationId);

		const revenueTrend = await revenueBase
			.groupBy('issued_date')
			.select('issued_date as period', db.raw('SUM(total_amount) as total'))
			.orderBy('issued_date', 'asc');

		let woBase = db('work_orders');
		applyDateFilters(woBase, 'created_at', from, to);
		if (locationId) woBase = woBase.andWhere('location_id', locationId);
		const workOrdersByType = await woBase
			.groupBy('type')
			.select('type', db.raw('COUNT(*) as count'))
			.orderBy('count', 'desc');

		res.json({
			success: true,
			data: {
				revenueTrend,
				workOrdersByType
			}
		});
	} catch (error) {
		dtLogger.error('dashboard_charts_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

// Financial summary
router.get('/financial/summary', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId } = req.query;

		let invoiceBase = db('invoices').where({ is_deleted: false });
		applyDateFilters(invoiceBase, 'issued_date', dateFrom, dateTo);
		if (locationId) invoiceBase = invoiceBase.andWhere('location_id', locationId);

		const summary = await invoiceBase.clone().select(
			db.raw('COUNT(*) as invoice_count'),
			db.raw('SUM(total_amount) as total_invoiced'),
			db.raw('SUM(amount_paid) as total_paid'),
			db.raw('SUM(balance_due) as total_outstanding'),
			db.raw('AVG(total_amount) as average_invoice')
		).first();

		let paymentsBase = db('invoice_payments')
			.join('invoices', 'invoice_payments.invoice_id', 'invoices.id')
			.where('invoices.is_deleted', false);
		applyDateFilters(paymentsBase, 'invoice_payments.payment_date', dateFrom, dateTo);
		if (locationId) paymentsBase = paymentsBase.andWhere('invoices.location_id', locationId);

		const totalPayments = await paymentsBase.clone().select(
			db.raw('SUM(invoice_payments.amount) as total_payments')
		).first();

		const revenueByLocation = await invoiceBase
			.clone()
			.join('locations', 'invoices.location_id', 'locations.id')
			.groupBy('locations.id', 'locations.name')
			.select(
				'locations.id as location_id',
				'locations.name as location_name',
				db.raw('SUM(invoices.total_amount) as total_invoiced'),
				db.raw('SUM(invoices.amount_paid) as total_paid'),
				db.raw('SUM(invoices.balance_due) as total_outstanding')
			);

		res.json({
			success: true,
			data: {
				summary: {
					invoiceCount: Number(summary.invoice_count || 0),
					totalInvoiced: Number(summary.total_invoiced || 0),
					totalPaid: Number(summary.total_paid || 0),
					totalOutstanding: Number(summary.total_outstanding || 0),
					averageInvoice: Number(summary.average_invoice || 0),
					totalPayments: Number(totalPayments.total_payments || 0)
				},
				revenueByLocation
			}
		});
	} catch (error) {
		dtLogger.error('financial_summary_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

// Work orders summary
router.get('/work-orders/summary', authMiddleware, requireRole(['admin', 'service_advisor', 'technician']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId } = req.query;
		let base = db('work_orders');
		applyDateFilters(base, 'created_at', dateFrom, dateTo);
		if (locationId) base = base.andWhere('location_id', locationId);

		const hasCompletedAt = await hasCompletedAtColumn();
		const completionColumn = hasCompletedAt ? 'completed_at' : 'updated_at';
		const totals = await base.clone().select(
			db.raw('COUNT(*) as total'),
			db.raw("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed"),
			db.raw("SUM(CASE WHEN status NOT IN ('completed','closed','canceled') THEN 1 ELSE 0 END) as open"),
			db.raw(`AVG(EXTRACT(EPOCH FROM (${completionColumn} - created_at)) / 3600)::numeric as avg_completion_hours`)
		).first();

		const byStatus = await base.clone()
			.select('status', db.raw('COUNT(*) as count'))
			.groupBy('status')
			.orderBy('count', 'desc');

		res.json({
			success: true,
			data: {
				summary: {
					total: Number(totals?.total || 0),
					completed: Number(totals?.completed || 0),
					open: Number(totals?.open || 0),
					avgCompletionHours: Number(totals?.avg_completion_hours || 0)
				},
				byStatus
			}
		});
	} catch (error) {
		dtLogger.error('work_orders_summary_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

// Financial aging
router.get('/financial/aging', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
	try {
		const { asOfDate, locationId } = req.query;
		const asOf = asOfDate || new Date().toISOString().slice(0, 10);

		let base = db('invoices')
			.join('shop_clients', 'invoices.shop_client_id', 'shop_clients.id')
			.where({ 'invoices.is_deleted': false })
			.andWhere('invoices.balance_due', '>', 0)
			.andWhere('invoices.status', '!=', 'VOID');
		if (locationId) base = base.andWhere('invoices.location_id', locationId);

		const rows = await base.select(
			'shop_clients.company_name as customer_name',
			'invoices.invoice_number',
			'invoices.issued_date',
			'invoices.due_date',
			'invoices.balance_due',
			db.raw(`CASE
				WHEN DATE_PART('day', ?::date - invoices.due_date) <= 30 THEN '0-30'
				WHEN DATE_PART('day', ?::date - invoices.due_date) <= 60 THEN '31-60'
				WHEN DATE_PART('day', ?::date - invoices.due_date) <= 90 THEN '61-90'
				ELSE '90+'
			END as aging_bucket`, [asOf, asOf, asOf])
		);

		res.json({ success: true, data: rows, asOf });
	} catch (error) {
		dtLogger.error('financial_aging_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

// Financial payments
router.get('/financial/payments', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId, customerId } = req.query;
		let query = db('invoice_payments')
			.join('invoices', 'invoice_payments.invoice_id', 'invoices.id')
			.join('shop_clients', 'invoices.shop_client_id', 'shop_clients.id')
			.leftJoin('locations', 'invoices.location_id', 'locations.id')
			.where('invoices.is_deleted', false)
			.select(
				'invoice_payments.payment_date',
				'invoices.invoice_number',
				'shop_clients.company_name as customer_name',
				'invoice_payments.amount',
				'invoice_payments.method',
				'invoice_payments.reference_number',
				'locations.name as location_name'
			);

		applyDateFilters(query, 'invoice_payments.payment_date', dateFrom, dateTo);
		if (locationId) query = query.andWhere('invoices.location_id', locationId);
		if (customerId) query = query.andWhere('invoices.shop_client_id', customerId);

		const rows = await query.orderBy('invoice_payments.payment_date', 'desc');
		res.json({ success: true, data: rows, count: rows.length });
	} catch (error) {
		dtLogger.error('financial_payments_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

// Work order summary
router.get('/work-orders/summary', authMiddleware, requireRole(['admin', 'service_advisor']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId } = req.query;
		let base = db('work_orders');
		applyDateFilters(base, 'created_at', dateFrom, dateTo);
		if (locationId) base = base.andWhere('location_id', locationId);

		const totals = await base.clone().select(
			db.raw('COUNT(*) as total_work_orders'),
			db.raw("COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_work_orders"),
			db.raw("COUNT(CASE WHEN status IN ('open','in_progress') THEN 1 END) as open_work_orders"),
			db.raw("AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)::numeric as avg_completion_hours")
		).first();

		const byStatus = await base.clone()
			.select('status', db.raw('COUNT(*) as count'))
			.groupBy('status');

		res.json({
			success: true,
			data: {
				summary: {
					total: Number(totals.total_work_orders || 0),
					completed: Number(totals.completed_work_orders || 0),
					open: Number(totals.open_work_orders || 0),
					avgCompletionHours: Number(totals.avg_completion_hours || 0)
				},
				byStatus
			}
		});
	} catch (error) {
		dtLogger.error('work_order_summary_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

// Dashboard KPIs - using available seeded tables
router.get('/dashboard/kpis', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor', 'inventory_manager', 'technician']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId } = req.query;

		// Get work orders stats
		const workOrderStats = await db('work_orders')
			.select(
				db.raw('COUNT(*) as total'),
				db.raw("COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed"),
				db.raw("COUNT(CASE WHEN status IN ('open', 'in_progress') THEN 1 END) as open")
			)
			.first();

		// Get vehicle stats
		const vehicleStats = await db('all_vehicles')
			.select(
				db.raw('COUNT(*) as total'),
				db.raw("COUNT(CASE WHEN status = 'in-service' THEN 1 END) as active")
			)
			.first();

		// Get customer stats
		const customerStats = await db('shop_clients')
			.select(db.raw('COUNT(*) as total'))
			.first();

		res.json({
			success: true,
			data: {
				totalWorkOrders: Number(workOrderStats.total || 0),
				completedWorkOrders: Number(workOrderStats.completed || 0),
				openWorkOrders: Number(workOrderStats.open || 0),
				totalVehicles: Number(vehicleStats.total || 0),
				activeVehicles: Number(vehicleStats.active || 0),
				totalCustomers: Number(customerStats.total || 0),
				totalRevenueMtd: 0,
				outstandingBalance: 0,
				lowStockItems: 0,
				avgCompletionHours: 0
			}
		});
	} catch (error) {
		dtLogger.error('dashboard_kpis_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

// Dashboard charts
router.get('/dashboard/charts', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor', 'inventory_manager', 'technician']), async (req, res) => {
	try {
		// Get work orders by status
		const workOrdersByStatus = await db('work_orders')
			.select('status', db.raw('COUNT(*) as count'))
			.groupBy('status');

		res.json({
			success: true,
			data: {
				revenueTrend: [],
				workOrdersByStatus: workOrdersByStatus,
				topCustomers: []
			}
		});
	} catch (error) {
		dtLogger.error('dashboard_charts_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

router.get('/invoices/summary', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
	try {
		res.json({ success: true, data: { invoice_count: 0, total_revenue: 0, paid_revenue: 0, outstanding_balance: 0 } });
	} catch (error) {
		dtLogger.error('invoice_summary_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

router.get('/invoices/aging', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
	try {
		res.json({ success: true, data: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 } });
	} catch (error) {
		dtLogger.error('invoice_aging_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

const V2_ALLOWED_ROLES = ['admin', 'accounting', 'dispatcher', 'dispatch', 'owner_operator'];

function parseV2Filters(req) {
	const now = new Date();
	const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
	return {
		startDate: req.query.startDate || defaultFrom.toISOString().slice(0, 10),
		endDate: req.query.endDate || now.toISOString().slice(0, 10),
		dispatcherId: req.query.dispatcherId || null,
		driverId: req.query.driverId || null,
		status: req.query.status || null,
		period: ['day', 'week', 'month'].includes((req.query.period || '').toLowerCase()) ? req.query.period.toLowerCase() : 'week',
		limit: Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000),
		offset: Math.max(parseInt(req.query.offset || '0', 10) || 0, 0)
	};
}

function cacheKey(req, reportKey, filters) {
	return JSON.stringify({
		reportKey,
		tenantId: req.context?.tenantId || null,
		operatingEntityId: req.context?.operatingEntityId || null,
		filters
	});
}

async function withV2Cache(req, reportKey, filters, builder) {
	const key = cacheKey(req, reportKey, filters);
	const cached = v2Cache.get(key);
	if (cached && (Date.now() - cached.at) < V2_CACHE_TTL_MS) {
		return cached.payload;
	}
	const payload = await builder();
	v2Cache.set(key, { at: Date.now(), payload });
	return payload;
}

function applyContextSql(tableAlias, req, params) {
	const clauses = [];
	if (req.context?.tenantId) {
		params.push(req.context.tenantId);
		clauses.push(`${tableAlias}.tenant_id = ?`);
	}
	if (req.context?.operatingEntityId) {
		params.push(req.context.operatingEntityId);
		clauses.push(`${tableAlias}.operating_entity_id = ?`);
	}
	return clauses;
}

function isAllOperatingEntitiesMode(req) {
	return req.context?.isAllOperatingEntities === true;
}

function withOperatingEntitySummary(payload, rows, valueKey = 'total_revenue') {
	const byEntity = (rows || []).reduce((acc, row) => {
		const key = row?.operating_entity_name || 'Unassigned';
		const amount = Number(row?.[valueKey] || 0);
		acc[key] = (acc[key] || 0) + amount;
		return acc;
	}, {});

	if (Object.keys(byEntity).length === 0) {
		return payload;
	}

	const operatingEntitySubtotals = Object.entries(byEntity)
		.map(([operating_entity_name, subtotal]) => ({ operating_entity_name, subtotal }))
		.sort((a, b) => Number(b.subtotal || 0) - Number(a.subtotal || 0));

	return {
		...payload,
		summary: {
			...(payload.summary || {}),
			operatingEntitySubtotals
		}
	};
}

function periodExpression(period, dateSql) {
	if (period === 'month') return `to_char(date_trunc('month', ${dateSql}), 'YYYY-MM-01')`;
	if (period === 'day') return `to_char(date_trunc('day', ${dateSql}), 'YYYY-MM-DD')`;
	return `to_char(date_trunc('week', ${dateSql}), 'YYYY-MM-DD')`;
}

async function buildOperatingEntityFinancialSummary(req, filters) {
	if (!isAllOperatingEntitiesMode(req)) {
		return [];
	}

	const revenueParams = [filters.startDate, filters.endDate];
	const revenueClauses = ['l.completed_date IS NOT NULL', 'l.completed_date BETWEEN ? AND ?'];
	revenueClauses.push(...applyContextSql('l', req, revenueParams));
	if (filters.dispatcherId) {
		revenueParams.push(filters.dispatcherId);
		revenueClauses.push('l.dispatcher_user_id = ?');
	}
	if (filters.driverId) {
		revenueParams.push(filters.driverId);
		revenueClauses.push('l.driver_id = ?');
	}
	if (filters.status) {
		revenueParams.push(filters.status);
		revenueClauses.push('l.status = ?');
	}

	const revenueRows = (await db.raw(`
		SELECT COALESCE(oe.name, 'Unassigned') AS operating_entity_name,
			COALESCE(SUM(l.rate), 0)::numeric AS revenue
		FROM loads l
		LEFT JOIN operating_entities oe ON oe.id = l.operating_entity_id
		WHERE ${revenueClauses.join(' AND ')}
		GROUP BY 1
	`, revenueParams)).rows;

	const adjustmentParams = [filters.startDate, filters.endDate];
	const adjustmentClauses = ['pp.period_end BETWEEN ? AND ?'];
	adjustmentClauses.push(...applyContextSql('s', req, adjustmentParams));
	const adjustmentRows = (await db.raw(`
		SELECT COALESCE(oe.name, 'Unassigned') AS operating_entity_name,
			COALESCE(SUM(CASE WHEN sai.amount < 0 THEN ABS(sai.amount) ELSE sai.amount END), 0)::numeric AS expenses
		FROM settlement_adjustment_items sai
		JOIN settlements s ON s.id = sai.settlement_id
		JOIN payroll_periods pp ON pp.id = s.payroll_period_id
		LEFT JOIN operating_entities oe ON oe.id = s.operating_entity_id
		WHERE ${adjustmentClauses.join(' AND ')}
		GROUP BY 1
	`, adjustmentParams)).rows;

	const fuelParams = [filters.startDate, filters.endDate];
	const fuelClauses = ['ft.transaction_date BETWEEN ? AND ?'];
	fuelClauses.push(...applyContextSql('ft', req, fuelParams));
	const fuelRows = (await db.raw(`
		SELECT COALESCE(oe.name, 'Unassigned') AS operating_entity_name,
			COALESCE(SUM(ft.amount), 0)::numeric AS expenses
		FROM fuel_transactions ft
		LEFT JOIN operating_entities oe ON oe.id = ft.operating_entity_id
		WHERE ${fuelClauses.join(' AND ')}
		GROUP BY 1
	`, fuelParams)).rows;

	const tollParams = [filters.startDate, filters.endDate];
	const tollClauses = ['tt.transaction_date BETWEEN ? AND ?'];
	tollClauses.push(...applyContextSql('tt', req, tollParams));
	const tollRows = (await db.raw(`
		SELECT COALESCE(oe.name, 'Unassigned') AS operating_entity_name,
			COALESCE(SUM(tt.amount), 0)::numeric AS expenses
		FROM toll_transactions tt
		LEFT JOIN operating_entities oe ON oe.id = tt.operating_entity_id
		WHERE ${tollClauses.join(' AND ')}
		GROUP BY 1
	`, tollParams)).rows;

	const summary = new Map();
	const ensure = (name) => {
		if (!summary.has(name)) {
			summary.set(name, {
				operating_entity_name: name,
				revenue: 0,
				expenses: 0,
				gross_profit: 0,
			});
		}
		return summary.get(name);
	};

	for (const row of revenueRows) {
		const item = ensure(row.operating_entity_name || 'Unassigned');
		item.revenue += Number(row.revenue || 0);
		item.gross_profit = item.revenue - item.expenses;
	}
	for (const row of [...adjustmentRows, ...fuelRows, ...tollRows]) {
		const item = ensure(row.operating_entity_name || 'Unassigned');
		item.expenses += Number(row.expenses || 0);
		item.gross_profit = item.revenue - item.expenses;
	}

	return Array.from(summary.values()).sort((a, b) => Number(b.gross_profit || 0) - Number(a.gross_profit || 0));
}

async function buildOverview(req, filters) {
	const allMode = isAllOperatingEntitiesMode(req);
	const revenueParams = [filters.startDate, filters.endDate];
	const revenueClauses = ['l.completed_date IS NOT NULL', 'l.completed_date BETWEEN ? AND ?'];
	revenueClauses.push(...applyContextSql('l', req, revenueParams));
	if (filters.dispatcherId) {
		revenueParams.push(filters.dispatcherId);
		revenueClauses.push('l.dispatcher_user_id = ?');
	}
	if (filters.driverId) {
		revenueParams.push(filters.driverId);
		revenueClauses.push('l.driver_id = ?');
	}
	if (filters.status) {
		revenueParams.push(filters.status);
		revenueClauses.push('l.status = ?');
	}

	const revenueRow = (await db.raw(`
		SELECT COALESCE(SUM(l.rate), 0)::numeric AS revenue
		FROM loads l
		WHERE ${revenueClauses.join(' AND ')}
	`, revenueParams)).rows[0] || { revenue: 0 };

	const adjustmentParams = [filters.startDate, filters.endDate];
	const adjustmentClauses = ['pp.period_end BETWEEN ? AND ?'];
	adjustmentClauses.push(...applyContextSql('s', req, adjustmentParams));
	const adjustmentExpenseRow = (await db.raw(`
		SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE amount END), 0)::numeric AS amount
		FROM settlement_adjustment_items sai
		JOIN settlements s ON s.id = sai.settlement_id
		JOIN payroll_periods pp ON pp.id = s.payroll_period_id
		WHERE ${adjustmentClauses.join(' AND ')}
	`, adjustmentParams)).rows[0] || { amount: 0 };

	const fuelParams = [filters.startDate, filters.endDate];
	const fuelClauses = ['ft.transaction_date BETWEEN ? AND ?'];
	fuelClauses.push(...applyContextSql('ft', req, fuelParams));
	const fuelExpenseRow = (await db.raw(`
		SELECT COALESCE(SUM(ft.amount), 0)::numeric AS amount
		FROM fuel_transactions ft
		WHERE ${fuelClauses.join(' AND ')}
	`, fuelParams)).rows[0] || { amount: 0 };

	const tollParams = [filters.startDate, filters.endDate];
	const tollClauses = ['tt.transaction_date BETWEEN ? AND ?'];
	tollClauses.push(...applyContextSql('tt', req, tollParams));
	const tollExpenseRow = (await db.raw(`
		SELECT COALESCE(SUM(tt.amount), 0)::numeric AS amount
		FROM toll_transactions tt
		WHERE ${tollClauses.join(' AND ')}
	`, tollParams)).rows[0] || { amount: 0 };

	const revenue = Number(revenueRow.revenue || 0);
	const expenses = Number(adjustmentExpenseRow.amount || 0) + Number(fuelExpenseRow.amount || 0) + Number(tollExpenseRow.amount || 0);
	const grossProfit = revenue - expenses;

	const trend = (await db.raw(`
		SELECT
			${allMode ? "COALESCE(oe.name, 'Unassigned') AS operating_entity_name," : ''}
			${periodExpression(filters.period, 'l.completed_date')} AS period,
			COALESCE(SUM(l.rate), 0)::numeric AS revenue,
			0::numeric AS expenses,
			COALESCE(SUM(l.rate), 0)::numeric AS gross_profit
		FROM loads l
		${allMode ? 'LEFT JOIN operating_entities oe ON oe.id = l.operating_entity_id' : ''}
		WHERE ${revenueClauses.join(' AND ')}
		GROUP BY ${allMode ? '1,2' : '1'}
		ORDER BY ${allMode ? '1 ASC, 2 ASC' : '1 ASC'}
	`, revenueParams)).rows;
	const operatingEntitySubtotals = await buildOperatingEntityFinancialSummary(req, filters);

	const payload = {
		success: true,
		cards: [
			{ key: 'revenue', label: 'Revenue', value: revenue },
			{ key: 'expenses', label: 'Expenses', value: expenses },
			{ key: 'gross_profit', label: 'Gross Profit', value: grossProfit }
		],
		data: trend,
		summary: {
			revenue,
			expenses,
			grossProfit,
			...(operatingEntitySubtotals.length ? { operatingEntitySubtotals } : {})
		}
	};
	return allMode ? withOperatingEntitySummary(payload, trend, 'revenue') : payload;
}

async function buildEmails(req, filters) {
	const params = [filters.startDate, filters.endDate];
	const clauses = [
		"ie.created_at::date BETWEEN ? AND ?",
		"LOWER(ie.event_type) LIKE '%email%'"
	];
	if (req.context?.tenantId) {
		params.push(req.context.tenantId);
		clauses.push('i.tenant_id = ?');
	}
	if (req.context?.operatingEntityId) {
		params.push(req.context.operatingEntityId);
		clauses.push('i.operating_entity_id = ?');
	}

	const rows = (await db.raw(`
		SELECT ie.created_at::date AS event_date, ie.event_type, i.invoice_number, COUNT(*)::int AS count
		FROM invoice_events ie
		JOIN invoices i ON i.id = ie.invoice_id
		WHERE ${clauses.join(' AND ')}
		GROUP BY 1,2,3
		ORDER BY 1 DESC, 2 ASC
		LIMIT ${filters.limit} OFFSET ${filters.offset}
	`, params)).rows;

	return { success: true, data: rows, cards: [{ key: 'emails', label: 'Email Events', value: rows.reduce((a, b) => a + Number(b.count || 0), 0) }] };
}

async function buildTotalRevenue(req, filters) {
	const allMode = isAllOperatingEntitiesMode(req);
	const params = [filters.startDate, filters.endDate];
	const clauses = ['l.completed_date BETWEEN ? AND ?'];
	clauses.push(...applyContextSql('l', req, params));
	if (filters.dispatcherId) {
		params.push(filters.dispatcherId);
		clauses.push('l.dispatcher_user_id = ?');
	}
	if (filters.driverId) {
		params.push(filters.driverId);
		clauses.push('l.driver_id = ?');
	}

	const rows = (await db.raw(`
		SELECT
			${allMode ? "COALESCE(oe.name, 'Unassigned') AS operating_entity_name," : ''}
			${periodExpression(filters.period, 'l.completed_date')} AS period,
			COUNT(*)::int AS loads_count,
			COALESCE(SUM(l.rate), 0)::numeric AS total_revenue
		FROM loads l
		${allMode ? 'LEFT JOIN operating_entities oe ON oe.id = l.operating_entity_id' : ''}
		WHERE ${clauses.join(' AND ')}
		GROUP BY ${allMode ? '1,2' : '1'}
		ORDER BY ${allMode ? '1 ASC, 2 ASC' : '1 ASC'}
	`, params)).rows;
	const totalRevenue = rows.reduce((sum, r) => sum + Number(r.total_revenue || 0), 0);
	const payload = { success: true, data: rows, cards: [{ key: 'total_revenue', label: 'Total Revenue', value: totalRevenue }] };
	return allMode ? withOperatingEntitySummary(payload, rows, 'total_revenue') : payload;
}

async function buildRatePerMile(req, filters) {
	const allMode = isAllOperatingEntitiesMode(req);
	const params = [filters.startDate, filters.endDate];
	const clauses = ['COALESCE(sli.delivery_date, s.date) BETWEEN ? AND ?'];
	clauses.push(...applyContextSql('s', req, params));
	if (filters.driverId) {
		params.push(filters.driverId);
		clauses.push('s.driver_id = ?');
	}
	const rows = (await db.raw(`
		SELECT
			${allMode ? "COALESCE(oe.name, 'Unassigned') AS operating_entity_name," : ''}
			${periodExpression(filters.period, 'COALESCE(sli.delivery_date, s.date)')} AS period,
			COALESCE(SUM(sli.loaded_miles), 0)::numeric AS loaded_miles,
			COALESCE(SUM(sli.gross_amount), 0)::numeric AS revenue,
			CASE WHEN COALESCE(SUM(sli.loaded_miles),0) > 0
				THEN (SUM(sli.gross_amount) / SUM(sli.loaded_miles))::numeric
				ELSE 0::numeric
			END AS rpm
		FROM settlement_load_items sli
		JOIN settlements s ON s.id = sli.settlement_id
		${allMode ? 'LEFT JOIN operating_entities oe ON oe.id = s.operating_entity_id' : ''}
		WHERE ${clauses.join(' AND ')}
		GROUP BY ${allMode ? '1,2' : '1'}
		ORDER BY ${allMode ? '1 ASC, 2 ASC' : '1 ASC'}
	`, params)).rows;
	const payload = { success: true, data: rows };
	return allMode ? withOperatingEntitySummary(payload, rows, 'revenue') : payload;
}

async function buildRevenueByDispatcher(req, filters) {
	const allMode = isAllOperatingEntitiesMode(req);
	const params = [filters.startDate, filters.endDate];
	const clauses = ['l.completed_date BETWEEN ? AND ?'];
	clauses.push(...applyContextSql('l', req, params));
	if (filters.dispatcherId) {
		params.push(filters.dispatcherId);
		clauses.push('l.dispatcher_user_id = ?');
	}
	if (filters.driverId) {
		params.push(filters.driverId);
		clauses.push('l.driver_id = ?');
	}
	const rows = (await db.raw(`
		SELECT
			${allMode ? "COALESCE(oe.name, 'Unassigned') AS operating_entity_name," : ''}
			COALESCE(CONCAT_WS(' ', u.first_name, u.last_name), u.username, 'Unassigned') AS dispatcher_name,
			COUNT(*)::int AS loads_count,
			COALESCE(SUM(l.rate), 0)::numeric AS total_revenue,
			COALESCE(AVG(l.rate), 0)::numeric AS avg_revenue_per_load
		FROM loads l
		LEFT JOIN users u ON u.id = l.dispatcher_user_id
		${allMode ? 'LEFT JOIN operating_entities oe ON oe.id = l.operating_entity_id' : ''}
		WHERE ${clauses.join(' AND ')}
		GROUP BY ${allMode ? '1,2' : '1'}
		ORDER BY total_revenue DESC
		LIMIT ${filters.limit} OFFSET ${filters.offset}
	`, params)).rows;
	const payload = { success: true, data: rows };
	return allMode ? withOperatingEntitySummary(payload, rows, 'total_revenue') : payload;
}

async function buildPaymentSummary(req, filters) {
	const allMode = isAllOperatingEntitiesMode(req);
	const params = [filters.startDate, filters.endDate];
	const clauses = ['ip.payment_date BETWEEN ? AND ?'];
	if (req.context?.tenantId) {
		params.push(req.context.tenantId);
		clauses.push('i.tenant_id = ?');
	}
	if (req.context?.operatingEntityId) {
		params.push(req.context.operatingEntityId);
		clauses.push('i.operating_entity_id = ?');
	}
	const rows = (await db.raw(`
		SELECT
			${allMode ? "COALESCE(oe.name, 'Unassigned') AS operating_entity_name," : ''}
			ip.method,
			COUNT(*)::int AS payment_count,
			COALESCE(SUM(ip.amount), 0)::numeric AS total_paid
		FROM invoice_payments ip
		JOIN invoices i ON i.id = ip.invoice_id
		${allMode ? 'LEFT JOIN operating_entities oe ON oe.id = i.operating_entity_id' : ''}
		WHERE ${clauses.join(' AND ')}
		GROUP BY ${allMode ? '1,2' : 'ip.method'}
		ORDER BY total_paid DESC
	`, params)).rows;

	const outstandingParams = [];
	const outstandingClauses = ["i.status <> 'VOID'"];
	if (req.context?.tenantId) {
		outstandingParams.push(req.context.tenantId);
		outstandingClauses.push('i.tenant_id = ?');
	}
	if (req.context?.operatingEntityId) {
		outstandingParams.push(req.context.operatingEntityId);
		outstandingClauses.push('i.operating_entity_id = ?');
	}
	const outstandingRows = await db.raw(`
		SELECT COALESCE(SUM(i.balance_due), 0)::numeric AS outstanding
		FROM invoices i
		WHERE ${outstandingClauses.join(' AND ')}
	`, outstandingParams);
	const totalPaid = rows.reduce((sum, r) => sum + Number(r.total_paid || 0), 0);
	const outstanding = Number(outstandingRows.rows[0]?.outstanding || 0);
	const payload = {
		success: true,
		data: rows,
		cards: [
			{ key: 'paid', label: 'Total Paid', value: totalPaid },
			{ key: 'outstanding', label: 'Outstanding', value: outstanding }
		]
	};
	return allMode ? withOperatingEntitySummary(payload, rows, 'total_paid') : payload;
}

async function buildExpenses(req, filters) {
	const allMode = isAllOperatingEntitiesMode(req);
	const adjustmentParams = [filters.startDate, filters.endDate];
	const adjustmentClauses = ['pp.period_end BETWEEN ? AND ?'];
	adjustmentClauses.push(...applyContextSql('s', req, adjustmentParams));
	const fuelParams = [filters.startDate, filters.endDate];
	const fuelClauses = ['ft.transaction_date BETWEEN ? AND ?'];
	fuelClauses.push(...applyContextSql('ft', req, fuelParams));
	const tollParams = [filters.startDate, filters.endDate];
	const tollClauses = ['tt.transaction_date BETWEEN ? AND ?'];
	tollClauses.push(...applyContextSql('tt', req, tollParams));
	const rows = (await db.raw(`
		WITH adjustments AS (
			SELECT
				${allMode ? "COALESCE(oe.name, 'Unassigned') AS operating_entity_name," : ''}
				COALESCE(epc.name, gec.name, sai.description, 'Uncategorized') AS category,
				'settlement_adjustment' AS source,
				COUNT(*)::int AS expense_count,
				COALESCE(SUM(CASE WHEN sai.amount < 0 THEN ABS(sai.amount) ELSE sai.amount END), 0)::numeric AS total_amount
			FROM settlement_adjustment_items sai
			LEFT JOIN expense_payment_categories epc ON epc.id = sai.category_id
			LEFT JOIN global_expense_categories gec ON gec.id = sai.category_id
			JOIN settlements s ON s.id = sai.settlement_id
			${allMode ? 'LEFT JOIN operating_entities oe ON oe.id = s.operating_entity_id' : ''}
			JOIN payroll_periods pp ON pp.id = s.payroll_period_id
			WHERE ${adjustmentClauses.join(' AND ')}
			GROUP BY ${allMode ? '1,2,3' : '1,2'}
		),
		fuel AS (
			SELECT
				${allMode ? "COALESCE(oe.name, 'Unassigned') AS operating_entity_name," : ''}
				'Fuel'::text AS category,
				'fuel_transaction'::text AS source,
				COUNT(*)::int AS expense_count,
				COALESCE(SUM(ft.amount), 0)::numeric AS total_amount
			FROM fuel_transactions ft
			${allMode ? 'LEFT JOIN operating_entities oe ON oe.id = ft.operating_entity_id' : ''}
			WHERE ${fuelClauses.join(' AND ')}
			${allMode ? 'GROUP BY 1,2,3' : ''}
		),
		tolls AS (
			SELECT
				${allMode ? "COALESCE(oe.name, 'Unassigned') AS operating_entity_name," : ''}
				'Toll'::text AS category,
				'toll_transaction'::text AS source,
				COUNT(*)::int AS expense_count,
				COALESCE(SUM(tt.amount), 0)::numeric AS total_amount
			FROM toll_transactions tt
			${allMode ? 'LEFT JOIN operating_entities oe ON oe.id = tt.operating_entity_id' : ''}
			WHERE ${tollClauses.join(' AND ')}
			${allMode ? 'GROUP BY 1,2,3' : ''}
		)
		SELECT * FROM adjustments
		UNION ALL
		SELECT * FROM fuel
		UNION ALL
		SELECT * FROM tolls
		ORDER BY total_amount DESC
	`, [...adjustmentParams, ...fuelParams, ...tollParams])).rows;

	const total = rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
	const payload = { success: true, data: rows, cards: [{ key: 'expense_total', label: 'Total Expenses', value: total }] };
	return allMode ? withOperatingEntitySummary(payload, rows, 'total_amount') : payload;
}

async function buildGrossProfit(req, filters) {
	const allMode = isAllOperatingEntitiesMode(req);
	const revenue = await buildTotalRevenue(req, filters);
	const expenses = await buildExpenses(req, filters);
	const expenseTotal = Number(expenses.cards?.[0]?.value || 0);
	const revenueTotal = Number(revenue.cards?.[0]?.value || 0);
	const byEntity = await buildOperatingEntityFinancialSummary(req, filters);

	const rows = allMode && byEntity.length
		? byEntity.map((r) => ({
			operating_entity_name: r.operating_entity_name,
			period: null,
			revenue: Number(r.revenue || 0),
			expenses: Number(r.expenses || 0),
			gross_profit: Number(r.gross_profit || 0),
			margin_pct: Number(r.revenue || 0) > 0 ? (Number(r.gross_profit || 0) / Number(r.revenue || 0)) * 100 : 0
		}))
		: revenue.data.map((r) => ({
			operating_entity_name: r.operating_entity_name,
			period: r.period,
			revenue: Number(r.total_revenue || 0),
			expenses: 0,
			gross_profit: Number(r.total_revenue || 0),
			margin_pct: 100
		}));

	const payload = {
		success: true,
		data: rows,
		cards: [
			{ key: 'revenue', label: 'Revenue', value: revenueTotal },
			{ key: 'expenses', label: 'Expenses', value: expenseTotal },
			{ key: 'gross_profit', label: 'Gross Profit', value: revenueTotal - expenseTotal }
		]
	};
	return allMode ? withOperatingEntitySummary(payload, rows, 'gross_profit') : payload;
}

async function buildGrossProfitPerLoad(req, filters) {
	const allMode = isAllOperatingEntitiesMode(req);
	const params = [filters.startDate, filters.endDate];
	const clauses = ['l.completed_date BETWEEN ? AND ?'];
	clauses.push(...applyContextSql('l', req, params));
	if (filters.dispatcherId) {
		params.push(filters.dispatcherId);
		clauses.push('l.dispatcher_user_id = ?');
	}
	if (filters.driverId) {
		params.push(filters.driverId);
		clauses.push('l.driver_id = ?');
	}
	const rows = (await db.raw(`
		SELECT
			${allMode ? "COALESCE(oe.name, 'Unassigned') AS operating_entity_name," : ''}
			l.id,
			l.load_number,
			l.completed_date,
			COALESCE(l.rate, 0)::numeric AS revenue,
			(
				COALESCE((SELECT SUM(ft.amount) FROM fuel_transactions ft WHERE ft.load_id = l.id), 0)
				+
				COALESCE((SELECT SUM(tt.amount) FROM toll_transactions tt WHERE tt.load_id = l.id), 0)
				+
				COALESCE((SELECT SUM(CASE WHEN sai.amount < 0 THEN ABS(sai.amount) ELSE sai.amount END)
				FROM settlement_adjustment_items sai
				WHERE sai.source_reference_type = 'load' AND sai.source_reference_id::text = l.id::text), 0)
			)::numeric AS expenses,
			(
				COALESCE(l.rate, 0)
				-
				COALESCE((SELECT SUM(ft.amount) FROM fuel_transactions ft WHERE ft.load_id = l.id), 0)
				-
				COALESCE((SELECT SUM(tt.amount) FROM toll_transactions tt WHERE tt.load_id = l.id), 0)
			)::numeric AS gross_profit
		FROM loads l
		${allMode ? 'LEFT JOIN operating_entities oe ON oe.id = l.operating_entity_id' : ''}
		WHERE ${clauses.join(' AND ')}
		ORDER BY l.completed_date DESC
		LIMIT ${filters.limit} OFFSET ${filters.offset}
	`, params)).rows;
	const payload = { success: true, data: rows };
	return allMode ? withOperatingEntitySummary(payload, rows, 'gross_profit') : payload;
}

async function buildProfitLoss(req, filters) {
	const allMode = isAllOperatingEntitiesMode(req);
	const totalRevenue = await buildTotalRevenue(req, filters);
	const expenses = await buildExpenses(req, filters);
	const byEntity = await buildOperatingEntityFinancialSummary(req, filters);
	const rows = allMode && byEntity.length
		? byEntity.map((r) => ({
			operating_entity_name: r.operating_entity_name,
			period: null,
			revenue: Number(r.revenue || 0),
			cost_of_operations: Number(r.expenses || 0),
			gross_profit: Number(r.gross_profit || 0)
		}))
		: totalRevenue.data.map((r) => ({
			operating_entity_name: r.operating_entity_name,
			period: r.period,
			revenue: Number(r.total_revenue || 0),
			cost_of_operations: 0,
			gross_profit: Number(r.total_revenue || 0)
		}));
	const revenueTotal = Number(totalRevenue.cards?.[0]?.value || 0);
	const costTotal = Number(expenses.cards?.[0]?.value || 0);
	const payload = {
		success: true,
		data: rows,
		cards: [
			{ key: 'revenue', label: 'Revenue', value: revenueTotal },
			{ key: 'cost_of_operations', label: 'Cost of Operations', value: costTotal },
			{ key: 'gross_profit', label: 'Gross Profit', value: revenueTotal - costTotal }
		]
	};
	return allMode ? withOperatingEntitySummary(payload, rows, 'gross_profit') : payload;
}

const v2Builders = {
	overview: buildOverview,
	emails: buildEmails,
	'total-revenue': buildTotalRevenue,
	'rate-per-mile': buildRatePerMile,
	'revenue-by-dispatcher': buildRevenueByDispatcher,
	'payment-summary': buildPaymentSummary,
	expenses: buildExpenses,
	'gross-profit': buildGrossProfit,
	'gross-profit-per-load': buildGrossProfitPerLoad,
	'profit-loss': buildProfitLoss
};

for (const [key, builder] of Object.entries(v2Builders)) {
	router.get(`/v2/${key}`, authMiddleware, requireRole(V2_ALLOWED_ROLES), async (req, res) => {
		try {
			const filters = parseV2Filters(req);
			const payload = await withV2Cache(req, key, filters, () => builder(req, filters));
			res.json({
				...payload,
				meta: {
					generatedAt: new Date().toISOString(),
					reportKey: key,
					filters
				}
			});
		} catch (error) {
			dtLogger.error('reports_v2_failed', { reportKey: key, error: error.message });
			res.status(500).json({ error: error.message });
		}
	});
}

function toCsv(rows) {
	if (!Array.isArray(rows) || !rows.length) return 'No data\n';
	const headers = Object.keys(rows[0]);
	const escape = (v) => {
		const s = v === null || v === undefined ? '' : String(v);
		if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
		return s;
	};
	return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

router.get('/v2/export/:reportKey', authMiddleware, requireRole(V2_ALLOWED_ROLES), async (req, res) => {
	try {
		const reportKey = req.params.reportKey;
		const format = (req.query.format || 'csv').toString().toLowerCase();
		const builder = v2Builders[reportKey];
		if (!builder) return res.status(404).json({ error: 'Unknown report key' });
		const filters = parseV2Filters(req);
		const payload = await builder(req, filters);
		const rows = payload?.data || [];

		if (format === 'pdf') {
			let PDFDocument;
			try {
				PDFDocument = require('pdfkit');
			} catch (err) {
				dtLogger.error('reports_v2_pdfkit_missing', { error: err.message });
				return res.status(501).json({ error: 'PDF export is temporarily unavailable on this environment. Please use CSV export.' });
			}

			res.setHeader('Content-Type', 'application/pdf');
			res.setHeader('Content-Disposition', `attachment; filename="${reportKey}.pdf"`);
			const doc = new PDFDocument({ margin: 40, size: 'A4' });
			doc.pipe(res);
			doc.fontSize(16).text(`FleetNeuron Report: ${reportKey}`);
			doc.moveDown(0.5);
			doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`);
			doc.fontSize(10).text(`Date Range: ${filters.startDate} to ${filters.endDate}`);
			doc.moveDown();
			const preview = rows.slice(0, 40);
			preview.forEach((row, index) => {
				doc.fontSize(9).text(`${index + 1}. ${JSON.stringify(row)}`);
			});
			doc.end();
			return;
		}

		const csv = toCsv(rows);
		res.setHeader('Content-Type', 'text/csv; charset=utf-8');
		res.setHeader('Content-Disposition', `attachment; filename="${reportKey}.csv"`);
		res.send(csv);
	} catch (error) {
		dtLogger.error('reports_v2_export_failed', { error: error.message, report: req.params.reportKey });
		res.status(500).json({ error: error.message });
	}
});

module.exports = router;
