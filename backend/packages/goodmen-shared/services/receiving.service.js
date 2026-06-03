/**
 * FN-1566: Receiving service helpers. Currently exposes the line-update
 * helper used by `PATCH /api/receiving/:ticketId/lines/:lineId` so that
 * validation and DRAFT/ownership guards live in one place rather than being
 * duplicated between the route handler and ad-hoc DB calls.
 */

'use strict';

const dbModule = require('../internal/db');
const dtLogger = require('../utils/logger');
const {
	ValidationError,
	validateCostValue,
	validateQtyReceived,
	validateBinLocationOverride
} = require('../utils/cost-validators');

class NotFoundError extends Error {
	constructor(message) {
		super(message);
		this.name = 'NotFoundError';
		this.statusCode = 404;
	}
}

class ConflictError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ConflictError';
		this.statusCode = 400;
	}
}

/**
 * Patch a receiving ticket line. Throws typed errors that the route handler
 * maps to HTTP status codes:
 *   - NotFoundError → 404
 *   - ConflictError → 400 (DRAFT-only guard)
 *   - ValidationError → 400 (per-field)
 *
 * `patch` keys are optional but at least one must be supplied.
 */
async function updateLine(ticketId, lineId, patch = {}) {
	const knex = dbModule.knex;
	if (!ticketId || !lineId) {
		throw new ValidationError('ticketId and lineId are required', 'params');
	}

	const update = {};
	if (Object.prototype.hasOwnProperty.call(patch, 'unit_cost')) {
		update.unit_cost = validateCostValue(patch.unit_cost, 'unit_cost');
	}
	if (Object.prototype.hasOwnProperty.call(patch, 'qty_received')) {
		update.qty_received = validateQtyReceived(patch.qty_received);
	}
	if (Object.prototype.hasOwnProperty.call(patch, 'bin_location_override')) {
		update.bin_location_override = validateBinLocationOverride(patch.bin_location_override);
	}

	if (Object.keys(update).length === 0) {
		throw new ValidationError(
			'At least one of unit_cost, qty_received, bin_location_override is required',
			'body'
		);
	}

	const ticket = await knex('receiving_tickets').where('id', ticketId).first();
	if (!ticket) {
		throw new NotFoundError('Receiving ticket not found');
	}
	if (ticket.status !== 'DRAFT') {
		throw new ConflictError('Cannot edit lines on a posted ticket');
	}

	const line = await knex('receiving_ticket_lines')
		.where({ id: lineId, ticket_id: ticketId })
		.first();
	if (!line) {
		throw new NotFoundError('Line item not found');
	}

	const updatedRows = await knex('receiving_ticket_lines')
		.where({ id: lineId })
		.update(update)
		.returning('*');

	dtLogger.info('receiving_line_updated', {
		ticketId,
		lineId,
		fields: Object.keys(update)
	});

	return updatedRows[0];
}

module.exports = {
	updateLine,
	NotFoundError,
	ConflictError,
	ValidationError
};
