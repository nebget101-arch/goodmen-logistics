const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const partsService = require('../services/parts.service');
const barcodesService = require('../services/barcodes.service');
const db = require('../internal/db').knex;

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
 * @openapi
 * /api/parts/template:
 *   get:
 *     summary: Download parts bulk upload template
 *     description: >-
 *       Returns an Excel (.xlsx) template file with column headers and a sample
 *       row for bulk-uploading parts. Columns include sku, name, category,
 *       manufacturer, uom, unit_cost, unit_price, reorder_level, description,
 *       barcode, pack_qty, vendor, and status.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Excel template file download
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       500:
 *         description: Failed to generate template
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
 * @openapi
 * /api/parts/bulk-upload:
 *   post:
 *     summary: Bulk upload parts from Excel file
 *     description: >-
 *       Parses an uploaded Excel file and creates or updates parts for each row.
 *       Existing parts (matched by SKU) are updated; new parts are inserted.
 *       Barcodes are also created or updated when a barcode column is present.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Excel file (.xlsx, .xls, or .csv)
 *     responses:
 *       201:
 *         description: Bulk upload summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalRows:
 *                       type: integer
 *                     created:
 *                       type: integer
 *                     updated:
 *                       type: integer
 *                     skipped:
 *                       type: integer
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           row:
 *                             type: integer
 *                           sku:
 *                             type: string
 *                           error:
 *                             type: string
 *                 message:
 *                   type: string
 *       400:
 *         description: File required or no data found
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/parts/bulk:
 *   post:
 *     summary: Bulk-create parts from JSON (FN-1103)
 *     description: >-
 *       Creates many parts in a single transaction. Used by the Quick Add
 *       Invoice OCR flow (FN-1101) after the user reviews/edits AI-extracted
 *       line items. Dedupes by SKU within the request and against existing
 *       DB rows. Auto-creates vendor and manufacturer master rows when
 *       only free-text values are supplied (FN-1091/1093). All inserts
 *       run in one transaction — any failure rolls back the whole batch
 *       and returns 500.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 description: Parts to create (each requires sku and name)
 *                 items:
 *                   type: object
 *                   required: [sku, name]
 *                   properties:
 *                     sku:
 *                       type: string
 *                     name:
 *                       type: string
 *                     category:
 *                       type: string
 *                     manufacturer:
 *                       type: string
 *                     description:
 *                       type: string
 *                     unit_cost:
 *                       type: number
 *                     unit_price:
 *                       type: number
 *                     reorder_level:
 *                       type: integer
 *                     preferred_vendor_name:
 *                       type: string
 *     responses:
 *       201:
 *         description: Bulk-create result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 created:
 *                   type: array
 *                   items:
 *                     type: object
 *                 skipped:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       sku:
 *                         type: string
 *                       reason:
 *                         type: string
 *                         enum: [duplicate_in_request, sku_exists, missing_sku_or_name]
 *       400:
 *         description: items must be a non-empty array
 *       500:
 *         description: Insert failed; full batch rolled back
 */
router.post('/bulk', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {
	try {
		const items = req.body && Array.isArray(req.body.items) ? req.body.items : null;
		if (!items || items.length === 0) {
			return res.status(400).json({ error: 'items must be a non-empty array' });
		}

		const result = await partsService.bulkCreateParts(items);

		dtLogger.info('parts_bulk_create_completed', {
			userId: req.user?.id,
			created: result.created.length,
			skipped: result.skipped.length,
		});

		return res.status(201).json({
			success: true,
			created: result.created,
			skipped: result.skipped,
		});
	} catch (error) {
		dtLogger.error('parts_bulk_create_failed', { error: error.message });
		return res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/parts:
 *   get:
 *     summary: List all parts
 *     description: Returns all active parts with optional category, manufacturer, and search filters.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by part category
 *       - in: query
 *         name: manufacturer
 *         schema:
 *           type: string
 *         description: Filter by manufacturer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Free-text search across part fields
 *     responses:
 *       200:
 *         description: List of parts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/parts/categories:
 *   get:
 *     summary: List part categories
 *     description: Returns a list of distinct part categories for use in filter dropdowns.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/parts/manufacturers:
 *   get:
 *     summary: List part manufacturers
 *     description: Returns a list of distinct part manufacturers for use in filter dropdowns.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of manufacturers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Server error
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

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function clampInt(value, fallback, min, max) {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * @openapi
 * /api/parts/recent-at-location/{locationId}:
 *   get:
 *     summary: Recently received parts at a location (FN-1485)
 *     description: >-
 *       Returns DISTINCT active parts most recently received at the location,
 *       ordered by `MAX(inventory_transactions.created_at)` for transactions of
 *       type RECEIVE. Powers the "Recent" tab of the warehouse-receiving
 *       quick-add panel (FN-1479). Empty set returns `{ data: [] }`, not 404.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Location UUID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *     responses:
 *       200:
 *         description: List of recently received parts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       sku:
 *                         type: string
 *                       name:
 *                         type: string
 *                       default_cost:
 *                         type: number
 *                       on_hand_qty:
 *                         type: integer
 *                       last_received_at:
 *                         type: string
 *                         format: date-time
 *       400:
 *         description: Invalid locationId
 *       500:
 *         description: Server error
 */
router.get('/recent-at-location/:locationId', authMiddleware, async (req, res) => {
	try {
		const { locationId } = req.params;
		if (!UUID_RE.test(locationId)) {
			return res.status(400).json({ error: 'locationId must be a UUID' });
		}
		const limit = clampInt(req.query.limit, 20, 1, 100);

		const recent = db('inventory_transactions')
			.select('part_id')
			.max({ last_received_at: 'created_at' })
			.where({ location_id: locationId, transaction_type: 'RECEIVE' })
			.groupBy('part_id')
			.orderBy('last_received_at', 'desc')
			.limit(limit)
			.as('recent');

		const rows = await db
			.from(recent)
			.innerJoin('parts', 'parts.id', 'recent.part_id')
			.leftJoin({ inv: 'inventory' }, function () {
				this.on('inv.part_id', '=', 'parts.id').andOn(
					'inv.location_id',
					'=',
					db.raw('?', [locationId])
				);
			})
			.where('parts.is_active', true)
			.select(
				'parts.id',
				'parts.sku',
				'parts.name',
				'parts.default_cost',
				db.raw('COALESCE(inv.on_hand_qty, 0)::int as on_hand_qty'),
				'recent.last_received_at'
			)
			.orderBy('recent.last_received_at', 'desc');

		res.json({ success: true, data: rows });
	} catch (error) {
		dtLogger.error('parts_recent_at_location_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/parts/common-at-location/{locationId}:
 *   get:
 *     summary: Most-received parts at a location over a time window (FN-1485)
 *     description: >-
 *       Returns active parts ranked by `SUM(inventory_transactions.qty_change)`
 *       for transactions of type RECEIVE at the location within the last
 *       `days` days. Powers the "Common" tab of the warehouse-receiving
 *       quick-add panel (FN-1479). Empty set returns `{ data: [] }`, not 404.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 365
 *           default: 90
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *     responses:
 *       200:
 *         description: List of most-received parts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       sku:
 *                         type: string
 *                       name:
 *                         type: string
 *                       default_cost:
 *                         type: number
 *                       on_hand_qty:
 *                         type: integer
 *                       total_received_qty:
 *                         type: integer
 *       400:
 *         description: Invalid locationId
 *       500:
 *         description: Server error
 */
router.get('/common-at-location/:locationId', authMiddleware, async (req, res) => {
	try {
		const { locationId } = req.params;
		if (!UUID_RE.test(locationId)) {
			return res.status(400).json({ error: 'locationId must be a UUID' });
		}
		const days = clampInt(req.query.days, 90, 1, 365);
		const limit = clampInt(req.query.limit, 20, 1, 100);

		const common = db('inventory_transactions')
			.select('part_id')
			.sum({ total_received_qty: 'qty_change' })
			.where({ location_id: locationId, transaction_type: 'RECEIVE' })
			.andWhere('created_at', '>=', db.raw(`NOW() - (? || ' days')::interval`, [days]))
			.groupBy('part_id')
			.orderBy('total_received_qty', 'desc')
			.limit(limit)
			.as('common');

		const rows = await db
			.from(common)
			.innerJoin('parts', 'parts.id', 'common.part_id')
			.leftJoin({ inv: 'inventory' }, function () {
				this.on('inv.part_id', '=', 'parts.id').andOn(
					'inv.location_id',
					'=',
					db.raw('?', [locationId])
				);
			})
			.where('parts.is_active', true)
			.select(
				'parts.id',
				'parts.sku',
				'parts.name',
				'parts.default_cost',
				db.raw('COALESCE(inv.on_hand_qty, 0)::int as on_hand_qty'),
				db.raw('common.total_received_qty::int as total_received_qty')
			)
			.orderBy('total_received_qty', 'desc');

		res.json({ success: true, data: rows });
	} catch (error) {
		dtLogger.error('parts_common_at_location_failed', { error: error.message });
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/parts/duplicate-check:
 *   get:
 *     summary: Find possible duplicate parts via fuzzy match (FN-1110)
 *     description: >-
 *       Returns up to `limit` parts whose name, sku, or manufacturer is
 *       similar to the provided query terms. Uses pg_trgm `similarity()` with
 *       a weighted blend (name 0.5 + sku 0.3 + manufacturer 0.2) and a
 *       per-component threshold of 0.85, so a strong match on any single
 *       supplied field is enough to surface a row. At least one of `name`,
 *       `sku`, or `manufacturer` must be provided.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *       - in: query
 *         name: sku
 *         schema:
 *           type: string
 *       - in: query
 *         name: manufacturer
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *           minimum: 1
 *           maximum: 25
 *     responses:
 *       200:
 *         description: List of duplicate candidates sorted by blended similarity desc
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       name:
 *                         type: string
 *                       sku:
 *                         type: string
 *                       manufacturer:
 *                         type: string
 *                         nullable: true
 *                       similarity:
 *                         type: number
 *       400:
 *         description: At least one of name/sku/manufacturer must be provided
 *       500:
 *         description: Server error
 */
router.get('/duplicate-check', authMiddleware, async (req, res) => {
	try {
		const name = String(req.query.name || '').trim();
		const sku = String(req.query.sku || '').trim();
		const manufacturer = String(req.query.manufacturer || '').trim();

		if (!name && !sku && !manufacturer) {
			return res.status(400).json({
				error: 'At least one of name, sku, or manufacturer must be provided'
			});
		}

		const candidates = await partsService.findDuplicateCandidates({
			name,
			sku,
			manufacturer,
			limit: req.query.limit
		});

		return res.json({
			success: true,
			data: candidates
		});
	} catch (error) {
		dtLogger.error('parts_duplicate_check_failed', { error: error.message });
		return res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/parts/{partId}/barcodes:
 *   post:
 *     summary: Assign a barcode to a part
 *     description: >-
 *       Creates a barcode-to-part mapping. Supports pack quantity so a single
 *       barcode scan can represent multiple units of the part.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: partId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Part ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               barcodeValue:
 *                 type: string
 *               packQty:
 *                 type: integer
 *                 description: Number of units per barcode scan
 *               vendor:
 *                 type: string
 *     responses:
 *       201:
 *         description: Barcode assigned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
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
 * @openapi
 * /api/parts/{partId}/barcodes:
 *   get:
 *     summary: List barcodes for a part
 *     description: Returns all barcode mappings assigned to the specified part.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: partId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Part ID
 *     responses:
 *       200:
 *         description: List of barcodes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
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
 * @openapi
 * /api/parts/{id}:
 *   get:
 *     summary: Get a part by ID
 *     description: Returns a single part by its UUID.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Part ID
 *     responses:
 *       200:
 *         description: Part details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       404:
 *         description: Part not found
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
 * @openapi
 * /api/parts:
 *   post:
 *     summary: Create a new part
 *     description: Creates a new part in the parts catalog. Requires admin or parts_manager role.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sku
 *               - name
 *             properties:
 *               sku:
 *                 type: string
 *               name:
 *                 type: string
 *               category:
 *                 type: string
 *               manufacturer:
 *                 type: string
 *               description:
 *                 type: string
 *               unit_cost:
 *                 type: number
 *               unit_price:
 *                 type: number
 *               reorder_level:
 *                 type: integer
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, INACTIVE]
 *               image_r2_key:
 *                 type: string
 *                 description: >-
 *                   FN-1098. R2 storage key returned by
 *                   `/api/ai/parts/identify-from-photo` (e.g. `parts/photos/<uuid>.jpg`).
 *                   Persists to `parts.image_url`.
 *     responses:
 *       201:
 *         description: Part created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
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
 * @openapi
 * /api/parts/{id}:
 *   put:
 *     summary: Update a part
 *     description: Updates an existing part by ID. Requires admin or parts_manager role.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Part ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sku:
 *                 type: string
 *               name:
 *                 type: string
 *               category:
 *                 type: string
 *               manufacturer:
 *                 type: string
 *               description:
 *                 type: string
 *               unit_cost:
 *                 type: number
 *               unit_price:
 *                 type: number
 *               reorder_level:
 *                 type: integer
 *               status:
 *                 type: string
 *               image_r2_key:
 *                 type: string
 *                 description: >-
 *                   FN-1098. R2 storage key returned by
 *                   `/api/ai/parts/identify-from-photo`. Persists to `parts.image_url`.
 *                   Pass `null` or an empty string to clear the image.
 *     responses:
 *       200:
 *         description: Part updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
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
 * @openapi
 * /api/parts/{id}/deactivate:
 *   patch:
 *     summary: Deactivate a part
 *     description: >-
 *       Soft-deletes a part by setting its status to INACTIVE.
 *       Requires admin or parts_manager role.
 *     tags:
 *       - Parts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Part ID
 *     responses:
 *       200:
 *         description: Part deactivated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
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
