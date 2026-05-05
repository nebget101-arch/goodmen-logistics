/**
 * Quick Add Part — FN-1091 / FN-1092
 *
 * Create `manufacturers` and `vendors` master tables and add nullable
 * BIGINT FK columns on `parts`. Existing free-text columns
 * (`parts.manufacturer`, `parts.preferred_vendor_name`) are preserved
 * and remain authoritative until callers migrate to the FKs.
 *
 * Backfill of master rows + parts FKs runs in the companion migration
 * `20260505100100_backfill_manufacturers_vendors.js`.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
	const hasManufacturers = await knex.schema.hasTable('manufacturers');
	if (!hasManufacturers) {
		await knex.schema.createTable('manufacturers', (table) => {
			table.bigIncrements('id').primary();
			table.string('name').notNullable().unique();
			table.string('normalized_name').notNullable();
			table.timestamps(true, true);
		});

		// Unique on normalized_name enforces case/whitespace-insensitive dedup —
		// matches the autocomplete lookup used by the backend service.
		await knex.schema.alterTable('manufacturers', (table) => {
			table.unique('normalized_name', { indexName: 'manufacturers_normalized_name_unique' });
		});
	}

	const hasVendors = await knex.schema.hasTable('vendors');
	if (!hasVendors) {
		await knex.schema.createTable('vendors', (table) => {
			table.bigIncrements('id').primary();
			table.string('name').notNullable().unique();
			table.string('normalized_name').notNullable();
			table.string('contact_email');
			table.string('contact_phone');
			table.timestamps(true, true);
		});

		await knex.schema.alterTable('vendors', (table) => {
			table.unique('normalized_name', { indexName: 'vendors_normalized_name_unique' });
		});
	}

	const hasParts = await knex.schema.hasTable('parts');
	if (!hasParts) return;

	const hasManufacturerId = await knex.schema.hasColumn('parts', 'manufacturer_id');
	const hasVendorId = await knex.schema.hasColumn('parts', 'vendor_id');

	if (!hasManufacturerId || !hasVendorId) {
		await knex.schema.alterTable('parts', (table) => {
			if (!hasManufacturerId) {
				table
					.bigInteger('manufacturer_id')
					.nullable()
					.references('id')
					.inTable('manufacturers')
					.onDelete('SET NULL');
				table.index('manufacturer_id', 'parts_manufacturer_id_index');
			}
			if (!hasVendorId) {
				table
					.bigInteger('vendor_id')
					.nullable()
					.references('id')
					.inTable('vendors')
					.onDelete('SET NULL');
				table.index('vendor_id', 'parts_vendor_id_index');
			}
		});
	}
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
	const hasParts = await knex.schema.hasTable('parts');
	if (hasParts) {
		const hasManufacturerId = await knex.schema.hasColumn('parts', 'manufacturer_id');
		const hasVendorId = await knex.schema.hasColumn('parts', 'vendor_id');
		await knex.schema.alterTable('parts', (table) => {
			if (hasManufacturerId) {
				table.dropForeign('manufacturer_id');
				table.dropIndex('manufacturer_id', 'parts_manufacturer_id_index');
				table.dropColumn('manufacturer_id');
			}
			if (hasVendorId) {
				table.dropForeign('vendor_id');
				table.dropIndex('vendor_id', 'parts_vendor_id_index');
				table.dropColumn('vendor_id');
			}
		});
	}

	await knex.schema.dropTableIfExists('vendors');
	await knex.schema.dropTableIfExists('manufacturers');
};
