const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const inventoryService = require('../services/inventory.service');
const partsService = require('../services/parts.service');
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
 * Generate unique ticket number
 */
async function generateTicketNumber(locationId) {
	const locationPrefix = locationId.substring(0, 4).toUpperCase();
	const timestamp = Date.now();
	const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
	return `RCV-${locationPrefix}-${timestamp}-${random}`;
}

/**
 * GET /api/receiving
 * Get receiving tickets for a location
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
 * GET /api/receiving/:id
 * Get a single receiving ticket
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
 * POST /api/receiving
 * Create a new receiving ticket (DRAFT)
 * Requires: Admin or Parts Manager role
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
 * POST /api/receiving/:id/lines
 * Add a line item to a receiving ticket
 * Requires: Admin or Parts Manager role
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
 * DELETE /api/receiving/:ticketId/lines/:lineId
 * Remove a line item from a draft ticket
 * Requires: Admin or Parts Manager role
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
 * POST /api/receiving/:id/post
 * Post (finalize) a receiving ticket
 * Creates transactions, updates inventory levels
 * Requires: Admin or Parts Manager role
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
