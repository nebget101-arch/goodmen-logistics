/**
 * Quick Add Part — FN-1091 / FN-1092
 *
 * Backfill `manufacturers` / `vendors` master rows from the existing
 * free-text columns on `parts`, then point each part at the matching
 * master row via the new BIGINT FKs.
 *
 * Normalization (must match backend autocomplete): lowercase,
 * trim outer whitespace, collapse internal runs of whitespace.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
	const hasParts = await knex.schema.hasTable('parts');
	const hasManufacturers = await knex.schema.hasTable('manufacturers');
	const hasVendors = await knex.schema.hasTable('vendors');
	if (!hasParts || !hasManufacturers || !hasVendors) return;

	const hasManufacturerCol = await knex.schema.hasColumn('parts', 'manufacturer');
	const hasVendorCol = await knex.schema.hasColumn('parts', 'preferred_vendor_name');
	const hasManufacturerId = await knex.schema.hasColumn('parts', 'manufacturer_id');
	const hasVendorId = await knex.schema.hasColumn('parts', 'vendor_id');

	if (hasManufacturerCol && hasManufacturerId) {
		// Insert distinct manufacturers (case-insensitive, whitespace-collapsed).
		// MIN(name) picks a stable display value when multiple casings collide.
		await knex.raw(`
			INSERT INTO manufacturers (name, normalized_name, created_at, updated_at)
			SELECT
				MIN(parts.manufacturer) AS name,
				LOWER(BTRIM(REGEXP_REPLACE(parts.manufacturer, '\\s+', ' ', 'g'))) AS normalized_name,
				NOW(),
				NOW()
			FROM parts
			WHERE parts.manufacturer IS NOT NULL
				AND BTRIM(parts.manufacturer) <> ''
			GROUP BY LOWER(BTRIM(REGEXP_REPLACE(parts.manufacturer, '\\s+', ' ', 'g')))
			ON CONFLICT (normalized_name) DO NOTHING
		`);

		await knex.raw(`
			UPDATE parts
			SET manufacturer_id = m.id
			FROM manufacturers m
			WHERE parts.manufacturer IS NOT NULL
				AND BTRIM(parts.manufacturer) <> ''
				AND parts.manufacturer_id IS NULL
				AND m.normalized_name = LOWER(BTRIM(REGEXP_REPLACE(parts.manufacturer, '\\s+', ' ', 'g')))
		`);
	}

	if (hasVendorCol && hasVendorId) {
		await knex.raw(`
			INSERT INTO vendors (name, normalized_name, created_at, updated_at)
			SELECT
				MIN(parts.preferred_vendor_name) AS name,
				LOWER(BTRIM(REGEXP_REPLACE(parts.preferred_vendor_name, '\\s+', ' ', 'g'))) AS normalized_name,
				NOW(),
				NOW()
			FROM parts
			WHERE parts.preferred_vendor_name IS NOT NULL
				AND BTRIM(parts.preferred_vendor_name) <> ''
			GROUP BY LOWER(BTRIM(REGEXP_REPLACE(parts.preferred_vendor_name, '\\s+', ' ', 'g')))
			ON CONFLICT (normalized_name) DO NOTHING
		`);

		await knex.raw(`
			UPDATE parts
			SET vendor_id = v.id
			FROM vendors v
			WHERE parts.preferred_vendor_name IS NOT NULL
				AND BTRIM(parts.preferred_vendor_name) <> ''
				AND parts.vendor_id IS NULL
				AND v.normalized_name = LOWER(BTRIM(REGEXP_REPLACE(parts.preferred_vendor_name, '\\s+', ' ', 'g')))
		`);
	}
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
	const hasParts = await knex.schema.hasTable('parts');
	if (!hasParts) return;

	const hasManufacturerId = await knex.schema.hasColumn('parts', 'manufacturer_id');
	const hasVendorId = await knex.schema.hasColumn('parts', 'vendor_id');

	if (hasManufacturerId) {
		await knex.raw('UPDATE parts SET manufacturer_id = NULL WHERE manufacturer_id IS NOT NULL');
	}
	if (hasVendorId) {
		await knex.raw('UPDATE parts SET vendor_id = NULL WHERE vendor_id IS NOT NULL');
	}

	const hasManufacturers = await knex.schema.hasTable('manufacturers');
	if (hasManufacturers) {
		await knex.raw('TRUNCATE TABLE manufacturers RESTART IDENTITY CASCADE');
	}
	const hasVendors = await knex.schema.hasTable('vendors');
	if (hasVendors) {
		await knex.raw('TRUNCATE TABLE vendors RESTART IDENTITY CASCADE');
	}
};
