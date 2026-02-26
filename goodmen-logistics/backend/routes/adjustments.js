const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const inventoryService = require('../services/inventory.service');
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
 * GET /api/adjustments
 * Get inventory adjustments for a location
 */
router.get('/', authMiddleware, async (req, res) => {
	try {
		const locationId = req.query.locationId;
		if (!locationId) {
			return res.status(400).json({ error: 'locationId query parameter is required' });
		}

		const adjustments = await db('inventory_adjustments')
			.where('location_id', locationId)
			.leftJoin('users as created_user', 'inventory_adjustments.created_by', 'created_user.id')
			.leftJoin('users as posted_user', 'inventory_adjustments.posted_by', 'posted_user.id')
			.join('parts', 'inventory_adjustments.part_id', 'parts.id')
			.select(
				'inventory_adjustments.*',
				'parts.sku',
				'parts.name',
				'parts.uom',
				'created_user.name as created_by_name',
				'posted_user.name as posted_by_name'
			)
			.orderBy('inventory_adjustments.created_at', 'desc');

		res.json({
			success: true,
			data: adjustments
		});
	} catch (error) {
		dtLogger.error('adjustments_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/adjustments/:id
 * Get a single adjustment
 */
router.get('/:id', authMiddleware, async (req, res) => {
	try {
		const adjustment = await db('inventory_adjustments')
			.where('id', req.params.id)
			.leftJoin('users as created_user', 'inventory_adjustments.created_by', 'created_user.id')
			.leftJoin('users as posted_user', 'inventory_adjustments.posted_by', 'posted_user.id')
			.join('parts', 'inventory_adjustments.part_id', 'parts.id')
			.select(
				'inventory_adjustments.*',
				'parts.sku',
				'parts.name',
				'parts.uom',
				'created_user.name as created_by_name',
				'posted_user.name as posted_by_name'
			)
			.first();

		if (!adjustment) {
			return res.status(404).json({ error: 'Adjustment not found' });
		}

		res.json({
			success: true,
			data: adjustment
		});
	} catch (error) {
		dtLogger.error('adjustment_get_failed', { id: req.params.id, error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * POST /api/adjustments
 * Create a new inventory adjustment (DRAFT)
 * Requires: Admin, Parts Manager, or Shop Manager role
 */
router.post('/', authMiddleware, requireRole(['admin', 'parts_manager', 'shop_manager']), async (req, res) => {
	try {
		const {
			locationId,
			partId,
			adjustmentType,
			setToQty,
			deltaQty,
			reasonCode,
			notes,
			attachmentUrl
		} = req.body;

		if (!locationId || !partId || !adjustmentType || !reasonCode) {
			return res.status(400).json({
				error: 'locationId, partId, adjustmentType, and reasonCode are required'
			});
		}

		// Validate adjustment type
		if (!['SET_TO_QTY', 'DELTA'].includes(adjustmentType)) {
			return res.status(400).json({ error: 'adjustmentType must be SET_TO_QTY or DELTA' });
		}

		// Validate reason code
		const validReasons = ['DAMAGED', 'LOST', 'FOUND', 'DATA_CORRECTION', 'RETURN_TO_VENDOR', 'OTHER'];
		if (!validReasons.includes(reasonCode)) {
			return res.status(400).json({ error: `reasonCode must be one of: ${validReasons.join(', ')}` });
		}

		// If reasonCode is OTHER, notes are required
		if (reasonCode === 'OTHER' && !notes) {
			return res.status(400).json({ error: 'notes are required when reasonCode is OTHER' });
		}

		// Validate part
		const part = await db('parts').where('id', partId).first();
		if (!part) {
			return res.status(404).json({ error: 'Part not found' });
		}

		if (!part.is_active) {
			return res.status(400).json({ error: `Part ${part.sku} is inactive` });
		}

		// Get current inventory
		const inventory = await db('inventory')
			.where({ location_id: locationId, part_id: partId })
			.first();

		if (!inventory) {
			return res.status(404).json({ error: 'Inventory record not found' });
		}

		// Validate quantity values
		if (adjustmentType === 'SET_TO_QTY') {
			if (setToQty === undefined || setToQty === null) {
				return res.status(400).json({ error: 'setToQty is required for SET_TO_QTY adjustments' });
			}
			if (setToQty < 0) {
				return res.status(400).json({ error: 'setToQty cannot be negative' });
			}
		} else if (adjustmentType === 'DELTA') {
			if (deltaQty === undefined || deltaQty === null) {
				return res.status(400).json({ error: 'deltaQty is required for DELTA adjustments' });
			}
		}

		const adjustment = await db('inventory_adjustments').insert({
			id: uuidv4(),
			location_id: locationId,
			part_id: partId,
			adjustment_type: adjustmentType,
			set_to_qty: setToQty || null,
			delta_qty: deltaQty || null,
			reason_code: reasonCode,
			notes: notes || null,
			attachment_url: attachmentUrl || null,
			status: 'DRAFT',
			created_by: req.user.id
		}).returning('*');

		dtLogger.info('adjustment_created', { adjustmentId: adjustment[0].id, partId });

		res.status(201).json({
			success: true,
			data: adjustment[0],
			message: 'Adjustment created successfully'
		});
	} catch (error) {
		dtLogger.error('adjustment_creation_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * PUT /api/adjustments/:id
 * Update a draft adjustment
 * Requires: Admin, Parts Manager, or Shop Manager role
 */
router.put('/:id', authMiddleware, requireRole(['admin', 'parts_manager', 'shop_manager']), async (req, res) => {
	try {
		const adjustment = await db('inventory_adjustments').where('id', req.params.id).first();
		if (!adjustment) {
			return res.status(404).json({ error: 'Adjustment not found' });
		}

		if (adjustment.status !== 'DRAFT') {
			return res.status(400).json({ error: 'Can only edit draft adjustments' });
		}

		// Validate updates similar to POST
		const reasonCode = req.body.reasonCode || adjustment.reason_code;
		if (reasonCode === 'OTHER' && !req.body.notes && !adjustment.notes) {
			return res.status(400).json({ error: 'notes are required when reasonCode is OTHER' });
		}

		const updated = await db('inventory_adjustments').where('id', req.params.id).update({
			adjustment_type: req.body.adjustmentType || adjustment.adjustment_type,
			set_to_qty: req.body.setToQty !== undefined ? req.body.setToQty : adjustment.set_to_qty,
			delta_qty: req.body.deltaQty !== undefined ? req.body.deltaQty : adjustment.delta_qty,
			reason_code: reasonCode,
			notes: req.body.notes !== undefined ? req.body.notes : adjustment.notes,
			attachment_url: req.body.attachmentUrl !== undefined ? req.body.attachmentUrl : adjustment.attachment_url
		}).returning('*');

		dtLogger.info('adjustment_updated', { adjustmentId: req.params.id });

		res.json({
			success: true,
			data: updated[0],
			message: 'Adjustment updated successfully'
		});
	} catch (error) {
		dtLogger.error('adjustment_update_failed', { adjustmentId: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * POST /api/adjustments/:id/post
 * Post (finalize) an adjustment
 * Creates transaction, updates inventory, locks record
 * Requires: Admin or Parts Manager role
 */
router.post('/:id/post', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const adjustment = await db('inventory_adjustments').where('id', req.params.id).first();
		if (!adjustment) {
			return res.status(404).json({ error: 'Adjustment not found' });
		}

		if (adjustment.status === 'POSTED') {
			return res.status(400).json({ error: 'Adjustment is already posted' });
		}

		const inventory = await db('inventory')
			.where({ location_id: adjustment.location_id, part_id: adjustment.part_id })
			.first();

		if (!inventory) {
			return res.status(400).json({ error: 'Inventory record not found' });
		}

		const trx = await db.transaction();

		try {
			let newOnHand;

			if (adjustment.adjustment_type === 'SET_TO_QTY') {
				newOnHand = adjustment.set_to_qty;
			} else {
				newOnHand = inventory.on_hand_qty + adjustment.delta_qty;
			}

			// Check for negative inventory (block unless admin override)
			if (newOnHand < 0 && req.user.role !== 'admin') {
				await trx.rollback();
				return res.status(400).json({
					error: `This adjustment would result in negative inventory (${newOnHand}). Only admins can override.`
				});
			}

			const qtyChange = newOnHand - inventory.on_hand_qty;

			// Create transaction
			await trx('inventory_transactions').insert({
				id: uuidv4(),
				location_id: adjustment.location_id,
				part_id: adjustment.part_id,
				transaction_type: 'ADJUST',
				qty_change: qtyChange,
				reference_type: 'ADJUSTMENT',
				reference_id: adjustment.id,
				performed_by_user_id: req.user.id,
				notes: `${adjustment.reason_code}: ${adjustment.notes || ''}`
			});

			// Update inventory
			await trx('inventory')
				.where({ location_id: adjustment.location_id, part_id: adjustment.part_id })
				.update({ on_hand_qty: newOnHand });

			// Mark adjustment as POSTED
			await trx('inventory_adjustments').where('id', adjustment.id).update({
				status: 'POSTED',
				posted_by: req.user.id,
				posted_at: new Date()
			});

			await trx.commit();

			dtLogger.info('adjustment_posted', { adjustmentId: adjustment.id, qtyChange });

			const updatedAdjustment = await db('inventory_adjustments').where('id', adjustment.id).first();

			res.json({
				success: true,
				data: updatedAdjustment,
				message: 'Adjustment posted successfully'
			});
		} catch (error) {
			await trx.rollback();
			throw error;
		}
	} catch (error) {
		dtLogger.error('adjustment_post_failed', { adjustmentId: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

module.exports = router;
