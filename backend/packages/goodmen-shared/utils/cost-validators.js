/**
 * FN-1566: Pure validators for monetary cost fields and integer quantities
 * shared between the receiving line PATCH route and the parts cost PATCH
 * route. Kept dependency-free so unit tests run without DB or Express.
 */

'use strict';

class ValidationError extends Error {
	constructor(message, field) {
		super(message);
		this.name = 'ValidationError';
		this.field = field;
		this.statusCode = 400;
	}
}

/**
 * Coerce a candidate cost value (string or number) to a normalized 2dp number.
 * Throws ValidationError on non-finite, negative, or > 2 decimal-place inputs.
 * Caller decides whether the field is optional — pass already-checked values.
 */
function validateCostValue(value, fieldName) {
	if (value === null || value === undefined || value === '') {
		throw new ValidationError(`${fieldName} is required`, fieldName);
	}
	const num = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(num)) {
		throw new ValidationError(`${fieldName} must be a finite number`, fieldName);
	}
	if (num < 0) {
		throw new ValidationError(`${fieldName} must be >= 0`, fieldName);
	}
	const rounded = Math.round(num * 100) / 100;
	if (Math.abs(num - rounded) > 1e-9) {
		throw new ValidationError(`${fieldName} must have at most 2 decimal places`, fieldName);
	}
	return rounded;
}

/**
 * Validate qty_received as a positive finite integer (treats numeric strings).
 */
function validateQtyReceived(value) {
	if (value === null || value === undefined || value === '') {
		throw new ValidationError('qty_received is required', 'qty_received');
	}
	const num = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(num) || !Number.isInteger(num)) {
		throw new ValidationError('qty_received must be an integer', 'qty_received');
	}
	if (num <= 0) {
		throw new ValidationError('qty_received must be > 0', 'qty_received');
	}
	return num;
}

/**
 * Trim a bin location override; rejects values longer than 64 chars to match
 * the receiving_ticket_lines.bin_location_override column width and to keep
 * arbitrary blobs out of the DB. Empty/whitespace-only collapses to null so
 * the route can clear the override.
 */
function validateBinLocationOverride(value) {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string') {
		throw new ValidationError('bin_location_override must be a string', 'bin_location_override');
	}
	const trimmed = value.trim();
	if (trimmed === '') return null;
	if (trimmed.length > 64) {
		throw new ValidationError('bin_location_override must be 64 characters or fewer', 'bin_location_override');
	}
	return trimmed;
}

module.exports = {
	ValidationError,
	validateCostValue,
	validateQtyReceived,
	validateBinLocationOverride
};
