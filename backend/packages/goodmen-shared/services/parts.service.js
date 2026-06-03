const db = require('../internal/db').knex;
const dtLogger = require('../utils/logger');
const manufacturersService = require('./manufacturers.service');
const vendorsService = require('./vendors.service');
const { resolveBarcodeForCreate } = require('./barcode-generator');
const { ValidationError, validateCostValue } = require('../utils/cost-validators');

/**
 * FN-1098: Resolve the image-storage patch for a part insert/update.
 *
 * The Quick Add Photo flow (FN-1098) uploads the photo to R2 first and
 * returns an `r2Key` (e.g. `parts/photos/<uuid>.jpg`). When the user saves
 * the prefilled form, the FE re-sends that key as `image_r2_key`. We persist
 * it directly into `parts.image_url` — the column stores the R2 object key
 * (the storage helper's URL convention); pre-signed download URLs are
 * generated on read, never stored, because they expire.
 *
 * Caller may also pass `image_url` directly (e.g. legacy bulk-upload flow);
 * `image_r2_key` takes precedence when both are present.
 */
function resolveImageR2Patch(input = {}) {
	const patch = {};
	if (input.image_r2_key !== undefined) {
		if (input.image_r2_key === null || input.image_r2_key === '') {
			patch.image_url = null;
		} else if (typeof input.image_r2_key === 'string') {
			patch.image_url = input.image_r2_key;
		}
	} else if (input.image_url !== undefined) {
		patch.image_url = input.image_url || null;
	}
	return patch;
}

/**
 * FN-1364: Coerce a missing/empty/whitespace-only category to 'Uncategorized'.
 *
 * The DB column is nullable as of FN-1363; product policy is "if AI couldn't
 * classify it (or the user didn't pick a category), label it Uncategorized at
 * the service layer so list/filter UI never has to render NULL." Manual paths
 * that intentionally omit category get the same treatment.
 */
function normalizeCategory(value) {
	if (typeof value !== 'string') return 'Uncategorized';
	const trimmed = value.trim();
	return trimmed === '' ? 'Uncategorized' : trimmed;
}

/**
 * Resolve manufacturer + vendor inputs into a normalized patch:
 *   { manufacturer_id, manufacturer, vendor_id, preferred_vendor_name }
 *
 * Rules (per FN-1093):
 *   - If `manufacturer_id` provided: load master row, force `manufacturer` to
 *     master.name (FK is authoritative).
 *   - Else if non-empty `manufacturer` text provided: find-or-create master,
 *     set both FK and text (canonicalized to master.name).
 *
 * Same logic for vendor_id / preferred_vendor_name.
 *
 * Only includes keys the caller actually supplied so updatePart's
 * partial-update semantics are preserved.
 */
async function resolveManufacturerVendor(input = {}) {
	const patch = {};

	if (input.manufacturer_id !== undefined && input.manufacturer_id !== null) {
		const master = await manufacturersService.getById(input.manufacturer_id);
		patch.manufacturer_id = master.id;
		patch.manufacturer = master.name;
	} else if (input.manufacturer_id === null) {
		patch.manufacturer_id = null;
		if (input.manufacturer !== undefined) {
			patch.manufacturer = input.manufacturer || null;
		}
	} else if (typeof input.manufacturer === 'string' && input.manufacturer.trim()) {
		const master = await manufacturersService.findOrCreate(input.manufacturer);
		if (master) {
			patch.manufacturer_id = master.id;
			patch.manufacturer = master.name;
		}
	} else if (input.manufacturer !== undefined) {
		patch.manufacturer = input.manufacturer || null;
	}

	if (input.vendor_id !== undefined && input.vendor_id !== null) {
		const master = await vendorsService.getById(input.vendor_id);
		patch.vendor_id = master.id;
		patch.preferred_vendor_name = master.name;
	} else if (input.vendor_id === null) {
		patch.vendor_id = null;
		if (input.preferred_vendor_name !== undefined) {
			patch.preferred_vendor_name = input.preferred_vendor_name || null;
		}
	} else if (typeof input.preferred_vendor_name === 'string' && input.preferred_vendor_name.trim()) {
		const master = await vendorsService.findOrCreate(input.preferred_vendor_name);
		if (master) {
			patch.vendor_id = master.id;
			patch.preferred_vendor_name = master.name;
		}
	} else if (input.preferred_vendor_name !== undefined) {
		patch.preferred_vendor_name = input.preferred_vendor_name || null;
	}

	return patch;
}

/**
 * FN-1400: Returns true if a candidate barcode value is already taken by either
 * `parts.barcode` (primary storage for the auto-generated label value) or
 * `part_barcodes.barcode_value` (secondary mappings used by scanner flows).
 * Cross-checking both tables is defensive — a generated value must be globally
 * unique across anything a scanner might match against.
 */
async function isBarcodeTaken(value) {
	const [partsHit, barcodesHit] = await Promise.all([
		db('parts').where('barcode', value).first(),
		db('part_barcodes').where('barcode_value', value).first(),
	]);
	return Boolean(partsHit || barcodesHit);
}

/**
 * Get active-parts filter for schema compatibility.
 * Parts table may have either status (ACTIVE/INACTIVE) or is_active (boolean).
 */
async function getActivePartsCondition() {
	const cols = await db('parts').columnInfo();
	if (cols.status) {
		// Case-insensitive: production may have "active" (seed) or "ACTIVE" (bulk upload)
		return (q) => q.whereRaw('LOWER(p.status) = ?', ['active']);
	}
	// Fallback for schema with is_active only
	return (q) => q.where('p.is_active', true);
}

/**
 * Get all active parts with optional filters
 */
async function getParts(filters = {}) {
	try {
		const inventoryAgg = db('inventory')
			.select('part_id')
			.sum({ quantity_on_hand: 'on_hand_qty' })
			.groupBy('part_id')
			.as('inv');

		const activeFilter = await getActivePartsCondition();
		let query = db('parts as p')
			.leftJoin(inventoryAgg, 'p.id', 'inv.part_id')
			.select('p.*', db.raw('COALESCE(inv.quantity_on_hand, 0) as quantity_on_hand'));
		query = activeFilter(query);

		if (filters.category) {
			query = query.where('p.category', filters.category);
		}
		if (filters.manufacturer) {
			query = query.where('p.manufacturer', filters.manufacturer);
		}
		if (filters.search) {
			query = query.where(function() {
				this.whereRaw('LOWER(sku) LIKE ?', [`%${filters.search.toLowerCase()}%`])
					.orWhereRaw('LOWER(name) LIKE ?', [`%${filters.search.toLowerCase()}%`]);
			});
		}

		const parts = await query.orderBy('p.sku', 'asc');

		dtLogger.info('parts_retrieved', { count: parts.length });

		return parts;
	} catch (error) {
		dtLogger.error('parts_retrieval_failed', { error: error.message });
		throw error;
	}
}

/**
 * Get a single part by ID
 */
async function getPartById(id) {
	try {
		const inventoryAgg = db('inventory')
			.select('part_id')
			.sum({ quantity_on_hand: 'on_hand_qty' })
			.groupBy('part_id')
			.as('inv');

		const part = await db('parts as p')
			.leftJoin(inventoryAgg, 'p.id', 'inv.part_id')
			.select('p.*', db.raw('COALESCE(inv.quantity_on_hand, 0) as quantity_on_hand'))
			.where('p.id', id)
			.first();

		if (!part) {
			throw new Error(`Part ${id} not found`);
		}

		return part;
	} catch (error) {
		dtLogger.error('part_retrieval_failed', { id, error: error.message });
		throw error;
	}
}

/**
 * Get part by SKU
 */
async function getPartBySku(sku) {
	try {
		const inventoryAgg = db('inventory')
			.select('part_id')
			.sum({ quantity_on_hand: 'on_hand_qty' })
			.groupBy('part_id')
			.as('inv');

		const part = await db('parts as p')
			.leftJoin(inventoryAgg, 'p.id', 'inv.part_id')
			.select('p.*', db.raw('COALESCE(inv.quantity_on_hand, 0) as quantity_on_hand'))
			.where('p.sku', sku)
			.first();

		if (!part) {
			throw new Error(`Part with SKU ${sku} not found`);
		}

		return part;
	} catch (error) {
		dtLogger.error('part_by_sku_retrieval_failed', { sku, error: error.message });
		throw error;
	}
}

/**
 * Create a new part
 */
async function createPart(partData) {
	try {
		// Validate required fields
		if (!partData.sku || !partData.name) {
			throw new Error('SKU and name are required');
		}

		// Check for duplicate SKU
		const existing = await db('parts').where('sku', partData.sku).first();
		if (existing) {
			throw new Error(`Part with SKU ${partData.sku} already exists`);
		}

		const mvPatch = await resolveManufacturerVendor(partData);
		const imagePatch = resolveImageR2Patch(partData);
		const barcode = await resolveBarcodeForCreate(partData.barcode, isBarcodeTaken);

		const part = await db('parts').insert({
			sku: partData.sku.toUpperCase(),
			name: partData.name,
			category: normalizeCategory(partData.category),
			description: partData.description,
			unit_cost: partData.unit_cost || 0,
			unit_price: partData.unit_price || 0,
			quantity_on_hand: partData.quantity_on_hand || 0,
			reorder_level: partData.reorder_level || 5,
			supplier_id: partData.supplier_id,
			// FN-1544: respect caller-supplied status (e.g. bulk-upload row may
			// be INACTIVE) instead of hard-coding ACTIVE.
			status: typeof partData.status === 'string' && partData.status.trim()
				? partData.status.toUpperCase()
				: 'ACTIVE',
			barcode,
			...mvPatch,
			...imagePatch,
		}).returning('*');

		dtLogger.info('part_created', { id: part[0].id, sku: part[0].sku });

		return part[0];
	} catch (error) {
		dtLogger.error('part_creation_failed', { sku: partData.sku, error: error.message });
		throw error;
	}
}

/**
 * Update an existing part
 */
async function updatePart(id, partData) {
	try {
		// Check part exists
		const existing = await db('parts').where({ id }).first();
		if (!existing) {
			throw new Error(`Part ${id} not found`);
		}

		// If updating SKU, check for duplicates
		if (partData.sku && partData.sku !== existing.sku) {
			const duplicate = await db('parts').where('sku', partData.sku).first();
			if (duplicate) {
				throw new Error(`Part with SKU ${partData.sku} already exists`);
			}
		}

		const updateData = {};
		if (partData.sku) updateData.sku = partData.sku.toUpperCase();
		if (partData.name) updateData.name = partData.name;
		if (partData.category) updateData.category = partData.category;
		if (partData.description !== undefined) updateData.description = partData.description;
		if (partData.unit_cost !== undefined) updateData.unit_cost = partData.unit_cost;
		if (partData.unit_price !== undefined) updateData.unit_price = partData.unit_price;
		if (partData.quantity_on_hand !== undefined) updateData.quantity_on_hand = partData.quantity_on_hand;
		if (partData.reorder_level !== undefined) updateData.reorder_level = partData.reorder_level;
		if (partData.supplier_id !== undefined) updateData.supplier_id = partData.supplier_id;

		const mvPatch = await resolveManufacturerVendor(partData);
		Object.assign(updateData, mvPatch);
		const imagePatch = resolveImageR2Patch(partData);
		Object.assign(updateData, imagePatch);
		// Preserve status or ensure it's ACTIVE (automatic for new parts with quantity > 0)
		if (partData.status !== undefined) {
			updateData.status = partData.status;
		} else {
			// If status not provided in update, preserve existing status
			updateData.status = existing.status || 'ACTIVE';
		}

		const updated = await db('parts').where({ id }).update(updateData).returning('*');

		dtLogger.info('part_updated', { id, sku: updated[0].sku });

		return updated[0];
	} catch (error) {
		dtLogger.error('part_update_failed', { id, error: error.message });
		throw error;
	}
}

/**
 * Delete a part
 */
async function deletePart(id) {
	try {
		const part = await db('parts').where({ id }).first();
		if (!part) {
			throw new Error(`Part ${id} not found`);
		}

		await db('parts').where({ id }).del();

		dtLogger.info('part_deleted', { id, sku: part.sku });

		return { success: true, id };
	} catch (error) {
		dtLogger.error('part_deletion_failed', { id, error: error.message });
		throw error;
	}
}

/**
 * FN-1555: Soft-delete (deactivate) a part. Schema-compatible with both shapes
 * the parts table has shipped under: `status` (ACTIVE/INACTIVE) where present,
 * else fall back to the `is_active` boolean column. Returns the updated row.
 */
async function deactivatePart(id) {
	try {
		const existing = await db('parts').where({ id }).first();
		if (!existing) {
			throw new Error(`Part ${id} not found`);
		}

		const cols = await db('parts').columnInfo();
		const updateData = {};
		if (cols.status) {
			updateData.status = 'INACTIVE';
		} else if (cols.is_active) {
			updateData.is_active = false;
		} else {
			throw new Error('parts table is missing both status and is_active columns');
		}
		if (cols.updated_at) {
			updateData.updated_at = db.fn.now();
		}

		const updated = await db('parts').where({ id }).update(updateData).returning('*');

		dtLogger.info('part_deactivated', { id, sku: existing.sku });

		return updated[0];
	} catch (error) {
		dtLogger.error('part_deactivation_failed', { id, error: error.message });
		throw error;
	}
}

/**
 * FN-1103: Bulk-create parts from a JSON list (Quick Add Invoice flow).
 *
 * - Dedup within the request: if the same SKU appears more than once,
 *   the first occurrence wins, later ones go into `skipped` with
 *   `reason: 'duplicate_in_request'`.
 * - Dedup against existing rows: any SKU that already exists in the DB
 *   goes into `skipped` with `reason: 'sku_exists'`. A single
 *   `WHERE sku IN (...)` query checks all SKUs at once.
 * - FK auto-create for vendor + manufacturer via
 *   `resolveManufacturerVendor` (FN-1091/1093).
 * - All inserts wrap in one transaction. If any insert fails the
 *   transaction rolls back and the error is rethrown for the caller
 *   to translate to HTTP 500.
 *
 * Returns `{ created: [partRow, ...], skipped: [{ sku, reason }, ...] }`.
 */
async function bulkCreateParts(items) {
	if (!Array.isArray(items) || items.length === 0) {
		throw new Error('items must be a non-empty array');
	}

	// Validate basics + dedup within request.
	const skipped = [];
	const seenInRequest = new Set();
	const candidates = []; // items to actually insert
	for (const raw of items) {
		if (!raw || typeof raw !== 'object') continue;
		const sku = typeof raw.sku === 'string' ? raw.sku.trim().toUpperCase() : '';
		const name = typeof raw.name === 'string' ? raw.name.trim() : '';

		if (!sku || !name) {
			skipped.push({
				sku: sku || '',
				reason: 'missing_sku_or_name',
			});
			continue;
		}

		if (seenInRequest.has(sku)) {
			skipped.push({ sku, reason: 'duplicate_in_request' });
			continue;
		}
		seenInRequest.add(sku);
		candidates.push({ ...raw, sku, name });
	}

	if (candidates.length === 0) {
		return { created: [], skipped };
	}

	// Single roundtrip to find existing SKUs.
	const candidateSkus = candidates.map((c) => c.sku);
	const existingRows = await db('parts')
		.whereIn(db.raw('UPPER(sku)'), candidateSkus)
		.select('sku');
	const existingSet = new Set(existingRows.map((r) => String(r.sku).toUpperCase()));

	const toInsert = [];
	for (const c of candidates) {
		if (existingSet.has(c.sku)) {
			skipped.push({ sku: c.sku, reason: 'sku_exists' });
		} else {
			toInsert.push(c);
		}
	}

	if (toInsert.length === 0) {
		return { created: [], skipped };
	}

	// Resolve FK vendor/manufacturer outside the trx (each call may
	// `findOrCreate` against the master tables). Then insert all parts in
	// one transaction so a failure midway rolls everything back.
	//
	// FN-1474: also resolve `barcode` per row before the trx using the same
	// generator + retry that `createPart()` uses. `isBarcodeTaken` only sees
	// committed rows, so we track values minted within this batch in
	// `mintedInBatch` to keep them globally unique across the request.
	const mintedInBatch = new Set();
	const checkBarcodeExists = async (candidate) => {
		if (mintedInBatch.has(candidate)) return true;
		return isBarcodeTaken(candidate);
	};
	const prepared = [];
	for (const c of toInsert) {
		const mvPatch = await resolveManufacturerVendor(c);
		const imagePatch = resolveImageR2Patch(c);
		const barcode = await resolveBarcodeForCreate(c.barcode, checkBarcodeExists);
		mintedInBatch.add(barcode);
		prepared.push({
			sku: c.sku,
			name: c.name,
			category: normalizeCategory(c.category),
			description: c.description,
			unit_cost: c.unit_cost || 0,
			unit_price: c.unit_price || 0,
			quantity_on_hand: c.quantity_on_hand || 0,
			reorder_level: c.reorder_level || 5,
			supplier_id: c.supplier_id,
			status: 'ACTIVE',
			barcode,
			...mvPatch,
			...imagePatch,
		});
	}

	const created = await db.transaction(async (trx) => {
		const inserted = [];
		for (const row of prepared) {
			const [partRow] = await trx('parts').insert(row).returning('*');
			inserted.push(partRow);
		}
		return inserted;
	});

	dtLogger.info('parts_bulk_created', {
		created: created.length,
		skipped: skipped.length,
	});

	return { created, skipped };
}

/**
 * FN-1110: Find possible duplicate parts via pg_trgm fuzzy match.
 *
 * Computes a weighted blended similarity (name 0.5 + sku 0.3 + manufacturer 0.2)
 * across whichever of the three fields the caller provided. Empty fields
 * contribute ~0; weights are NOT renormalized, so a single-field query caps
 * at the field's own weight. Threshold of 0.85 is applied to the BEST
 * individual component score so a strong name match alone is enough to surface
 * a row, while the returned `similarity` is the blended score used for ranking.
 *
 * Returns rows sorted by blended similarity desc.
 */
async function findDuplicateCandidates({ name = '', sku = '', manufacturer = '', limit = 5 } = {}) {
	const nameTerm = String(name || '').trim();
	const skuTerm = String(sku || '').trim();
	const mfgTerm = String(manufacturer || '').trim();

	if (!nameTerm && !skuTerm && !mfgTerm) {
		return [];
	}

	const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 25);
	const threshold = 0.85;

	const sql = `
		WITH scored AS (
			SELECT
				p.id,
				p.name,
				p.sku,
				p.manufacturer,
				similarity(COALESCE(p.name, ''), ?) AS name_sim,
				similarity(COALESCE(p.sku, ''), ?) AS sku_sim,
				similarity(COALESCE(p.manufacturer, ''), ?) AS mfg_sim
			FROM parts p
		)
		SELECT
			id,
			name,
			sku,
			manufacturer,
			(0.5 * name_sim) + (0.3 * sku_sim) + (0.2 * mfg_sim) AS similarity
		FROM scored
		WHERE GREATEST(name_sim, sku_sim, mfg_sim) >= ?
		ORDER BY similarity DESC, sku ASC
		LIMIT ?
	`;

	try {
		const result = await db.raw(sql, [nameTerm, skuTerm, mfgTerm, threshold, safeLimit]);
		const rows = result.rows || result;
		return rows.map(r => ({
			id: r.id,
			name: r.name,
			sku: r.sku,
			manufacturer: r.manufacturer,
			similarity: Number(parseFloat(r.similarity).toFixed(4))
		}));
	} catch (error) {
		dtLogger.error('parts_duplicate_check_failed', {
			error: error.message,
			hasName: !!nameTerm,
			hasSku: !!skuTerm,
			hasManufacturer: !!mfgTerm
		});
		throw error;
	}
}

/**
 * Get part categories (distinct)
 */
async function getCategories() {
	try {
		const cols = await db('parts').columnInfo();
		let query = db('parts');
		if (cols.status) {
			query = query.whereRaw('LOWER(status) = ?', ['active']);
		} else {
			query = query.where('is_active', true);
		}
		const categories = await query
			.distinct('category')
			.orderBy('category', 'asc');

		return categories.map(c => c.category).filter(c => c);
	} catch (error) {
		dtLogger.error('categories_retrieval_failed', { error: error.message });
		throw error;
	}
}

/**
 * Get all manufacturers from active parts
 */
async function getManufacturers() {
	try {
		const cols = await db('parts').columnInfo();
		let query = db('parts');
		if (cols.status) {
			query = query.whereRaw('LOWER(status) = ?', ['active']);
		} else {
			query = query.where('is_active', true);
		}
		const manufacturers = await query
			.distinct('manufacturer')
			.orderBy('manufacturer', 'asc');

		return manufacturers.map(m => m.manufacturer).filter(m => m);
	} catch (error) {
		dtLogger.error('manufacturers_retrieval_failed', { error: error.message });
		throw error;
	}
}

/**
 * FN-1566: Reconcile a part's `default_cost` and/or `default_retail_price`
 * after a receiving-line edit. Scoped narrowly so the warehouse-receiving
 * "update default cost?" prompt cannot accidentally clobber other fields.
 * Emits a `parts_cost_changed` audit log via dtLogger with old/new values,
 * partId, performedBy, and the originating ticketId (if the FE supplied it).
 */
async function updatePartCostDefaults(id, patch = {}, audit = {}) {
	if (!id) {
		throw new ValidationError('id is required', 'id');
	}

	const update = {};
	if (Object.prototype.hasOwnProperty.call(patch, 'default_cost')) {
		update.default_cost = validateCostValue(patch.default_cost, 'default_cost');
	}
	if (Object.prototype.hasOwnProperty.call(patch, 'default_retail_price')) {
		update.default_retail_price = validateCostValue(patch.default_retail_price, 'default_retail_price');
	}
	if (Object.keys(update).length === 0) {
		throw new ValidationError(
			'At least one of default_cost or default_retail_price is required',
			'body'
		);
	}

	const existing = await db('parts').where({ id }).first();
	if (!existing) {
		const err = new Error(`Part ${id} not found`);
		err.statusCode = 404;
		throw err;
	}

	const updated = (await db('parts').where({ id }).update(update).returning('*'))[0];

	const changes = {};
	for (const field of Object.keys(update)) {
		const before = existing[field] !== null && existing[field] !== undefined
			? Number(existing[field])
			: null;
		const after = update[field];
		changes[field] = { from: before, to: after };
	}

	dtLogger.info('parts_cost_changed', {
		partId: id,
		sku: updated.sku,
		performedBy: audit.performedBy || null,
		ticketId: audit.ticketId || null,
		changes
	});

	return updated;
}

module.exports = {
	getParts,
	getPartById,
	getPartBySku,
	createPart,
	updatePart,
	updatePartCostDefaults,
	deletePart,
	deactivatePart,
	bulkCreateParts,
	findDuplicateCandidates,
	getCategories,
	getManufacturers,
	resolveManufacturerVendor,
	resolveImageR2Patch,
};
