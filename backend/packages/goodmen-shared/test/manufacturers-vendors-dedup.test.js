'use strict';

/**
 * FN-1093: dedup behavior on POST /api/manufacturers and /api/vendors.
 * Case differences and internal whitespace must collapse to a single master row.
 *
 * Tests cover:
 *   1. normalizeName() helper matches the SQL backfill expression from FN-1092.
 *   2. manufacturers.service.findOrCreate() returns the existing row when
 *      normalized_name matches, even with different casing/whitespace.
 *   3. parts.service.resolveManufacturerVendor() canonicalizes the text column
 *      to the master row's name when an FK is provided, and find-or-creates
 *      the master when only text is provided.
 *
 * Run with: cd backend/packages/goodmen-shared && node --test test/manufacturers-vendors-dedup.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeName } = require('../utils/normalize-name');
const dbBridge = require('../internal/db');

// ---------------------------------------------------------------------------
// 1. normalizeName helper
// ---------------------------------------------------------------------------

test('normalizeName: lowercases', () => {
	assert.equal(normalizeName('ACME Corp'), 'acme corp');
});

test('normalizeName: trims outer whitespace', () => {
	assert.equal(normalizeName('  Bosch  '), 'bosch');
});

test('normalizeName: collapses internal whitespace runs', () => {
	assert.equal(normalizeName('ACME    Corp'), 'acme corp');
	assert.equal(normalizeName('A\tB\nC'), 'a b c');
});

test('normalizeName: case + whitespace variants produce the same key', () => {
	const key = normalizeName('ACME Corp');
	assert.equal(normalizeName('acme corp'), key);
	assert.equal(normalizeName('  ACME   Corp  '), key);
	assert.equal(normalizeName('Acme\tCorp'), key);
});

test('normalizeName: empty/whitespace/null input returns ""', () => {
	assert.equal(normalizeName(null), '');
	assert.equal(normalizeName(undefined), '');
	assert.equal(normalizeName(''), '');
	assert.equal(normalizeName('   '), '');
});

// ---------------------------------------------------------------------------
// 2. findOrCreate dedup — uses an in-memory mock knex so the test is hermetic.
// ---------------------------------------------------------------------------

/**
 * Minimal mock supporting only the knex calls findOrCreate uses:
 *   db(table).where({ normalized_name }).first()
 *   db(table).insert(row).returning('*')
 *
 * Enforces the unique-on-normalized_name constraint with PG error code 23505,
 * matching the DB-side behavior the migration installed.
 */
function makeMockDb() {
	const tables = { manufacturers: [], vendors: [] };
	let nextId = 1;

	function tableBuilder(name) {
		const rows = tables[name];
		let whereCriteria = null;
		const builder = {
			where(criteria) {
				whereCriteria = criteria;
				return this;
			},
			async first() {
				if (!whereCriteria) return rows[0] || null;
				return rows.find((r) =>
					Object.keys(whereCriteria).every((k) => r[k] === whereCriteria[k])
				) || null;
			},
			insert(data) {
				return {
					async returning() {
						const dup = rows.find((r) => r.normalized_name === data.normalized_name);
						if (dup) {
							const err = new Error('duplicate key value violates unique constraint');
							err.code = '23505';
							throw err;
						}
						const row = { id: nextId++, created_at: new Date(), updated_at: new Date(), ...data };
						rows.push(row);
						return [row];
					},
				};
			},
			async del() {
				const before = rows.length;
				for (let i = rows.length - 1; i >= 0; i -= 1) {
					if (whereCriteria && Object.keys(whereCriteria).every((k) => rows[i][k] === whereCriteria[k])) {
						rows.splice(i, 1);
					}
				}
				return before - rows.length;
			},
			update(data) {
				return {
					async returning() {
						const idx = rows.findIndex((r) =>
							whereCriteria && Object.keys(whereCriteria).every((k) => r[k] === whereCriteria[k])
						);
						if (idx === -1) return [];
						rows[idx] = { ...rows[idx], ...data, updated_at: new Date() };
						return [rows[idx]];
					},
				};
			},
		};
		return builder;
	}

	const db = (name) => tableBuilder(name);
	db.fn = { now: () => new Date() };
	return { db, tables };
}

/**
 * Inject the mock knex via the shared db bridge, then re-require the services
 * with a clean module cache so they pick up the mock. Returns the service
 * modules and the underlying tables for assertions.
 */
function loadServicesWithMockDb() {
	const { db, tables } = makeMockDb();
	dbBridge.setDatabase({ knex: db });

	const servicePaths = [
		require.resolve('../services/manufacturers.service'),
		require.resolve('../services/vendors.service'),
	];
	for (const p of servicePaths) {
		delete require.cache[p];
	}

	return {
		manufacturersService: require('../services/manufacturers.service'),
		vendorsService: require('../services/vendors.service'),
		tables,
	};
}

test('manufacturers.findOrCreate: case variants collapse to one row', async () => {
	const { manufacturersService, tables } = loadServicesWithMockDb();
	const a = await manufacturersService.findOrCreate('ACME Corp');
	const b = await manufacturersService.findOrCreate('acme corp');
	const c = await manufacturersService.findOrCreate('Acme Corp');

	assert.equal(a.id, b.id);
	assert.equal(b.id, c.id);
	assert.equal(tables.manufacturers.length, 1);
	assert.equal(tables.manufacturers[0].normalized_name, 'acme corp');
});

test('manufacturers.findOrCreate: whitespace variants collapse to one row', async () => {
	const { manufacturersService, tables } = loadServicesWithMockDb();
	const a = await manufacturersService.findOrCreate('ACME Corp');
	const b = await manufacturersService.findOrCreate('  ACME   Corp  ');
	const c = await manufacturersService.findOrCreate('ACME\tCorp');

	assert.equal(a.id, b.id);
	assert.equal(b.id, c.id);
	assert.equal(tables.manufacturers.length, 1);
});

test('manufacturers.findOrCreate: empty/whitespace returns null (no insert)', async () => {
	const { manufacturersService, tables } = loadServicesWithMockDb();
	assert.equal(await manufacturersService.findOrCreate(''), null);
	assert.equal(await manufacturersService.findOrCreate('   '), null);
	assert.equal(await manufacturersService.findOrCreate(null), null);
	assert.equal(tables.manufacturers.length, 0);
});

test('vendors.findOrCreate: case + whitespace variants collapse to one row', async () => {
	const { vendorsService, tables } = loadServicesWithMockDb();
	const a = await vendorsService.findOrCreate('NAPA Auto Parts');
	const b = await vendorsService.findOrCreate('napa auto parts');
	const c = await vendorsService.findOrCreate('  NAPA  Auto  Parts  ');

	assert.equal(a.id, b.id);
	assert.equal(b.id, c.id);
	assert.equal(tables.vendors.length, 1);
});

test('manufacturers.create: POST with case variants returns the same row', async () => {
	const { manufacturersService, tables } = loadServicesWithMockDb();
	const a = await manufacturersService.create({ name: 'Bosch' });
	const b = await manufacturersService.create({ name: 'BOSCH' });
	const c = await manufacturersService.create({ name: '  bosch  ' });

	assert.equal(a.id, b.id);
	assert.equal(b.id, c.id);
	assert.equal(tables.manufacturers.length, 1);
});

// ---------------------------------------------------------------------------
// 3. parts.resolveManufacturerVendor — text↔FK sync rules
// ---------------------------------------------------------------------------

function loadPartsServiceWithMockDb() {
	const { db, tables } = makeMockDb();
	dbBridge.setDatabase({ knex: db });

	const paths = [
		require.resolve('../services/manufacturers.service'),
		require.resolve('../services/vendors.service'),
		require.resolve('../services/parts.service'),
	];
	for (const p of paths) {
		delete require.cache[p];
	}

	return {
		partsService: require('../services/parts.service'),
		manufacturersService: require('../services/manufacturers.service'),
		vendorsService: require('../services/vendors.service'),
		tables,
	};
}

test('resolveManufacturerVendor: text-only input find-or-creates and sets both FK and text', async () => {
	const { partsService, tables } = loadPartsServiceWithMockDb();
	const patch = await partsService.resolveManufacturerVendor({
		manufacturer: '  ACME Corp  ',
		preferred_vendor_name: 'NAPA',
	});

	assert.equal(typeof patch.manufacturer_id, 'number');
	assert.equal(patch.manufacturer, 'ACME Corp');
	assert.equal(typeof patch.vendor_id, 'number');
	assert.equal(patch.preferred_vendor_name, 'NAPA');
	assert.equal(tables.manufacturers.length, 1);
	assert.equal(tables.vendors.length, 1);
});

test('resolveManufacturerVendor: FK input forces text column to master.name', async () => {
	const { partsService, manufacturersService, vendorsService } = loadPartsServiceWithMockDb();
	const m = await manufacturersService.create({ name: 'Fleetguard' });
	const v = await vendorsService.create({ name: 'Cummins Filtration' });

	const patch = await partsService.resolveManufacturerVendor({
		manufacturer_id: m.id,
		manufacturer: 'WRONG TEXT',
		vendor_id: v.id,
		preferred_vendor_name: 'IGNORED',
	});

	assert.equal(patch.manufacturer_id, m.id);
	assert.equal(patch.manufacturer, 'Fleetguard');
	assert.equal(patch.vendor_id, v.id);
	assert.equal(patch.preferred_vendor_name, 'Cummins Filtration');
});

test('resolveManufacturerVendor: explicit null FK clears the FK and respects text', async () => {
	const { partsService } = loadPartsServiceWithMockDb();
	const patch = await partsService.resolveManufacturerVendor({
		manufacturer_id: null,
		manufacturer: 'free text only',
		vendor_id: null,
		preferred_vendor_name: '',
	});

	assert.equal(patch.manufacturer_id, null);
	assert.equal(patch.manufacturer, 'free text only');
	assert.equal(patch.vendor_id, null);
	assert.equal(patch.preferred_vendor_name, null);
});

test('resolveManufacturerVendor: omitted fields are not in the patch', async () => {
	const { partsService } = loadPartsServiceWithMockDb();
	const patch = await partsService.resolveManufacturerVendor({});
	assert.deepEqual(patch, {});
});

test('resolveManufacturerVendor: case + whitespace text variants reuse the same master', async () => {
	const { partsService, tables } = loadPartsServiceWithMockDb();

	await partsService.resolveManufacturerVendor({ manufacturer: 'ACME Corp' });
	await partsService.resolveManufacturerVendor({ manufacturer: 'acme corp' });
	const third = await partsService.resolveManufacturerVendor({ manufacturer: '  ACME   Corp  ' });

	assert.equal(tables.manufacturers.length, 1);
	assert.equal(third.manufacturer_id, tables.manufacturers[0].id);
});
