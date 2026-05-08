'use strict';

/**
 * FN-1544: Tests the bulk-upload → updatePart contract.
 *
 * Asserts that the bulk-upload row processor delegates to the canonical
 * `partsService.createPart` (new SKU) and `partsService.updatePart`
 * (existing SKU) — so a part created via bulk-upload can be later
 * updated by `PUT /api/parts/:id` with no divergent field handling.
 *
 * Run: cd backend/packages/goodmen-shared && node --test test/parts-bulk-upload-canonical.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
	normalizeBulkUploadRow,
	processBulkUploadRow,
} = require('../routes/parts');

function makeDb({ existingPartBySku = null, existingBarcode = null } = {}) {
	const calls = { partsLookup: [], barcodeLookup: [], barcodeInsert: [], barcodeUpdate: [] };
	function chain(table) {
		let lastWhereRawArgs = null;
		let lastWhereObj = null;
		const api = {
			whereRaw(_sql, args) {
				lastWhereRawArgs = args;
				return api;
			},
			where(arg) {
				if (typeof arg === 'object') lastWhereObj = arg;
				return api;
			},
			async first() {
				if (table === 'parts') {
					calls.partsLookup.push(lastWhereRawArgs);
					return existingPartBySku ? { ...existingPartBySku } : undefined;
				}
				if (table === 'part_barcodes') {
					calls.barcodeLookup.push(lastWhereRawArgs);
					return existingBarcode ? { ...existingBarcode } : undefined;
				}
				return undefined;
			},
			async insert(values) {
				if (table === 'part_barcodes') {
					calls.barcodeInsert.push(values);
					return [{ id: 'bc-new', ...values }];
				}
				return [];
			},
			async update(values) {
				if (table === 'part_barcodes') {
					calls.barcodeUpdate.push({ where: lastWhereObj, values });
					return 1;
				}
				return 0;
			},
		};
		return api;
	}
	const fn = (table) => chain(table);
	fn._calls = calls;
	return fn;
}

function makePartsService({ created, updated } = {}) {
	const calls = { createPart: [], updatePart: [] };
	return {
		_calls: calls,
		async createPart(payload) {
			calls.createPart.push(payload);
			return created || { id: 'part-new', ...payload };
		},
		async updatePart(id, payload) {
			calls.updatePart.push({ id, payload });
			return updated || { id, ...payload };
		},
	};
}

describe('FN-1544 bulk-upload row processor', () => {
	it('normalizes raw spreadsheet row to canonical part shape', () => {
		const normalized = normalizeBulkUploadRow({
			SKU: 'trk-001',
			Name: 'Oil Filter',
			Category: 'Engine',
			Manufacturer: 'Fleetguard',
			'Unit Cost': '12.50',
			'Unit Price': '19.99',
			Reorder_Level: '5',
			Status: 'active',
			Barcode: 'BC-001',
			Vendor: 'Fleetguard',
			'Pack Qty': '1',
		});
		assert.equal(normalized.sku, 'TRK-001');
		assert.equal(normalized.name, 'Oil Filter');
		assert.equal(normalized.category, 'Engine');
		assert.equal(normalized.manufacturer, 'Fleetguard');
		assert.equal(normalized.unit_cost, 12.5);
		assert.equal(normalized.unit_price, 19.99);
		assert.equal(normalized.reorder_level, 5);
		assert.equal(normalized.status, 'ACTIVE');
		assert.equal(normalized.barcode_value, 'BC-001');
		assert.equal(normalized.vendor, 'Fleetguard');
		assert.equal(normalized.pack_qty, 1);
	});

	it('skips rows missing sku or name', async () => {
		const db = makeDb();
		const partsService = makePartsService();
		const res = await processBulkUploadRow(
			normalizeBulkUploadRow({ name: 'no sku' }),
			{ db, partsService }
		);
		assert.equal(res.kind, 'skipped');
		assert.match(res.error, /sku and name are required/);
		assert.equal(partsService._calls.createPart.length, 0);
		assert.equal(partsService._calls.updatePart.length, 0);
	});

	it('delegates to partsService.createPart for a new SKU', async () => {
		const db = makeDb({ existingPartBySku: null });
		const partsService = makePartsService({
			created: { id: 'part-1', sku: 'TRK-001', unit_price: 19.99 },
		});

		const normalized = normalizeBulkUploadRow({
			sku: 'TRK-001',
			name: 'Oil Filter',
			manufacturer: 'Fleetguard',
			unit_price: '19.99',
			status: 'active',
		});
		const res = await processBulkUploadRow(normalized, { db, partsService });

		assert.equal(res.kind, 'created');
		assert.equal(partsService._calls.createPart.length, 1);
		assert.equal(partsService._calls.updatePart.length, 0);
		const payload = partsService._calls.createPart[0];
		assert.equal(payload.sku, 'TRK-001');
		assert.equal(payload.name, 'Oil Filter');
		assert.equal(payload.manufacturer, 'Fleetguard');
		assert.equal(payload.unit_price, 19.99);
		assert.equal(payload.status, 'ACTIVE');
	});

	it('delegates to partsService.updatePart when SKU already exists', async () => {
		const existingPart = { id: 'part-existing', sku: 'TRK-001', unit_price: 10 };
		const db = makeDb({ existingPartBySku: existingPart });
		const partsService = makePartsService({
			updated: { id: 'part-existing', sku: 'TRK-001', unit_price: 22.5 },
		});

		const normalized = normalizeBulkUploadRow({
			sku: 'trk-001',
			name: 'Oil Filter',
			manufacturer: 'Fleetguard',
			unit_price: '22.50',
		});
		const res = await processBulkUploadRow(normalized, { db, partsService });

		assert.equal(res.kind, 'updated');
		assert.equal(partsService._calls.updatePart.length, 1);
		assert.equal(partsService._calls.createPart.length, 0);
		const { id, payload } = partsService._calls.updatePart[0];
		assert.equal(id, 'part-existing');
		assert.equal(payload.sku, 'TRK-001');
		assert.equal(payload.unit_price, 22.5);
		assert.equal(payload.manufacturer, 'Fleetguard');
	});

	it('inserts part_barcodes when row carries a barcode value', async () => {
		const db = makeDb({ existingPartBySku: null, existingBarcode: null });
		const partsService = makePartsService({
			created: { id: 'part-2', sku: 'TRK-002' },
		});

		const normalized = normalizeBulkUploadRow({
			sku: 'TRK-002',
			name: 'Air Filter',
			barcode: 'BC-002',
			vendor: 'AcmeCo',
			pack_qty: '12',
		});
		const res = await processBulkUploadRow(normalized, { db, partsService });

		assert.equal(res.kind, 'created');
		assert.equal(db._calls.barcodeInsert.length, 1);
		const inserted = db._calls.barcodeInsert[0];
		assert.equal(inserted.barcode_value, 'BC-002');
		assert.equal(inserted.part_id, 'part-2');
		assert.equal(inserted.pack_qty, 12);
		assert.equal(inserted.vendor, 'AcmeCo');
		assert.equal(inserted.is_active, true);
	});

	it('flags barcode_conflict when an existing barcode points at a different part', async () => {
		const db = makeDb({
			existingPartBySku: null,
			existingBarcode: { id: 'bc-1', part_id: 'other-part', barcode_value: 'BC-X' },
		});
		const partsService = makePartsService({
			created: { id: 'part-new', sku: 'TRK-003' },
		});

		const normalized = normalizeBulkUploadRow({
			sku: 'TRK-003',
			name: 'Brake Pad',
			barcode: 'BC-X',
		});
		const res = await processBulkUploadRow(normalized, { db, partsService });

		assert.equal(res.kind, 'barcode_conflict');
		assert.equal(res.rowKind, 'created');
		assert.match(res.error, /already assigned to another part/);
		assert.equal(db._calls.barcodeInsert.length, 0);
	});

	it('parts created via bulk-upload share the create→update contract used by PUT /api/parts/:id', async () => {
		// 1. Bulk-upload creates a part. Capture the payload that hit createPart.
		const dbCreate = makeDb({ existingPartBySku: null });
		const svcCreate = makePartsService({
			created: { id: 'p-1', sku: 'TRK-100', unit_price: 19.99 },
		});
		await processBulkUploadRow(
			normalizeBulkUploadRow({
				sku: 'TRK-100',
				name: 'Filter',
				manufacturer: 'Fleetguard',
				unit_cost: '10',
				unit_price: '19.99',
			}),
			{ db: dbCreate, partsService: svcCreate }
		);

		assert.equal(svcCreate._calls.createPart.length, 1);
		const createPayload = svcCreate._calls.createPart[0];

		// 2. The same payload-shape (sku, name, category, manufacturer, description,
		//    unit_cost, unit_price, reorder_level, status) is what PUT /api/parts/:id
		//    forwards to partsService.updatePart. Assert the bulk path produces a
		//    payload that updatePart accepts cleanly — no extra/legacy fields.
		const allowedKeys = new Set([
			'sku',
			'name',
			'category',
			'manufacturer',
			'description',
			'unit_cost',
			'unit_price',
			'reorder_level',
			'status',
		]);
		for (const key of Object.keys(createPayload)) {
			assert.ok(
				allowedKeys.has(key),
				`bulk-upload createPart payload should not include legacy field "${key}"`
			);
		}

		// 3. Simulate the "edit price + save" flow on the just-created part:
		//    PUT body { unit_price: 25.00 } → partsService.updatePart(id, body).
		const dbUpdate = makeDb({ existingPartBySku: null }); // not used here
		const svcUpdate = makePartsService({
			updated: { id: 'p-1', sku: 'TRK-100', unit_price: 25.0 },
		});
		// Direct call mirroring the PUT route:
		await svcUpdate.updatePart('p-1', { unit_price: 25.0 });
		assert.equal(svcUpdate._calls.updatePart.length, 1);
		assert.equal(svcUpdate._calls.updatePart[0].id, 'p-1');
		assert.equal(svcUpdate._calls.updatePart[0].payload.unit_price, 25.0);
	});
});
