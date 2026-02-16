const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const db = require('../config/knex');

function requireRole(allowedRoles) {
	return (req, res, next) => {
		const role = req.user?.role || 'technician';
		if (!allowedRoles.includes(role)) {
			return res.status(403).json({ error: 'Forbidden: insufficient role' });
		}
		next();
	};
}

/**
 * GET /api/reports/inventory-status
 * Inventory status report: parts + per-location quantities + status
 */
router.get('/inventory-status', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;

		let query = db('inventory')
			.join('parts', 'inventory.part_id', 'parts.id')
			.join('locations', 'inventory.location_id', 'locations.id')
			.select(
				'locations.name as location_name',
				'parts.sku',
				'parts.name as part_name',
				'parts.category',
				'parts.manufacturer',
				'parts.uom',
				'parts.default_cost',
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
			.where('parts.is_active', true);

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

		const report = await query.orderBy('parts.sku', 'asc');

		dtLogger.info('inventory_status_report_generated', { rows: report.length });

		res.json({
			success: true,
			data: report,
			count: report.length
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
				'parts.uom',
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
			.where('parts.is_active', true)
			.whereRaw(
				'inventory.on_hand_qty = 0 OR (inventory.on_hand_qty - inventory.reserved_qty) <= inventory.min_stock_level'
			);

		if (locationId) {
			query = query.where('inventory.location_id', locationId);
		}

		const report = await query.orderBy('locations.name', 'asc').orderBy('severity', 'asc');

		dtLogger.info('low_stock_report_generated', { rows: report.length });

		res.json({
			success: true,
			data: report,
			count: report.length
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

		let query = db('inventory')
			.join('parts', 'inventory.part_id', 'parts.id')
			.join('locations', 'inventory.location_id', 'locations.id')
			.select(
				'locations.name as location_name',
				'parts.sku',
				'parts.name as part_name',
				'parts.category',
				'parts.default_cost',
				'inventory.on_hand_qty',
				db.raw('(inventory.on_hand_qty * COALESCE(parts.default_cost, 0))::numeric as total_value')
			)
			.where('parts.is_active', true)
			.andWhereRaw('inventory.on_hand_qty > 0');

		if (locationId) {
			query = query.where('inventory.location_id', locationId);
		}

		const rows = await query.orderBy('parts.sku', 'asc');

		// Calculate totals
		const totals = await db('inventory')
			.join('parts', 'inventory.part_id', 'parts.id')
			.select(
				db.raw('SUM(inventory.on_hand_qty)::integer as total_qty'),
				db.raw('SUM(inventory.on_hand_qty * COALESCE(parts.default_cost, 0))::numeric as total_value')
			)
			.where('parts.is_active', true)
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
router.get('/customers/summary', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
	try {
		const { from, to } = req.query;
		const query = db('maintenance_records')
			.join('customers', 'maintenance_records.customer_id', 'customers.id')
			.whereNotNull('maintenance_records.customer_id')
			.andWhere('customers.is_deleted', false)
			.modify(qb => {
				if (from) qb.andWhere('maintenance_records.date_performed', '>=', from);
				if (to) qb.andWhere('maintenance_records.date_performed', '<=', to);
			})
			.select(
				'customers.id as customer_id',
				'customers.company_name',
				db.raw('SUM(maintenance_records.cost) as total_revenue'),
				db.raw('MAX(maintenance_records.date_performed) as last_service_date')
			)
			.groupBy('customers.id', 'customers.company_name')
			.orderBy('total_revenue', 'desc');

		const rows = await query;

		res.json({
			success: true,
			data: rows
		});
	} catch (error) {
		dtLogger.error('customer_summary_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

router.get('/customers/activity', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
	try {
		const { from, to } = req.query;
		const query = db('maintenance_records')
			.join('customers', 'maintenance_records.customer_id', 'customers.id')
			.whereNotNull('maintenance_records.customer_id')
			.andWhere('customers.is_deleted', false)
			.modify(qb => {
				if (from) qb.andWhere('maintenance_records.date_performed', '>=', from);
				if (to) qb.andWhere('maintenance_records.date_performed', '<=', to);
			})
			.select(
				'customers.id as customer_id',
				'customers.company_name',
				db.raw('COUNT(maintenance_records.id) as work_orders_count'),
				db.raw('SUM(maintenance_records.cost) as total_revenue')
			)
			.groupBy('customers.id', 'customers.company_name')
			.orderBy('work_orders_count', 'desc');

		const rows = await query;

		res.json({
			success: true,
			data: rows
		});
	} catch (error) {
		dtLogger.error('customer_activity_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

router.get('/customers/aging', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
	try {
		// Placeholder until invoice data exists
		res.json({
			success: true,
			data: [],
			message: 'No invoice data available for aging report'
		});
	} catch (error) {
		dtLogger.error('customer_aging_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

router.get('/invoices/summary', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
	try {
		const { from, to, locationId } = req.query;
		let query = db('invoices').where({ is_deleted: false });
		if (from) query = query.andWhere('issued_date', '>=', from);
		if (to) query = query.andWhere('issued_date', '<=', to);
		if (locationId) query = query.andWhere('location_id', locationId);

		const totals = await query.clone().select(
			db.raw('COUNT(*) as invoice_count'),
			db.raw('SUM(total_amount) as total_revenue'),
			db.raw('SUM(amount_paid) as paid_revenue'),
			db.raw('SUM(balance_due) as outstanding_balance')
		).first();

		res.json({ success: true, data: totals });
	} catch (error) {
		dtLogger.error('invoice_summary_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

router.get('/invoices/aging', authMiddleware, requireRole(['admin', 'accounting']), async (req, res) => {
	try {
		const { asOfDate, locationId } = req.query;
		const asOf = asOfDate || new Date().toISOString().slice(0, 10);

		let base = db('invoices')
			.where({ is_deleted: false })
			.andWhere('balance_due', '>', 0)
			.andWhere('status', '!=', 'VOID');
		if (locationId) base = base.andWhere('location_id', locationId);

		const rows = await base.select(
			'id',
			'customer_id',
			'due_date',
			'balance_due',
			db.raw(`(DATE_PART('day', ?::date - due_date)) as days_past_due`, [asOf])
		);

		const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
		rows.forEach(row => {
			const days = Number(row.days_past_due) || 0;
			if (days <= 30) buckets['0-30'] += Number(row.balance_due);
			else if (days <= 60) buckets['31-60'] += Number(row.balance_due);
			else if (days <= 90) buckets['61-90'] += Number(row.balance_due);
			else buckets['90+'] += Number(row.balance_due);
		});

		res.json({ success: true, data: buckets, asOf });
	} catch (error) {
		dtLogger.error('invoice_aging_report_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

module.exports = router;
