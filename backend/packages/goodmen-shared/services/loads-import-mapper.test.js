'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
	applyColumnMapping,
	buildStopsFromRow,
	coerceRate,
	trimOrNull,
	parseCombinedCityState,
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

describe('loads-import-service / buildStopsFromRow — stop date coercion (FN-1609)', () => {
	it('coerces a JS Date.toString() form into ISO YYYY-MM-DD', () => {
		const normalized = {
			pickup_city: 'Dallas',
			pickup_date: 'Thu May 07 2026 00:00:00 GMT+0000 (Coordinated Universal Time)',
			_stops_hint: { pattern: 'single' },
		};
		const stops = buildStopsFromRow(normalized);
		assert.equal(stops.length, 1);
		assert.equal(stops[0].stopDate, '2026-05-07');
	});

	it('coerces a real Date instance into ISO YYYY-MM-DD', () => {
		const normalized = {
			pickup_city: 'Dallas',
			pickup_date: new Date(Date.UTC(2026, 4, 7)),
			_stops_hint: { pattern: 'single' },
		};
		const stops = buildStopsFromRow(normalized);
		assert.equal(stops[0].stopDate, '2026-05-07');
	});

	it('keeps an ISO date string as ISO', () => {
		const normalized = {
			pickup_city: 'Dallas',
			pickup_date: '2026-05-07',
			_stops_hint: { pattern: 'single' },
		};
		const stops = buildStopsFromRow(normalized);
		assert.equal(stops[0].stopDate, '2026-05-07');
	});

	it('coerces M/D/YYYY into ISO YYYY-MM-DD', () => {
		const normalized = {
			pickup_city: 'Dallas',
			pickup_date: '5/7/2026',
			_stops_hint: { pattern: 'single' },
		};
		const stops = buildStopsFromRow(normalized);
		assert.equal(stops[0].stopDate, '2026-05-07');
	});

	it('returns null stopDate when the date field is null or unparseable', () => {
		const cases = [null, undefined, '', '   ', 'not a date'];
		for (const value of cases) {
			const stops = buildStopsFromRow({
				pickup_city: 'Dallas',
				pickup_date: value,
				_stops_hint: { pattern: 'single' },
			});
			assert.equal(stops.length, 1, `stop should still be emitted for ${JSON.stringify(value)}`);
			assert.equal(stops[0].stopDate, null, `stopDate should be null for ${JSON.stringify(value)}`);
		}
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

describe('loads-import-mapper / parseCombinedCityState (FN-1603)', () => {
	it('parses simple "City, ST"', () => {
		assert.deepEqual(parseCombinedCityState('Denton, TX'), {
			city: 'Denton', state: 'TX', zip: null,
		});
	});

	it('splits multi-word city on the LAST comma', () => {
		assert.deepEqual(parseCombinedCityState('Johnson City, TN'), {
			city: 'Johnson City', state: 'TN', zip: null,
		});
		assert.deepEqual(parseCombinedCityState('Kansas City, MO'), {
			city: 'Kansas City', state: 'MO', zip: null,
		});
	});

	it('captures optional trailing 5-digit zip', () => {
		assert.deepEqual(parseCombinedCityState('Denton, TX 76201'), {
			city: 'Denton', state: 'TX', zip: '76201',
		});
	});

	it('returns nulls when there is no comma', () => {
		assert.deepEqual(parseCombinedCityState('Denton'), {
			city: null, state: null, zip: null,
		});
	});

	it('rejects an invalid 2-letter state', () => {
		assert.deepEqual(parseCombinedCityState('Denton, ZZ'), {
			city: null, state: null, zip: null,
		});
	});

	it('returns nulls for empty / whitespace / nullish input', () => {
		assert.deepEqual(parseCombinedCityState(''), { city: null, state: null, zip: null });
		assert.deepEqual(parseCombinedCityState('   '), { city: null, state: null, zip: null });
		assert.deepEqual(parseCombinedCityState(null), { city: null, state: null, zip: null });
		assert.deepEqual(parseCombinedCityState(undefined), { city: null, state: null, zip: null });
	});

	it('tolerates leading/trailing whitespace and lowercase state', () => {
		assert.deepEqual(parseCombinedCityState('  Denton ,  TX  '), {
			city: 'Denton', state: 'TX', zip: null,
		});
		assert.deepEqual(parseCombinedCityState('denton, tx'), {
			city: 'denton', state: 'TX', zip: null,
		});
	});

	it('rejects three- or four-letter trailing tokens', () => {
		assert.deepEqual(parseCombinedCityState('Washington, USA'), {
			city: null, state: null, zip: null,
		});
	});

	it('is idempotent — same input produces identical output', () => {
		const a = parseCombinedCityState('Johnson City, TN');
		const b = parseCombinedCityState('Johnson City, TN');
		assert.deepEqual(a, b);
	});
});

describe('loads-import-mapper / applyColumnMapping with CITY_STATE_COMBINED warning (FN-1603)', () => {
	const mapping = {
		load_number: { sourceHeader: 'Load #', confidence: 0.99 },
		pickup_address1: { sourceHeader: 'Pickup', confidence: 0.75 },
		delivery_address1: { sourceHeader: 'Delivery', confidence: 0.75 },
	};

	it('extracts pickup_city/state/zip from pickup_address1 when warning fires', () => {
		const raw = { 'Load #': 'L-100', Pickup: 'Denton, TX 76201', Delivery: 'Atlanta, GA' };
		const out = applyColumnMapping(raw, mapping, {
			warnings: [{ code: 'CITY_STATE_COMBINED' }],
		});
		assert.equal(out.pickup_city, 'Denton');
		assert.equal(out.pickup_state, 'TX');
		assert.equal(out.pickup_zip, '76201');
		assert.equal(out.delivery_city, 'Atlanta');
		assert.equal(out.delivery_state, 'GA');
		// address1 is preserved for trail / display.
		assert.equal(out.pickup_address1, 'Denton, TX 76201');
	});

	it('accepts plain string warning codes', () => {
		const raw = { 'Load #': 'L-100', Pickup: 'Johnson City, TN' };
		const out = applyColumnMapping(raw, mapping, { warnings: ['CITY_STATE_COMBINED'] });
		assert.equal(out.pickup_city, 'Johnson City');
		assert.equal(out.pickup_state, 'TN');
	});

	it('does not parse when warning is absent', () => {
		const raw = { 'Load #': 'L-100', Pickup: 'Denton, TX' };
		const out = applyColumnMapping(raw, mapping);
		assert.equal(out.pickup_city, undefined);
		assert.equal(out.pickup_state, undefined);
	});

	it('does not overwrite city/state already populated by direct mapping', () => {
		const explicitMapping = {
			...mapping,
			pickup_city: { sourceHeader: 'PU City', confidence: 0.9 },
			pickup_state: { sourceHeader: 'PU State', confidence: 0.9 },
		};
		const raw = {
			'Load #': 'L-1', Pickup: 'WRONG, ZZ',
			'PU City': 'Dallas', 'PU State': 'TX',
		};
		const out = applyColumnMapping(raw, explicitMapping, {
			warnings: [{ code: 'CITY_STATE_COMBINED' }],
		});
		assert.equal(out.pickup_city, 'Dallas');
		assert.equal(out.pickup_state, 'TX');
	});

	it('appends a per-row warning when address1 fails to parse', () => {
		const raw = { 'Load #': 'L-1', Pickup: 'Denton, ZZ' };
		const rowWarnings = [];
		const out = applyColumnMapping(raw, mapping, {
			warnings: [{ code: 'CITY_STATE_COMBINED' }],
			rowWarnings,
		});
		assert.equal(out.pickup_city, undefined);
		assert.equal(out.pickup_address1, 'Denton, ZZ');
		assert.equal(rowWarnings.length, 1);
		assert.match(rowWarnings[0], /CITY_STATE_PARSE_FAILED:pickup/);
	});

	it('builds stops after extraction (full bug-1600 path)', () => {
		const raw = { 'Load #': 'L-100', Pickup: 'Denton, TX', Delivery: 'Atlanta, GA' };
		const mapped = applyColumnMapping(raw, mapping, {
			warnings: [{ code: 'CITY_STATE_COMBINED' }],
		});
		const normalized = { ...mapped, _stops_hint: { pattern: 'single' } };
		const stops = buildStopsFromRow(normalized);
		assert.equal(stops.length, 2);
		assert.equal(stops[0].stopType, 'PICKUP');
		assert.equal(stops[0].city, 'Denton');
		assert.equal(stops[0].state, 'TX');
		assert.equal(stops[1].stopType, 'DELIVERY');
		assert.equal(stops[1].city, 'Atlanta');
		assert.equal(stops[1].state, 'GA');
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
