'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
	applyColumnMapping,
	buildStopsFromRow,
	coerceRate,
	trimOrNull,
} = require('./loads-import-mapper');

describe('loads-import-service / applyColumnMapping', () => {
	it('extracts mapped fields by sourceHeader', () => {
		const raw = { 'Load #': 'L-100', 'PO': 'PO-7', 'Rate': '1500' };
		const mapping = {
			load_number: { sourceHeader: 'Load #', confidence: 0.99 },
			po_number:   { sourceHeader: 'PO',     confidence: 0.95 },
			rate:        { sourceHeader: 'Rate',   confidence: 0.9 },
		};
		const out = applyColumnMapping(raw, mapping);
		assert.deepEqual(out, { load_number: 'L-100', po_number: 'PO-7', rate: '1500' });
	});

	it('skips unmapped fields and empty source values', () => {
		const raw = { 'Load #': 'L-100', 'Notes': '   ' };
		const mapping = {
			load_number: { sourceHeader: 'Load #', confidence: 0.9 },
			notes:       { sourceHeader: 'Notes',  confidence: 0.5 },
			rate:        { sourceHeader: 'Rate',   confidence: 0.0 },  // header missing in raw
		};
		const out = applyColumnMapping(raw, mapping);
		assert.deepEqual(out, { load_number: 'L-100' });
	});

	it('returns empty object when mapping is null / not an object', () => {
		assert.deepEqual(applyColumnMapping({ x: 1 }, null), {});
		assert.deepEqual(applyColumnMapping({ x: 1 }, 'oops'), {});
	});
});

describe('loads-import-service / buildStopsFromRow', () => {
	it('emits one PICKUP and one DELIVERY stop in single-row mode', () => {
		const normalized = {
			pickup_city: 'Dallas', pickup_state: 'TX', pickup_zip: '75201', pickup_date: '2026-05-10',
			delivery_city: 'Atlanta', delivery_state: 'GA', delivery_zip: '30303', delivery_date: '2026-05-12',
			_stops_hint: { pattern: 'single' },
		};
		const stops = buildStopsFromRow(normalized);
		assert.equal(stops.length, 2);
		assert.equal(stops[0].stopType, 'PICKUP');
		assert.equal(stops[0].city, 'Dallas');
		assert.equal(stops[1].stopType, 'DELIVERY');
		assert.equal(stops[1].city, 'Atlanta');
		assert.equal(stops[1].sequence, 2);
	});

	it('skips stops with no city / state / zip', () => {
		const normalized = {
			pickup_city: 'Dallas',
			delivery_city: '', delivery_state: '', delivery_zip: '',
			_stops_hint: { pattern: 'single' },
		};
		const stops = buildStopsFromRow(normalized);
		assert.equal(stops.length, 1);
		assert.equal(stops[0].stopType, 'PICKUP');
	});

	it('handles extra-columns multi-stop pattern', () => {
		const normalized = {
			pickup_city: 'Dallas', pickup_state: 'TX',
			pickup2_city: 'Houston', pickup2_state: 'TX',
			delivery_city: 'Atlanta', delivery_state: 'GA',
			_stops_hint: { pattern: 'extra_columns' },
		};
		const stops = buildStopsFromRow(normalized);
		const types = stops.map((s) => s.stopType);
		assert.ok(types.includes('PICKUP'));
		assert.ok(types.includes('DELIVERY'));
		assert.equal(stops.filter((s) => s.stopType === 'PICKUP').length, 2);
	});

	it('returns empty array when no stop fields are present', () => {
		const normalized = { _stops_hint: { pattern: 'single' } };
		const stops = buildStopsFromRow(normalized);
		assert.deepEqual(stops, []);
	});
});

describe('loads-import-mapper / coerceRate', () => {
	it('strips $ and commas before parsing', () => {
		assert.equal(coerceRate('$1,500.00'), 1500);
	});

	it('returns 0 for nullish or unparseable input', () => {
		assert.equal(coerceRate(null), 0);
		assert.equal(coerceRate(''), 0);
		assert.equal(coerceRate('abc'), 0);
	});

	it('passes plain numerics through', () => {
		assert.equal(coerceRate('2500'), 2500);
		assert.equal(coerceRate('3200.5'), 3200.5);
	});
});

describe('loads-import-mapper / trimOrNull', () => {
	it('returns null for empty / whitespace / nullish', () => {
		assert.equal(trimOrNull(null), null);
		assert.equal(trimOrNull(undefined), null);
		assert.equal(trimOrNull(''), null);
		assert.equal(trimOrNull('   '), null);
	});

	it('trims surrounding whitespace from real strings', () => {
		assert.equal(trimOrNull('  hello  '), 'hello');
	});
});
