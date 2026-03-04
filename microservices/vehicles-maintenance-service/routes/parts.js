const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const partsService = require('../services/parts.service');
const barcodesService = require('../services/barcodes.service');
const db = require('../config/knex');

const upload = multer({ storage: multer.memoryStorage() });

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

function toNumberOrDefault(v, fallback = 0) {
	if (v === null || v === undefined || String(v).trim() === '') return fallback;
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function normalizeHeader(key) {
	return String(key || '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '_')
		.replace(/-/g, '_');
}

function pick(row, keys = []) {
	const normalized = {};
	for (const [k, v] of Object.entries(row || {})) {
		normalized[normalizeHeader(k)] = v;
	}
	for (const key of keys) {
		const val = normalized[normalizeHeader(key)];
		if (val !== undefined && val !== null && String(val).trim() !== '') {
			return String(val).trim();
		}
	}
	return '';
}

/**
 * GET /api/parts/template
 * Download Excel template for bulk parts upload
 */
router.get('/template', authMiddleware, requireRole(['admin', 'parts_manager']), async (_req, res) => {
	try {
		const workbook = XLSX.utils.book_new();
		const rows = [
			[
				'sku',
				'name',
				'category',
				'manufacturer',
				'uom',
				'unit_cost',
				'unit_price',
				'reorder_level',
				'description',
				'barcode',
				'pack_qty',
				'vendor',
				'status'
			],
			[
				'TRK-001',
				'Oil Filter - Cummins ISX',
				'Engine',
				'Fleetguard',
				'each',
				'12.50',
				'19.99',
				'5',
				'Heavy duty oil filter',
				'TRK-001',
				'1',
				'Fleetguard',
				'ACTIVE'
			]
		];

		const worksheet = XLSX.utils.aoa_to_sheet(rows);
		XLSX.utils.book_append_sheet(workbook, worksheet, 'Parts');

		const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename="parts-upload-template.xlsx"');
		return res.send(buffer);
	} catch (error) {
		dtLogger.error('parts_template_download_failed', { error: error.message });
		return res.status(500).json({ error: error.message });
	}
});

/**
 * POST /api/parts/bulk-upload
 * Upload parts from Excel file (.xlsx/.xls/.csv)
 */
router.post('/bulk-upload', authMiddleware, requireRole(['admin', 'parts_manager']), upload.single('file'), async (req, res) => {
	try {
		if (!req.file?.buffer) {
			return res.status(400).json({ error: 'file is required' });
		}

		// Check if reorder_level column exists in the database
		const partsColumns = await db('parts').columnInfo();
		const hasReorderLevel = 'reorder_level' in partsColumns;

		const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
		const firstSheetName = workbook.SheetNames[0];
		if (!firstSheetName) {
			return res.status(400).json({ error: 'No worksheet found in file' });
		}

		const worksheet = workbook.Sheets[firstSheetName];
		const records = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

		if (!records.length) {
			return res.status(400).json({ error: 'No data rows found in worksheet' });
		}

		const summary = {
			totalRows: records.length,
			created: 0,
			updated: 0,
			skipped: 0,
			errors: []
		};

		for (let i = 0; i < records.length; i += 1) {
			const row = records[i];
			const rowNumber = i + 2; // header row is 1

			const sku = pick(row, ['sku', 'part_sku']).toUpperCase();
			const name = pick(row, ['name', 'part_name']);
			const category = pick(row, ['category']);
			const manufacturer = pick(row, ['manufacturer']);
			const description = pick(row, ['description']);
			const barcodeValue = pick(row, ['barcode', 'barcode_value']);
			const vendor = pick(row, ['vendor']);
			const status = (pick(row, ['status']) || 'ACTIVE').toUpperCase();
			const unitCost = toNumberOrDefault(pick(row, ['unit_cost', 'cost']), 0);
			const unitPrice = toNumberOrDefault(pick(row, ['unit_price', 'price', 'default_retail_price']), 0);
			const reorderLevel = toNumberOrDefault(pick(row, ['reorder_level', 'min_stock_level']), 5);
			const packQty = Math.max(1, Math.floor(toNumberOrDefault(pick(row, ['pack_qty']), 1)));

			if (!sku || !name) {
				summary.skipped += 1;
				summary.errors.push({ row: rowNumber, sku, error: 'sku and name are required' });
				continue;
			}

			try {
				const existing = await db('parts').whereRaw('LOWER(sku) = LOWER(?)', [sku]).first();

				let part;
				if (existing) {
					const updateData = {
						sku,
						name,
						category,
						manufacturer,
						description,
						unit_cost: unitCost,
						unit_price: unitPrice,
						status
					};
					if (hasReorderLevel) {
						updateData.reorder_level = reorderLevel;
					}
					const [updated] = await db('parts')
						.where({ id: existing.id })
						.update(updateData)
						.returning('*');
					part = updated;
					summary.updated += 1;
				} else {
					const insertData = {
						sku,
						name,
						category,
						manufacturer,
						description,
						unit_cost: unitCost,
						unit_price: unitPrice,
						status
					};
					if (hasReorderLevel) {
						insertData.reorder_level = reorderLevel;
					}
					const [created] = await db('parts')
						.insert(insertData)
						.returning('*');
					part = created;
					summary.created += 1;
				}

				if (barcodeValue) {
					const existingBarcode = await db('part_barcodes')
						.whereRaw('LOWER(barcode_value) = LOWER(?)', [barcodeValue])
						.first();

					if (!existingBarcode) {
						await db('part_barcodes').insert({
							barcode_value: barcodeValue,
							part_id: part.id,
							pack_qty: packQty,
							vendor: vendor || null,
							is_active: true
						});
					} else if (existingBarcode.part_id === part.id) {
						await db('part_barcodes')
							.where({ id: existingBarcode.id })
							.update({
								pack_qty: packQty,
								vendor: vendor || existingBarcode.vendor,
								is_active: true
							});
					} else {
						summary.errors.push({ row: rowNumber, sku, error: `Barcode ${barcodeValue} already assigned to another part` });
					}
				}
			} catch (rowErr) {
				summary.skipped += 1;
				summary.errors.push({ row: rowNumber, sku, error: rowErr.message });
			}
		}

		dtLogger.info('parts_bulk_upload_completed', {
			userId: req.user?.id,
			totalRows: summary.totalRows,
			created: summary.created,
			updated: summary.updated,
			skipped: summary.skipped,
			errorCount: summary.errors.length
		});

		return res.status(201).json({
			success: true,
			data: summary,
			message: `Bulk upload complete. Created ${summary.created}, updated ${summary.updated}, skipped ${summary.skipped}.`
		});
	} catch (error) {
		dtLogger.error('parts_bulk_upload_failed', { error: error.message });
		return res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/parts
 * Get all active parts with optional filters
 */
router.get('/', authMiddleware, async (req, res) => {
	try {
		const filters = {
			category: req.query.category,
			manufacturer: req.query.manufacturer,
			search: req.query.search
		};

		const parts = await partsService.getParts(filters);

		res.json({
			success: true,
			data: parts
		});
	} catch (error) {
		dtLogger.error('parts_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/parts/categories
 * Get list of distinct categories
 */
router.get('/categories', authMiddleware, async (req, res) => {
	try {
		const categories = await partsService.getCategories();

		res.json({
			success: true,
			data: categories
		});
	} catch (error) {
		dtLogger.error('categories_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/parts/manufacturers
 * Get list of distinct manufacturers
 */
router.get('/manufacturers', authMiddleware, async (req, res) => {
	try {
		const manufacturers = await partsService.getManufacturers();

		res.json({
			success: true,
			data: manufacturers
		});
	} catch (error) {
		dtLogger.error('manufacturers_get_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * POST /api/parts/:partId/barcodes
 * Assign a barcode to a part (supports pack qty)
 * Requires: Admin or Parts Manager role
 */
router.post('/:partId/barcodes', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const { barcodeValue, packQty, vendor } = req.body || {};
		const created = await barcodesService.assignBarcodeToPart(req.params.partId, {
			barcodeValue,
			packQty,
			vendor
		});

		res.status(201).json({
			success: true,
			data: created,
			message: 'Barcode assigned successfully'
		});
	} catch (error) {
		dtLogger.error('part_barcode_assign_failed', { partId: req.params.partId, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * GET /api/parts/:partId/barcodes
 * List barcodes assigned to a part
 */
router.get('/:partId/barcodes', authMiddleware, async (req, res) => {
	try {
		const rows = await barcodesService.getBarcodesByPart(req.params.partId);
		res.json({ success: true, data: rows });
	} catch (error) {
		dtLogger.error('part_barcodes_get_failed', { partId: req.params.partId, error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * GET /api/parts/:id
 * Get a single part by ID
 */
router.get('/:id([0-9a-fA-F-]{36})', authMiddleware, async (req, res) => {
	try {
		const part = await partsService.getPartById(req.params.id);

		res.json({
			success: true,
			data: part
		});
	} catch (error) {
		dtLogger.error('part_get_failed', { id: req.params.id, error: error.message });
		res.status(404).json({ error: error.message });
	}
});

/**
 * POST /api/parts
 * Create a new part
 * Requires: Admin or Parts Manager role
 */
router.post('/', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const partData = req.body;

		const part = await partsService.createPart(partData);

		res.status(201).json({
			success: true,
			data: part,
			message: `Part ${part.sku} created successfully`
		});
	} catch (error) {
		dtLogger.error('part_creation_failed', { error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * PUT /api/parts/:id
 * Update an existing part
 * Requires: Admin or Parts Manager role
 */
router.put('/:id([0-9a-fA-F-]{36})', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const part = await partsService.updatePart(req.params.id, req.body);

		res.json({
			success: true,
			data: part,
			message: 'Part updated successfully'
		});
	} catch (error) {
		dtLogger.error('part_update_failed', { id: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

/**
 * PATCH /api/parts/:id/deactivate
 * Deactivate a part (soft delete)
 * Requires: Admin or Parts Manager role
 */
router.patch('/:id([0-9a-fA-F-]{36})/deactivate', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const part = await partsService.deactivatePart(req.params.id);

		res.json({
			success: true,
			data: part,
			message: 'Part deactivated successfully'
		});
	} catch (error) {
		dtLogger.error('part_deactivation_failed', { id: req.params.id, error: error.message });
		res.status(400).json({ error: error.message });
	}
});

module.exports = router;
