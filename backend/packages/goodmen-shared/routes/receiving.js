const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const inventoryService = require('../services/inventory.service');
const partsService = require('../services/parts.service');
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
 * Generate unique ticket number
 */
async function generateTicketNumber(locationId) {
	const locationPrefix = locationId.substring(0, 4).toUpperCase();
	const timestamp = Date.now();
	const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
	return `RCV-${locationPrefix}-${timestamp}-${random}`;
}

/**
 * @openapi
 * /api/receiving:
 *   get:
 *     summary: List receiving tickets
 *     description: Returns all receiving tickets for a location with their line items, ordered by creation date descending.
 *     tags:
 *       - Receiving
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
 *         description: Receiving tickets list with lines
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

		const tickets = await db('receiving_tickets')
			.where('location_id', locationId)
			.leftJoin('users as created_user', 'receiving_tickets.created_by', 'created_user.id')
			.leftJoin('users as posted_user', 'receiving_tickets.posted_by', 'posted_user.id')
			.select(
				'receiving_tickets.*',
				'created_user.name as created_by_name',
				'posted_user.name as posted_by_name'
			)
			.orderBy('receiving_tickets.created_at', 'desc');

		// Include line items
		for (const ticket of tickets) {
			const lines = await db('receiving_ticket_lines')
				.where('ticket_id', ticket.id)
				.join('parts', 'receiving_ticket_lines.part_id', 'parts.id')
				.select(
					'receiving_ticket_lines.*',
					'parts.sku',
					'parts.name',
					'parts.uom',
					'parts.default_cost'
				);

			ticket.lines = lines;
		}

		res.json({
			success: true,
			data: tickets
		});
	} catch (error) {
		dtLogger.error('receiving_tickets_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving/{id}:
 *   get:
 *     summary: Get a receiving ticket by ID
 *     description: Returns a single receiving ticket with its line items and part details.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Receiving ticket UUID
 *     responses:
 *       200:
 *         description: Receiving ticket with lines
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
 *         description: Receiving ticket not found
 *       500:
 *         description: Server error
 */
router.get('/:id', authMiddleware, async (req, res) => {
	try {
		const ticket = await db('receiving_tickets')
			.where('id', req.params.id)
			.leftJoin('users as created_user', 'receiving_tickets.created_by', 'created_user.id')
			.leftJoin('users as posted_user', 'receiving_tickets.posted_by', 'posted_user.id')
			.select(
				'receiving_tickets.*',
				'created_user.name as created_by_name',
				'posted_user.name as posted_by_name'
			)
			.first();

		if (!ticket) {
			return res.status(404).json({ error: 'Receiving ticket not found' });
		}

		// Include line items
		const lines = await db('receiving_ticket_lines')
			.where('ticket_id', ticket.id)
			.join('parts', 'receiving_ticket_lines.part_id', 'parts.id')
			.select(
				'receiving_ticket_lines.*',
				'parts.sku',
				'parts.name',
				'parts.uom',
				'parts.default_cost'
			);

		ticket.lines = lines;

		res.json({
			success: true,
			data: ticket
		});
	} catch (error) {
		dtLogger.error('receiving_ticket_get_failed', { id: req.params.id, error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving:
 *   post:
 *     summary: Create a receiving ticket
 *     description: Creates a new DRAFT receiving ticket for a location. Requires Admin or Parts Manager role.
 *     tags:
 *       - Receiving
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
 *             properties:
 *               locationId:
 *                 type: string
 *                 format: uuid
 *               vendorName:
 *                 type: string
 *               referenceNumber:
 *                 type: string
 *                 description: PO or vendor reference number
 *     responses:
 *       201:
 *         description: Receiving ticket created
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
 *         description: Missing locationId
 *       404:
 *         description: Location not found
 */
router.post('/', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const { locationId, vendorName, referenceNumber } = req.body;

		if (!locationId) {
			return res.status(400).json({ error: 'locationId is required' });
		}

		// Verify location exists
		const location = await db('locations').where('id', locationId).first();
		if (!location) {
			return res.status(404).json({ error: 'Location not found' });
		}

		const ticketNumber = await generateTicketNumber(locationId);

		const ticket = await db('receiving_tickets').insert({
			id: uuidv4(),
			location_id: locationId,
			ticket_number: ticketNumber,
			vendor_name: vendorName || null,
			reference_number: referenceNumber || null,
			status: 'DRAFT',
			created_by: req.user.id
		}).returning('*');

		dtLogger.info('receiving_ticket_created', { ticketId: ticket[0].id, ticketNumber });

		res.status(201).json({
			success: true,
			data: ticket[0],
			message: `Receiving ticket ${ticketNumber} created successfully`
		});
	} catch (error) {
		dtLogger.error('receiving_ticket_creation_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving/{id}/lines:
 *   post:
 *     summary: Add a line to a receiving ticket
 *     description: Adds a part line item to a DRAFT receiving ticket. The ticket must be in DRAFT status. Requires Admin or Parts Manager role.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Receiving ticket UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - partId
 *               - qtyReceived
 *             properties:
 *               partId:
 *                 type: string
 *                 format: uuid
 *               qtyReceived:
 *                 type: number
 *                 minimum: 1
 *               unitCost:
 *                 type: number
 *                 description: Overrides default part cost
 *               binLocationOverride:
 *                 type: string
 *                 description: Override bin location for this receipt
 *     responses:
 *       201:
 *         description: Line item added
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
 *         description: Ticket not in DRAFT status or invalid qty
 *       404:
 *         description: Ticket or part not found
 */
router.post('/:id/lines', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const { partId, qtyReceived, unitCost, binLocationOverride } = req.body;

		const ticket = await db('receiving_tickets').where('id', req.params.id).first();
		if (!ticket) {
			return res.status(404).json({ error: 'Receiving ticket not found' });
		}

		if (ticket.status !== 'DRAFT') {
			return res.status(400).json({ error: 'Cannot add lines to a posted ticket' });
		}

		// Validate part
		const part = await db('parts').where('id', partId).first();
		if (!part) {
			return res.status(404).json({ error: 'Part not found' });
		}

		if (!part.is_active) {
			return res.status(400).json({ error: `Part ${part.sku} is inactive` });
		}

		if (!qtyReceived || qtyReceived <= 0) {
			return res.status(400).json({ error: 'qtyReceived must be positive' });
		}

		const line = await db('receiving_ticket_lines').insert({
			id: uuidv4(),
			ticket_id: ticket.id,
			part_id: partId,
			qty_received: qtyReceived,
			unit_cost: unitCost || part.default_cost || null,
			bin_location_override: binLocationOverride || null
		}).returning('*');

		dtLogger.info('receiving_line_added', { ticketId: ticket.id, partId, qty: qtyReceived });

		res.status(201).json({
			success: true,
			data: line[0],
			message: 'Line item added successfully'
		});
	} catch (error) {
		dtLogger.error('receiving_line_creation_failed', { ticketId: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving/{ticketId}/lines/{lineId}:
 *   delete:
 *     summary: Remove a line from a receiving ticket
 *     description: Deletes a line item from a DRAFT receiving ticket. Cannot remove lines from posted tickets. Requires Admin or Parts Manager role.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ticketId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Receiving ticket UUID
 *       - in: path
 *         name: lineId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Line item UUID
 *     responses:
 *       200:
 *         description: Line item deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Ticket not in DRAFT status
 *       404:
 *         description: Ticket or line not found
 */
router.delete('/:ticketId/lines/:lineId', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const ticket = await db('receiving_tickets').where('id', req.params.ticketId).first();
		if (!ticket) {
			return res.status(404).json({ error: 'Receiving ticket not found' });
		}

		if (ticket.status !== 'DRAFT') {
			return res.status(400).json({ error: 'Cannot delete lines from a posted ticket' });
		}

		const line = await db('receiving_ticket_lines').where('id', req.params.lineId).first();
		if (!line) {
			return res.status(404).json({ error: 'Line item not found' });
		}

		await db('receiving_ticket_lines').where('id', req.params.lineId).del();

		dtLogger.info('receiving_line_deleted', { ticketId: req.params.ticketId, lineId: req.params.lineId });

		res.json({
			success: true,
			message: 'Line item deleted successfully'
		});
	} catch (error) {
		dtLogger.error('receiving_line_deletion_failed', { ticketId: req.params.ticketId, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/receiving/{id}/post:
 *   post:
 *     summary: Post a receiving ticket
 *     description: Finalizes a receiving ticket by creating RECEIVE inventory transactions for each line, incrementing on-hand quantities, and updating bin locations. This is a RECEIVE transaction type. Requires Admin or Parts Manager role.
 *     tags:
 *       - Receiving
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Receiving ticket UUID
 *     responses:
 *       200:
 *         description: Ticket posted and inventory updated
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
 *         description: Already posted, no lines, or invalid line data
 *       404:
 *         description: Receiving ticket not found
 */
router.post('/:id/post', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const ticket = await db('receiving_tickets').where('id', req.params.id).first();
		if (!ticket) {
			return res.status(404).json({ error: 'Receiving ticket not found' });
		}

		if (ticket.status === 'POSTED') {
			return res.status(400).json({ error: 'Ticket is already posted' });
		}

		const lines = await db('receiving_ticket_lines')
			.where('ticket_id', ticket.id)
			.join('parts', 'receiving_ticket_lines.part_id', 'parts.id');

		if (lines.length === 0) {
			return res.status(400).json({ error: 'Receiving ticket must have at least one line item' });
		}

		// Validate all lines
		for (const line of lines) {
			if (!line.qty_received || line.qty_received <= 0) {
				return res.status(400).json({ error: `Line item for part ${line.sku} has invalid qty` });
			}

			if (!line.is_active) {
				return res.status(400).json({ error: `Part ${line.sku} is inactive and cannot be received` });
			}
		}

		// Process all lines and create transactions
		const trx = await db.transaction();

		try {
			// Update ticket to POSTED
			await trx('receiving_tickets')
				.where('id', ticket.id)
				.update({
					status: 'POSTED',
					posted_by: req.user.id,
					posted_at: new Date()
				});

			// Create transactions and update inventory
			for (const line of lines) {
				const binLocation = line.bin_location_override || null;

				// Create inventory transaction
				await trx('inventory_transactions').insert({
					id: uuidv4(),
					location_id: ticket.location_id,
					part_id: line.part_id,
					transaction_type: 'RECEIVE',
					qty_change: line.qty_received,
					unit_cost_at_time: line.unit_cost || null,
					reference_type: 'RECEIVING_TICKET',
					reference_id: ticket.id,
					performed_by_user_id: req.user.id,
					notes: `Received from ${ticket.vendor_name || 'Unknown Vendor'}`
				});

				// Update inventory qty
				await trx('inventory')
					.where({ location_id: ticket.location_id, part_id: line.part_id })
					.increment('on_hand_qty', line.qty_received);

				// Also update parts.quantity_on_hand if column exists
				const partsColumns = await trx('parts').columnInfo();
				if ('quantity_on_hand' in partsColumns) {
					await trx('parts')
						.where({ id: line.part_id })
						.increment('quantity_on_hand', line.qty_received);
				}

				// Update bin location if override provided
				if (binLocation) {
					await trx('inventory')
						.where({ location_id: ticket.location_id, part_id: line.part_id })
						.update({ bin_location: binLocation });
				}

				// Update last_received_at
				await trx('inventory')
					.where({ location_id: ticket.location_id, part_id: line.part_id })
					.update({ last_received_at: new Date() });
			}

			await trx.commit();

			dtLogger.info('receiving_ticket_posted', { ticketId: ticket.id, lineCount: lines.length });

			// Fetch updated ticket
			const updatedTicket = await db('receiving_tickets').where('id', ticket.id).first();

			res.json({
				success: true,
				data: updatedTicket,
				message: `Receiving ticket posted successfully. ${lines.length} line(s) processed.`
			});
		} catch (error) {
			await trx.rollback();
			throw error;
		}
	} catch (error) {
		dtLogger.error('receiving_ticket_post_failed', { ticketId: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

module.exports = router;
