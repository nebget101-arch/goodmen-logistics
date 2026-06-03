const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const inventoryService = require('../services/inventory.service');
const db = require('../internal/db').knex;
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
 * @openapi
 * /api/adjustments:
 *   get:
 *     summary: List inventory adjustments
 *     description: Returns all inventory adjustments for a location, including part details and creator/poster names.
 *     tags:
 *       - Adjustments
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
 *     responses:
 *       200:
 *         description: Adjustments list
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
 * @openapi
 * /api/adjustments/{id}:
 *   get:
 *     summary: Get an adjustment by ID
 *     description: Returns a single inventory adjustment with part details and creator/poster names.
 *     tags:
 *       - Adjustments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Adjustment UUID
 *     responses:
 *       200:
 *         description: Adjustment details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       404:
 *         description: Adjustment not found
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/adjustments:
 *   post:
 *     summary: Create an inventory adjustment
 *     description: Creates a new DRAFT inventory adjustment. Supports SET_TO_QTY (absolute) or DELTA (relative) adjustment types. When posted this becomes an ADJUST transaction. Valid reason codes are DAMAGED, LOST, FOUND, DATA_CORRECTION, RETURN_TO_VENDOR, OTHER. Requires Admin, Parts Manager, or Shop Manager role.
 *     tags:
 *       - Adjustments
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
 *               - adjustmentType
 *               - reasonCode
 *             properties:
 *               locationId:
 *                 type: string
 *                 format: uuid
 *               partId:
 *                 type: string
 *                 format: uuid
 *               adjustmentType:
 *                 type: string
 *                 enum: [SET_TO_QTY, DELTA]
 *               setToQty:
 *                 type: number
 *                 minimum: 0
 *                 description: Required when adjustmentType is SET_TO_QTY
 *               deltaQty:
 *                 type: number
 *                 description: Required when adjustmentType is DELTA (positive or negative)
 *               reasonCode:
 *                 type: string
 *                 enum: [DAMAGED, LOST, FOUND, DATA_CORRECTION, RETURN_TO_VENDOR, OTHER]
 *               notes:
 *                 type: string
 *                 description: Required when reasonCode is OTHER
 *               attachmentUrl:
 *                 type: string
 *     responses:
 *       201:
 *         description: Adjustment created in DRAFT status
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
 *       400:
 *         description: Validation error
 *       404:
 *         description: Part or inventory record not found
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
 * @openapi
 * /api/adjustments/{id}:
 *   put:
 *     summary: Update a draft adjustment
 *     description: Updates an inventory adjustment that is still in DRAFT status. Requires Admin, Parts Manager, or Shop Manager role.
 *     tags:
 *       - Adjustments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Adjustment UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               adjustmentType:
 *                 type: string
 *                 enum: [SET_TO_QTY, DELTA]
 *               setToQty:
 *                 type: number
 *               deltaQty:
 *                 type: number
 *               reasonCode:
 *                 type: string
 *                 enum: [DAMAGED, LOST, FOUND, DATA_CORRECTION, RETURN_TO_VENDOR, OTHER]
 *               notes:
 *                 type: string
 *               attachmentUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Adjustment updated
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
 *       400:
 *         description: Not in DRAFT status or validation error
 *       404:
 *         description: Adjustment not found
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
 * @openapi
 * /api/adjustments/{id}/post:
 *   post:
 *     summary: Post an adjustment
 *     description: Finalizes a DRAFT adjustment by creating an ADJUST inventory transaction, updating on-hand quantity, and locking the record. Negative inventory is blocked unless the user has admin role. Requires Admin or Parts Manager role.
 *     tags:
 *       - Adjustments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Adjustment UUID
 *     responses:
 *       200:
 *         description: Adjustment posted and inventory updated
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
 *       400:
 *         description: Already posted, inventory not found, or negative inventory
 *       404:
 *         description: Adjustment not found
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
