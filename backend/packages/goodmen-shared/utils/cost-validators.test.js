'use strict';

/**
 * FN-1566: Unit tests for the cost-validators helpers shared between the
 * receiving-line PATCH route and the parts cost PATCH route.
 *
 * Run: cd backend/packages/goodmen-shared && node --test utils/cost-validators.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
	ValidationError,
	validateCostValue,
	validateQtyReceived,
	validateBinLocationOverride
} = require('./cost-validators');

describe('validateCostValue', () => {
	it('accepts a positive 2dp number', () => {
		assert.strictEqual(validateCostValue(87.5, 'unit_cost'), 87.5);
	});

	it('accepts zero', () => {
		assert.strictEqual(validateCostValue(0, 'unit_cost'), 0);
	});

	it('coerces numeric strings', () => {
		assert.strictEqual(validateCostValue('42.10', 'unit_cost'), 42.1);
	});

	it('rejects negatives', () => {
		assert.throws(() => validateCostValue(-1, 'unit_cost'), ValidationError);
	});

	it('rejects NaN / non-numeric strings', () => {
		assert.throws(() => validateCostValue('abc', 'unit_cost'), ValidationError);
		assert.throws(() => validateCostValue(NaN, 'unit_cost'), ValidationError);
	});

	it('rejects Infinity', () => {
		assert.throws(() => validateCostValue(Infinity, 'unit_cost'), ValidationError);
	});

	it('rejects > 2 decimal places', () => {
		assert.throws(() => validateCostValue(87.555, 'unit_cost'), ValidationError);
	});

	it('rejects null / undefined / empty string as required-missing', () => {
		assert.throws(() => validateCostValue(null, 'unit_cost'), ValidationError);
		assert.throws(() => validateCostValue(undefined, 'unit_cost'), ValidationError);
		assert.throws(() => validateCostValue('', 'unit_cost'), ValidationError);
	});

	it('attaches statusCode 400 + field name to errors', () => {
		try {
			validateCostValue(-5, 'default_cost');
			assert.fail('should have thrown');
		} catch (err) {
			assert.strictEqual(err.statusCode, 400);
			assert.strictEqual(err.field, 'default_cost');
		}
	});
});

describe('validateQtyReceived', () => {
	it('accepts positive integers', () => {
		assert.strictEqual(validateQtyReceived(5), 5);
	});

	it('coerces numeric strings', () => {
		assert.strictEqual(validateQtyReceived('12'), 12);
	});

	it('rejects zero and negatives', () => {
		assert.throws(() => validateQtyReceived(0), ValidationError);
		assert.throws(() => validateQtyReceived(-1), ValidationError);
	});

	it('rejects fractional values', () => {
		assert.throws(() => validateQtyReceived(1.5), ValidationError);
	});

	it('rejects null / undefined / empty', () => {
		assert.throws(() => validateQtyReceived(null), ValidationError);
		assert.throws(() => validateQtyReceived(undefined), ValidationError);
		assert.throws(() => validateQtyReceived(''), ValidationError);
	});
});

describe('validateBinLocationOverride', () => {
	it('returns null for null/undefined/empty', () => {
		assert.strictEqual(validateBinLocationOverride(null), null);
		assert.strictEqual(validateBinLocationOverride(undefined), null);
		assert.strictEqual(validateBinLocationOverride(''), null);
		assert.strictEqual(validateBinLocationOverride('   '), null);
	});

	it('trims valid values', () => {
		assert.strictEqual(validateBinLocationOverride('  A-12  '), 'A-12');
	});

	it('rejects non-string', () => {
		assert.throws(() => validateBinLocationOverride(42), ValidationError);
	});

	it('rejects > 64 chars', () => {
		assert.throws(() => validateBinLocationOverride('x'.repeat(65)), ValidationError);
	});
});
