/**
 * Enable pg_trgm and add GIN/trigram indexes on parts.name, parts.sku, parts.manufacturer
 * to support /api/parts/duplicate-check fuzzy matching (FN-1110).
 *
 * The IF NOT EXISTS guards make this safe to re-run on databases where the
 * extension or indexes already exist.
 */
exports.up = async function (knex) {
	await knex.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');

	await knex.raw('CREATE INDEX IF NOT EXISTS parts_name_trgm_idx ON parts USING gin (name gin_trgm_ops)');
	await knex.raw('CREATE INDEX IF NOT EXISTS parts_sku_trgm_idx ON parts USING gin (sku gin_trgm_ops)');
	await knex.raw('CREATE INDEX IF NOT EXISTS parts_manufacturer_trgm_idx ON parts USING gin (manufacturer gin_trgm_ops)');
};

exports.down = async function (knex) {
	await knex.raw('DROP INDEX IF EXISTS parts_manufacturer_trgm_idx');
	await knex.raw('DROP INDEX IF EXISTS parts_sku_trgm_idx');
	await knex.raw('DROP INDEX IF EXISTS parts_name_trgm_idx');
	// Intentionally do NOT drop the pg_trgm extension — other tables/queries
	// may rely on it.
};
