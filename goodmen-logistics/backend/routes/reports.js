const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const db = require('../config/knex');

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

/**
 * GET /api/reports/inventory-status
 * Inventory status report: parts + per-location quantities + status
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
			.where('parts.status', 'ACTIVE');

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
			);

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
			.andWhereRaw('inventory.on_hand_qty > 0');

		if (locationId) {
			query = query.where('inventory.location_id', locationId);
		}

		const rows = await query.orderBy('parts.sku', 'asc').limit(limit).offset(offset);

		// Calculate totals
		const totals = await db('inventory')
			.join('parts', 'inventory.part_id', 'parts.id')
			.select(
				db.raw('SUM(inventory.on_hand_qty)::integer as total_qty'),
				db.raw('SUM(inventory.on_hand_qty * COALESCE(parts.unit_cost, 0))::numeric as total_value')
			)
			.where('parts.status', 'ACTIVE')
			.andWhereRaw('inventory.on_hand_qty > 0')
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
			.whereBetween('inventory_transactions.created_at', [startDate, endDate]);

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
			.whereRaw('cycle_count_lines.counted_qty != cycle_count_lines.system_on_hand_qty');

		if (locationId) {
			query = query.where('cycle_counts.location_id', locationId);
		}

		const variances = await query
			.orderBy('cycle_counts.created_at', 'desc')
			.orderBy(db.raw('ABS(variance_qty)'), 'desc');

		// Calculate summary
		const summary = await db('cycle_count_lines')
			.join('cycle_counts', 'cycle_count_lines.cycle_count_id', 'cycle_counts.id')
			.select(
				db.raw('COUNT(*) as total_lines'),
				db.raw('COUNT(CASE WHEN cycle_count_lines.counted_qty != cycle_count_lines.system_on_hand_qty THEN 1 END) as variance_lines'),
				db.raw('SUM(ABS(cycle_count_lines.counted_qty - cycle_count_lines.system_on_hand_qty))::integer as total_variance_qty')
			)
			.where('cycle_counts.status', 'APPROVED')
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
router.get('/customers/summary', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId, customerId } = req.query;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;

		const invoiceAgg = db('invoices')
			.where({ is_deleted: false })
			.modify(qb => {
				applyDateFilters(qb, 'issued_date', dateFrom, dateTo);
				if (locationId) qb.andWhere('location_id', locationId);
				if (customerId) qb.andWhere('customer_id', customerId);
			})
			.groupBy('customer_id')
			.select(
				'customer_id',
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
				if (customerId) qb.andWhere('customer_id', customerId);
			})
			.groupBy('customer_id')
			.select(
				'customer_id',
				db.raw('COUNT(*) as work_orders_count'),
				db.raw('MAX(created_at) as last_work_order_date')
			);

		const rows = await db('customers as c')
			.leftJoin(invoiceAgg.as('inv'), 'c.id', 'inv.customer_id')
			.leftJoin(workOrderAgg.as('wo'), 'c.id', 'wo.customer_id')
			.where('c.is_deleted', false)
			.modify(qb => {
				if (customerId) qb.andWhere('c.id', customerId);
			})
			.select(
				'c.id as customer_id',
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

router.get('/customers/activity', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
	try {
		const { dateFrom, dateTo, locationId, customerId } = req.query;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;

		const invoiceAgg = db('invoices')
			.where({ is_deleted: false })
			.modify(qb => {
				applyDateFilters(qb, 'issued_date', dateFrom, dateTo);
				if (locationId) qb.andWhere('location_id', locationId);
				if (customerId) qb.andWhere('customer_id', customerId);
			})
			.groupBy('customer_id')
			.select(
				'customer_id',
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
				if (customerId) qb.andWhere('customer_id', customerId);
			})
			.groupBy('customer_id')
			.select(
				'customer_id',
				db.raw('COUNT(*) as work_orders_count'),
				db.raw('MAX(created_at) as last_work_order_date')
			);

		const rows = await db('customers as c')
			.leftJoin(invoiceAgg.as('inv'), 'c.id', 'inv.customer_id')
			.leftJoin(workOrderAgg.as('wo'), 'c.id', 'wo.customer_id')
			.where('c.is_deleted', false)
			.modify(qb => {
				if (customerId) qb.andWhere('c.id', customerId);
			})
			.select(
				'c.id as customer_id',
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

router.get('/customers/aging', authMiddleware, requireRole(['admin', 'accounting', 'service_advisor']), async (req, res) => {
	try {
		const { asOfDate, locationId, customerId } = req.query;
		const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
		const offset = parseInt(req.query.offset || '0', 10) || 0;
		const asOf = asOfDate || new Date().toISOString().slice(0, 10);

		const rows = await db('invoices as i')
			.join('customers as c', 'i.customer_id', 'c.id')
			.where({ 'i.is_deleted': false })
			.andWhere('i.balance_due', '>', 0)
			.andWhere('i.status', '!=', 'VOID')
			.modify(qb => {
				if (locationId) qb.andWhere('i.location_id', locationId);
				if (customerId) qb.andWhere('i.customer_id', customerId);
			})
			.select(
				'c.id as customer_id',
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
			.join('customers', 'invoices.customer_id', 'customers.id')
			.where({ 'invoices.is_deleted': false })
			.andWhere('invoices.balance_due', '>', 0)
			.andWhere('invoices.status', '!=', 'VOID');
		if (locationId) base = base.andWhere('invoices.location_id', locationId);

		const rows = await base.select(
			'customers.company_name as customer_name',
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
			.join('customers', 'invoices.customer_id', 'customers.id')
			.leftJoin('locations', 'invoices.location_id', 'locations.id')
			.where('invoices.is_deleted', false)
			.select(
				'invoice_payments.payment_date',
				'invoices.invoice_number',
				'customers.company_name as customer_name',
				'invoice_payments.amount',
				'invoice_payments.method',
				'invoice_payments.reference_number',
				'locations.name as location_name'
			);

		applyDateFilters(query, 'invoice_payments.payment_date', dateFrom, dateTo);
		if (locationId) query = query.andWhere('invoices.location_id', locationId);
		if (customerId) query = query.andWhere('invoices.customer_id', customerId);

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
		const customerStats = await db('customers')
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

module.exports = router;
