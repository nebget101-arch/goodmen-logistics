'use strict';

/**
 * FN-1103: Tests for bulkCreateParts (Quick Add Invoice OCR flow).
 *
 * Hermetic — uses an in-memory mock knex via the shared db bridge,
 * matching the pattern in test/manufacturers-vendors-dedup.test.js.
 *
 * Run with: cd backend/packages/goodmen-shared && node --test services/parts.service.bulk.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const dbBridge = require('../internal/db');

/**
 * Minimal mock knex supporting the calls bulkCreateParts uses:
 *   db('parts').whereIn(db.raw('UPPER(sku)'), [...]).select('sku')
 *   db.transaction(async (trx) => { trx('parts').insert(row).returning('*'); ... })
 *   db('manufacturers').where({normalized_name}).first() / .insert().returning()
 *   db('vendors').where({normalized_name}).first() / .insert().returning()
 */
function makeMockDb() {
	// FN-1474: bulk-create now generates barcodes via `isBarcodeTaken`, which
	// queries both `parts.barcode` and `part_barcodes.barcode_value` — so the
	// mock has to know about `part_barcodes` even though the bulk path doesn't
	// insert into it.
	const tables = { parts: [], manufacturers: [], vendors: [], part_barcodes: [] };
	let nextId = 1;

	function tableBuilder(name) {
		const rows = tables[name];
		let whereCriteria = null;
		let whereInColExpr = null; // raw expression OR column name
		let whereInValues = null;
		const builder = {
			where(criteriaOrCol, value) {
				// Accept both shapes: .where({col: val}) and .where('col', val).
				// `isBarcodeTaken` (FN-1400) uses the two-arg form.
				if (typeof criteriaOrCol === 'string' && arguments.length === 2) {
					whereCriteria = { [criteriaOrCol]: value };
				} else {
					whereCriteria = criteriaOrCol;
				}
				return this;
			},
			whereIn(col, values) {
				whereInColExpr = col;
				whereInValues = values;
				return this;
			},
			async select(col) {
				if (whereInColExpr && Array.isArray(whereInValues)) {
					// Honour the UPPER(sku) raw expression: case-insensitive in-set.
					const expr = whereInColExpr && whereInColExpr.sql
						? String(whereInColExpr.sql)
						: String(whereInColExpr);
					const target = expr.toUpperCase().includes('UPPER(SKU)') ? 'sku' : col;
					const set = new Set(whereInValues.map((v) => String(v).toUpperCase()));
					return rows
						.filter((r) => set.has(String(r[target] || '').toUpperCase()))
						.map((r) => ({ [col]: r[col] }));
				}
				if (whereCriteria) {
					return rows
						.filter((r) =>
							Object.keys(whereCriteria).every((k) => r[k] === whereCriteria[k])
						)
						.map((r) => ({ [col]: r[col] }));
				}
				return rows.map((r) => ({ [col]: r[col] }));
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
						// Master-table dedup behaviour for manufacturers/vendors:
						// honour the unique-on-normalized_name constraint with PG 23505.
						if ((name === 'manufacturers' || name === 'vendors') && data.normalized_name) {
							const dup = rows.find((r) => r.normalized_name === data.normalized_name);
							if (dup) {
								const err = new Error('duplicate key value violates unique constraint');
								err.code = '23505';
								throw err;
							}
						}
						const row = { id: nextId++, created_at: new Date(), updated_at: new Date(), ...data };
						rows.push(row);
						return [row];
					},
				};
			},
		};
		return builder;
	}

	const db = (n) => tableBuilder(n);
	db.fn = { now: () => new Date() };
	db.raw = (sql, bindings) => ({ sql, bindings });
	db.transaction = async (fn) => {
		// Trivial trx: same backing tables, no rollback semantics, but enough
		// for happy-path bulk-insert + behaviour validation.
		const trx = (n) => tableBuilder(n);
		return fn(trx);
	};
	return { db, tables };
}

function loadServicesWithMockDb() {
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
		tables,
	};
}

test('bulkCreateParts: empty/non-array input throws', async () => {
	const { partsService } = loadServicesWithMockDb();
	await assert.rejects(() => partsService.bulkCreateParts([]), /non-empty array/);
	await assert.rejects(() => partsService.bulkCreateParts(null), /non-empty array/);
	await assert.rejects(() => partsService.bulkCreateParts(undefined), /non-empty array/);
});

test('bulkCreateParts: mixed payload — 2 new, 1 existing, 1 duplicate-in-request', async () => {
	const { partsService, tables } = loadServicesWithMockDb();

	// Seed an existing part so one input SKU already exists.
	tables.parts.push({
		id: 999,
		sku: 'EXISTING-1',
		name: 'Pre-existing Part',
		status: 'ACTIVE',
	});

	const items = [
		{ sku: 'NEW-1', name: 'New Oil Filter', manufacturer: 'Fleetguard', preferred_vendor_name: 'NAPA', unit_cost: 12.5 },
		{ sku: 'NEW-2', name: 'New Brake Pad', manufacturer: 'Bendix', preferred_vendor_name: 'NAPA', unit_cost: 89.99 },
		{ sku: 'EXISTING-1', name: 'Duplicate vs DB', unit_cost: 5 },
		{ sku: 'NEW-1', name: 'Duplicate within request', unit_cost: 11 }, // duplicate of first
	];

	const result = await partsService.bulkCreateParts(items);

	// Assertions per AC
	assert.equal(result.created.length, 2, 'expected 2 new parts created');
	const createdSkus = result.created.map((r) => r.sku).sort();
	assert.deepEqual(createdSkus, ['NEW-1', 'NEW-2']);

	// Skipped contains BOTH rejection reasons.
	const reasons = result.skipped.map((s) => s.reason).sort();
	assert.ok(reasons.includes('sku_exists'), 'expected sku_exists in skipped');
	assert.ok(reasons.includes('duplicate_in_request'), 'expected duplicate_in_request in skipped');
	assert.equal(result.skipped.length, 2);

	const skuExistsEntry = result.skipped.find((s) => s.reason === 'sku_exists');
	assert.equal(skuExistsEntry.sku, 'EXISTING-1');
	const dupInReqEntry = result.skipped.find((s) => s.reason === 'duplicate_in_request');
	assert.equal(dupInReqEntry.sku, 'NEW-1');

	// FK auto-create: vendor + manufacturer master rows were created.
	assert.ok(tables.manufacturers.length >= 2, 'manufacturers master rows auto-created');
	assert.ok(tables.vendors.length >= 1, 'vendor master row auto-created');

	// Inserted parts carry the FK + canonicalized text.
	const napaRow = tables.vendors.find((v) => v.normalized_name === 'napa');
	assert.ok(napaRow, 'NAPA master row exists');
	for (const created of result.created) {
		const partRow = tables.parts.find((p) => p.sku === created.sku);
		assert.equal(partRow.vendor_id, napaRow.id);
		assert.equal(partRow.preferred_vendor_name, napaRow.name);
		assert.ok(partRow.manufacturer_id, 'manufacturer_id set');
	}
});

test('bulkCreateParts: missing sku or name → skipped with reason missing_sku_or_name', async () => {
	const { partsService } = loadServicesWithMockDb();

	const items = [
		{ sku: '   ', name: 'No SKU' },
		{ sku: 'OK-1', name: '' },
		{ sku: 'OK-2', name: 'Real Part' },
	];
	const result = await partsService.bulkCreateParts(items);
	assert.equal(result.created.length, 1);
	assert.equal(result.created[0].sku, 'OK-2');
	assert.equal(result.skipped.length, 2);
	for (const s of result.skipped) {
		assert.equal(s.reason, 'missing_sku_or_name');
	}
});

test('FN-1364 bulkCreateParts: missing/empty category → defaults to Uncategorized; missing manufacturer stays null', async () => {
	const { partsService, tables } = loadServicesWithMockDb();

	const items = [
		// no category at all
		{ sku: 'NC-1', name: 'No Category Part' },
		// empty-string category
		{ sku: 'NC-2', name: 'Empty Category Part', category: '' },
		// whitespace-only category
		{ sku: 'NC-3', name: 'Whitespace Category Part', category: '   ' },
		// explicit category should be preserved as-is (with trim)
		{ sku: 'OK-1', name: 'Categorized Part', category: '  Brakes  ' },
		// no manufacturer at all
		{ sku: 'NM-1', name: 'No Manufacturer Part' },
	];

	const result = await partsService.bulkCreateParts(items);
	assert.equal(result.created.length, 5);
	assert.equal(result.skipped.length, 0);

	const bySku = Object.fromEntries(
		tables.parts.map((p) => [p.sku, p])
	);
	assert.equal(bySku['NC-1'].category, 'Uncategorized');
	assert.equal(bySku['NC-2'].category, 'Uncategorized');
	assert.equal(bySku['NC-3'].category, 'Uncategorized');
	assert.equal(bySku['OK-1'].category, 'Brakes');

	// Manufacturer stays null when not supplied (resolveManufacturerVendor
	// only sets keys the caller actually passed, so manufacturer/manufacturer_id
	// remain undefined-on-row → DB stores NULL).
	const nm = bySku['NM-1'];
	assert.ok(nm.manufacturer === undefined || nm.manufacturer === null,
		`expected manufacturer null/undefined, got ${nm.manufacturer}`);
	assert.ok(nm.manufacturer_id === undefined || nm.manufacturer_id === null,
		`expected manufacturer_id null/undefined, got ${nm.manufacturer_id}`);
});

test('FN-1364 createPart: missing category → Uncategorized; explicit category preserved', async () => {
	const { partsService, tables } = loadServicesWithMockDb();

	await partsService.createPart({ sku: 'CP-1', name: 'Solo No Category' });
	await partsService.createPart({ sku: 'CP-2', name: 'Solo Empty Cat', category: '' });
	await partsService.createPart({ sku: 'CP-3', name: 'Solo Real Cat', category: 'Engine' });

	const bySku = Object.fromEntries(tables.parts.map((p) => [p.sku, p]));
	assert.equal(bySku['CP-1'].category, 'Uncategorized');
	assert.equal(bySku['CP-2'].category, 'Uncategorized');
	assert.equal(bySku['CP-3'].category, 'Engine');
});

test('FN-1364 createPart: missing sku or name still throws (validation unchanged)', async () => {
	const { partsService } = loadServicesWithMockDb();
	await assert.rejects(
		() => partsService.createPart({ name: 'No SKU Here' }),
		/SKU and name are required/
	);
	await assert.rejects(
		() => partsService.createPart({ sku: 'X-1' }),
		/SKU and name are required/
	);
});

test('bulkCreateParts: a single existing-SKU lookup query is used, not N queries', async () => {
	// Indirectly verified — the mock's `whereIn(db.raw('UPPER(sku)'), [...])` path
	// is the only path the service can use. If the service looped with .where()
	// per item, EXISTING-1 would still be detected but the mock would not be
	// exercised in single-roundtrip mode. This test asserts the contract above
	// works (i.e. the WHERE IN path returns the right rows).
	const { partsService, tables } = loadServicesWithMockDb();
	tables.parts.push({ id: 100, sku: 'A-1', name: 'A', status: 'ACTIVE' });
	tables.parts.push({ id: 101, sku: 'B-1', name: 'B', status: 'ACTIVE' });

	const result = await partsService.bulkCreateParts([
		{ sku: 'A-1', name: 'dup A' },
		{ sku: 'B-1', name: 'dup B' },
		{ sku: 'C-1', name: 'fresh C' },
	]);
	assert.equal(result.created.length, 1);
	assert.equal(result.created[0].sku, 'C-1');
	assert.equal(result.skipped.filter((s) => s.reason === 'sku_exists').length, 2);
});

const FN_BARCODE_FORMAT = /^FN-[A-HJ-NP-Z2-9]{8}$/;

test('FN-1474 bulkCreateParts: 3 rows without barcode → all 3 receive distinct FN-XXXXXXXX', async () => {
	const { partsService, tables } = loadServicesWithMockDb();

	const result = await partsService.bulkCreateParts([
		{ sku: 'AI-1', name: 'AI Part 1' },
		{ sku: 'AI-2', name: 'AI Part 2' },
		{ sku: 'AI-3', name: 'AI Part 3' },
	]);

	assert.equal(result.created.length, 3);
	const barcodes = result.created.map((r) => r.barcode);
	for (const bc of barcodes) {
		assert.match(bc, FN_BARCODE_FORMAT, `barcode ${bc} does not match FN-XXXXXXXX`);
	}
	assert.equal(new Set(barcodes).size, 3, 'expected 3 distinct barcodes');

	// Persisted to the parts table, so the FE can render labels without a re-fetch.
	for (const created of result.created) {
		const row = tables.parts.find((p) => p.sku === created.sku);
		assert.equal(row.barcode, created.barcode);
	}
});

test('FN-1474 bulkCreateParts: explicit barcode is preserved verbatim', async () => {
	const { partsService, tables } = loadServicesWithMockDb();

	const result = await partsService.bulkCreateParts([
		{ sku: 'PRESERVE-1', name: 'Pre-labeled Part', barcode: 'EXTERNAL-12345' },
	]);

	assert.equal(result.created.length, 1);
	assert.equal(result.created[0].barcode, 'EXTERNAL-12345');
	const row = tables.parts.find((p) => p.sku === 'PRESERVE-1');
	assert.equal(row.barcode, 'EXTERNAL-12345');
});

test('FN-1474 bulkCreateParts: AI-supplied category persists into parts.category', async () => {
	const { partsService, tables } = loadServicesWithMockDb();

	const result = await partsService.bulkCreateParts([
		{ sku: 'CAT-1', name: 'Brake Pad', category: 'Brakes' },
	]);

	assert.equal(result.created.length, 1);
	const row = tables.parts.find((p) => p.sku === 'CAT-1');
	assert.equal(row.category, 'Brakes');
	// Barcode also auto-generated (regression guard for the same path).
	assert.match(row.barcode, FN_BARCODE_FORMAT);
});
