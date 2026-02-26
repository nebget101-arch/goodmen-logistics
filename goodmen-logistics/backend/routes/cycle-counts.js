const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const db = require('../config/knex');
const { v4: uuidv4 } = require('uuid');

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
 * GET /api/cycle-counts
 * Get cycle counts for a location
 */
router.get('/', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;
		if (!locationId) {
			return res.status(400).json({ error: 'locationId query parameter is required' });
		}

		const counts = await db('cycle_counts')
			.where('location_id', locationId)
			.leftJoin('users as created_user', 'cycle_counts.created_by', 'created_user.id')
			.leftJoin('users as assigned_user', 'cycle_counts.assigned_to_user_id', 'assigned_user.id')
			.leftJoin('users as approved_user', 'cycle_counts.approved_by', 'approved_user.id')
			.select(
				'cycle_counts.*',
				'created_user.name as created_by_name',
				'assigned_user.name as assigned_to_user_name',
				'approved_user.name as approved_by_name'
			)
			.orderBy('cycle_counts.created_at', 'desc');

		res.json({
			success: true,
			data: counts
		});
	} catch (error) {
		dtLogger.error('cycle_counts_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/cycle-counts/:id
 * Get a single cycle count with its lines
 */
router.get('/:id', authMiddleware, async (req, res) => {
	try {
		const count = await db('cycle_counts')
			.where('id', req.params.id)
			.leftJoin('users as created_user', 'cycle_counts.created_by', 'created_user.id')
			.leftJoin('users as assigned_user', 'cycle_counts.assigned_to_user_id', 'assigned_user.id')
			.leftJoin('users as approved_user', 'cycle_counts.approved_by', 'approved_user.id')
			.select(
				'cycle_counts.*',
				'created_user.name as created_by_name',
				'assigned_user.name as assigned_to_user_name',
				'approved_user.name as approved_by_name'
			)
			.first();

		if (!count) {
			return res.status(404).json({ error: 'Cycle count not found' });
		}

		// Get lines
		const lines = await db('cycle_count_lines')
			.where('cycle_count_id', count.id)
			.join('parts', 'cycle_count_lines.part_id', 'parts.id')
			.select(
				'cycle_count_lines.*',
				'parts.sku',
				'parts.name',
				'parts.uom',
				db.raw('(cycle_count_lines.counted_qty - cycle_count_lines.system_on_hand_qty) as variance_qty')
			);

		count.lines = lines;

		res.json({
			success: true,
			data: count
		});
	} catch (error) {
		dtLogger.error('cycle_count_get_failed', { id: req.params.id, error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * POST /api/cycle-counts
 * Create a new cycle count (DRAFT)
 * Method: CATEGORY, BIN_RANGE, or SELECTED_PARTS
 * Requires: Admin or Parts Manager role
 */
router.post('/', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const {
			locationId,
			method,
			filterValue,
			assignedToUserId,
			countDate
		} = req.body;

		if (!locationId || !method) {
			return res.status(400).json({ error: 'locationId and method are required' });
		}

		if (!['CATEGORY', 'BIN_RANGE', 'SELECTED_PARTS'].includes(method)) {
			return res.status(400).json({ error: 'method must be CATEGORY, BIN_RANGE, or SELECTED_PARTS' });
		}

		// Verify location exists
		const location = await db('locations').where('id', locationId).first();
		if (!location) {
			return res.status(404).json({ error: 'Location not found' });
		}

		const trx = await db.transaction();

		try {
			// Create cycle count
			const cycleCount = await trx('cycle_counts').insert({
				id: uuidv4(),
				location_id: locationId,
				method: method,
				filter_value: filterValue ? JSON.stringify(filterValue) : null,
				assigned_to_user_id: assignedToUserId || null,
				count_date: countDate || new Date(),
				status: 'DRAFT',
				created_by: req.user.id
			}).returning('*');

			// Generate lines based on method
			let partsToCount = [];

			if (method === 'CATEGORY' && filterValue) {
				partsToCount = await trx('inventory')
					.where('location_id', locationId)
					.join('parts', 'inventory.part_id', 'parts.id')
					.where('parts.category', filterValue)
					.where('parts.is_active', true)
					.select('inventory.part_id', 'inventory.on_hand_qty');
			} else if (method === 'BIN_RANGE' && filterValue) {
				// Simple bin range filter (assumes filterValue = { startBin, endBin })
				partsToCount = await trx('inventory')
					.where('location_id', locationId)
					.where('parts.is_active', true)
					.join('parts', 'inventory.part_id', 'parts.id')
					.whereRaw('inventory.bin_location BETWEEN ? AND ?', [filterValue.startBin, filterValue.endBin])
					.select('inventory.part_id', 'inventory.on_hand_qty');
			} else if (method === 'SELECTED_PARTS' && filterValue && Array.isArray(filterValue)) {
				// Count specific parts
				partsToCount = await trx('inventory')
					.where('location_id', locationId)
					.whereIn('part_id', filterValue)
					.join('parts', 'inventory.part_id', 'parts.id')
					.where('parts.is_active', true)
					.select('inventory.part_id', 'inventory.on_hand_qty');
			} else {
				// Default: all active parts at location
				partsToCount = await trx('inventory')
					.where('location_id', locationId)
					.join('parts', 'inventory.part_id', 'parts.id')
					.where('parts.is_active', true)
					.select('inventory.part_id', 'inventory.on_hand_qty');
			}

			// Create line items
			const lines = partsToCount.map(p => ({
				id: uuidv4(),
				cycle_count_id: cycleCount[0].id,
				part_id: p.part_id,
				system_on_hand_qty: p.on_hand_qty,
				counted_qty: null,
				notes: null
			}));

			if (lines.length > 0) {
				await trx('cycle_count_lines').insert(lines);
			}

			await trx.commit();

			dtLogger.info('cycle_count_created', { cycleCountId: cycleCount[0].id, lineCount: lines.length });

			const result = cycleCount[0];
			result.lines = lines;

			res.status(201).json({
				success: true,
				data: result,
				message: `Cycle count created with ${lines.length} line items`
			});
		} catch (error) {
			await trx.rollback();
			throw error;
		}
	} catch (error) {
		dtLogger.error('cycle_count_creation_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * PUT /api/cycle-counts/:id/lines/:lineId
 * Update a cycle count line with counted quantity
 * Allowed in DRAFT and COUNTING status
 */
router.put('/:id/lines/:lineId', authMiddleware, async (req, res) => {
	try {
		const { countedQty, notes } = req.body;

		const cycleCount = await db('cycle_counts').where('id', req.params.id).first();
		if (!cycleCount) {
			return res.status(404).json({ error: 'Cycle count not found' });
		}

		if (!['DRAFT', 'COUNTING'].includes(cycleCount.status)) {
			return res.status(400).json({ error: 'Can only edit lines in DRAFT or COUNTING status' });
		}

		if (countedQty === undefined || countedQty === null) {
			return res.status(400).json({ error: 'countedQty is required' });
		}

		if (countedQty < 0) {
			return res.status(400).json({ error: 'countedQty cannot be negative' });
		}

		const line = await db('cycle_count_lines').where('id', req.params.lineId).first();
		if (!line) {
			return res.status(404).json({ error: 'Line item not found' });
		}

		const updated = await db('cycle_count_lines')
			.where('id', req.params.lineId)
			.update({
				counted_qty: countedQty,
				notes: notes || null
			})
			.returning('*');

		dtLogger.info('cycle_count_line_updated', { cycleCountId: req.params.id, lineId: req.params.lineId });

		res.json({
			success: true,
			data: updated[0],
			message: 'Line updated successfully'
		});
	} catch (error) {
		dtLogger.error('cycle_count_line_update_failed', { cycleCountId: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * POST /api/cycle-counts/:id/submit
 * Submit a cycle count (transition to SUBMITTED)
 * All lines must have countedQty
 */
router.post('/:id/submit', authMiddleware, async (req, res) => {
	try {
		const cycleCount = await db('cycle_counts').where('id', req.params.id).first();
		if (!cycleCount) {
			return res.status(404).json({ error: 'Cycle count not found' });
		}

		if (cycleCount.status !== 'DRAFT' && cycleCount.status !== 'COUNTING') {
			return res.status(400).json({ error: `Cannot submit cycle count in ${cycleCount.status} status` });
		}

		// Check all lines have counted_qty
		const incompleteLines = await db('cycle_count_lines')
			.where('cycle_count_id', req.params.id)
			.whereNull('counted_qty');

		if (incompleteLines.length > 0) {
			return res.status(400).json({
				error: `Cannot submit: ${incompleteLines.length} line(s) missing counted quantity`
			});
		}

		const updated = await db('cycle_counts')
			.where('id', req.params.id)
			.update({
				status: 'SUBMITTED'
			})
			.returning('*');

		dtLogger.info('cycle_count_submitted', { cycleCountId: req.params.id });

		res.json({
			success: true,
			data: updated[0],
			message: 'Cycle count submitted successfully'
		});
	} catch (error) {
		dtLogger.error('cycle_count_submit_failed', { cycleCountId: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * POST /api/cycle-counts/:id/approve
 * Approve a cycle count and post variances
 * Creates inventory transactions for variance qty
 * Requires: Admin or Parts Manager role
 */
router.post('/:id/approve', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const cycleCount = await db('cycle_counts').where('id', req.params.id).first();
		if (!cycleCount) {
			return res.status(404).json({ error: 'Cycle count not found' });
		}

		if (cycleCount.status !== 'SUBMITTED') {
			return res.status(400).json({ error: `Cannot approve cycle count in ${cycleCount.status} status` });
		}

		const lines = await db('cycle_count_lines')
			.where('cycle_count_id', req.params.id)
			.join('parts', 'cycle_count_lines.part_id', 'parts.id')
			.select(
				'cycle_count_lines.*',
				'parts.sku'
			);

		const trx = await db.transaction();

		try {
			// Process each line
			for (const line of lines) {
				const variance = line.counted_qty - line.system_on_hand_qty;

				if (variance !== 0) {
					// Create transaction for variance
					await trx('inventory_transactions').insert({
						id: uuidv4(),
						location_id: cycleCount.location_id,
						part_id: line.part_id,
						transaction_type: 'CYCLE_COUNT_ADJUST',
						qty_change: variance,
						reference_type: 'CYCLE_COUNT',
						reference_id: cycleCount.id,
						performed_by_user_id: req.user.id,
						notes: `Variance from cycle count: system=${line.system_on_hand_qty}, counted=${line.counted_qty}`
					});

					// Update inventory to counted quantity
					await trx('inventory')
						.where({ location_id: cycleCount.location_id, part_id: line.part_id })
						.update({
							on_hand_qty: line.counted_qty,
							last_counted_at: new Date()
						});
				}
			}

			// Mark cycle count as APPROVED
			await trx('cycle_counts')
				.where('id', req.params.id)
				.update({
					status: 'APPROVED',
					approved_by: req.user.id,
					approved_at: new Date()
				});

			await trx.commit();

			dtLogger.info('cycle_count_approved', { cycleCountId: req.params.id, lineCount: lines.length });

			const updated = await db('cycle_counts').where('id', req.params.id).first();

			res.json({
				success: true,
				data: updated,
				message: `Cycle count approved. ${lines.filter(l => l.counted_qty !== l.system_on_hand_qty).length} variance(s) posted.`
			});
		} catch (error) {
			await trx.rollback();
			throw error;
		}
	} catch (error) {
		dtLogger.error('cycle_count_approval_failed', { cycleCountId: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

module.exports = router;
