'use strict';

const db = require('../internal/db').knex;
const dtLogger = require('../utils/logger');
const { normalizeName } = require('../utils/normalize-name');

const TABLE = 'manufacturers';

async function list({ search, limit } = {}) {
	let query = db(TABLE).select('*').orderBy('name', 'asc');
	if (search) {
		const norm = normalizeName(search);
		if (norm) {
			query = query.whereILike('normalized_name', `%${norm}%`);
		}
	}
	if (limit) {
		query = query.limit(Math.min(Number(limit) || 50, 200));
	}
	return query;
}

async function getById(id) {
	const row = await db(TABLE).where({ id }).first();
	if (!row) {
		throw new Error(`Manufacturer ${id} not found`);
	}
	return row;
}

async function search({ q, limit } = {}) {
	const max = Math.min(Math.max(Number(limit) || 10, 1), 50);
	const norm = normalizeName(q);
	if (!norm) return [];

	// Prefix matches score 1.0; substring matches score 0.5 + length_ratio.
	// Pure SQL keeps the autocomplete cheap and avoids a pg_trgm dependency.
	const rows = await db(TABLE)
		.select('id', 'name', 'normalized_name')
		.select(
			db.raw(
				`CASE
					WHEN normalized_name LIKE ? THEN 1.0
					WHEN normalized_name LIKE ? THEN 0.5 + (LENGTH(?)::float / GREATEST(LENGTH(normalized_name), 1))
					ELSE 0
				END AS similarity`,
				[`${norm}%`, `%${norm}%`, norm]
			)
		)
		.whereILike('normalized_name', `%${norm}%`)
		.orderBy('similarity', 'desc')
		.orderBy('normalized_name', 'asc')
		.limit(max);

	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		normalized_name: r.normalized_name,
		similarity: Number(r.similarity),
	}));
}

async function create({ name }) {
	if (!name || !String(name).trim()) {
		throw new Error('name is required');
	}
	const trimmed = String(name).trim();
	const norm = normalizeName(trimmed);

	const existing = await db(TABLE).where({ normalized_name: norm }).first();
	if (existing) return existing;

	const [row] = await db(TABLE)
		.insert({ name: trimmed, normalized_name: norm })
		.returning('*');
	dtLogger.info('manufacturer_created', { id: row.id, name: row.name });
	return row;
}

/**
 * Lookup a master row by normalized name; create it if missing.
 * Used by the parts write path so callers can pass free-text manufacturer
 * names and get an FK back without round-tripping through the API.
 */
async function findOrCreate(name) {
	if (!name || !String(name).trim()) return null;
	const norm = normalizeName(name);
	if (!norm) return null;

	const existing = await db(TABLE).where({ normalized_name: norm }).first();
	if (existing) return existing;

	try {
		const [row] = await db(TABLE)
			.insert({ name: String(name).trim(), normalized_name: norm })
			.returning('*');
		return row;
	} catch (err) {
		// Concurrent insert — re-read.
		if (err.code === '23505') {
			return db(TABLE).where({ normalized_name: norm }).first();
		}
		throw err;
	}
}

async function update(id, { name }) {
	const existing = await db(TABLE).where({ id }).first();
	if (!existing) throw new Error(`Manufacturer ${id} not found`);

	const updateData = {};
	if (name !== undefined) {
		const trimmed = String(name).trim();
		if (!trimmed) throw new Error('name cannot be empty');
		updateData.name = trimmed;
		updateData.normalized_name = normalizeName(trimmed);
	}
	if (Object.keys(updateData).length === 0) return existing;

	updateData.updated_at = db.fn.now();
	const [row] = await db(TABLE).where({ id }).update(updateData).returning('*');
	dtLogger.info('manufacturer_updated', { id: row.id });
	return row;
}

async function remove(id) {
	const existing = await db(TABLE).where({ id }).first();
	if (!existing) throw new Error(`Manufacturer ${id} not found`);
	await db(TABLE).where({ id }).del();
	dtLogger.info('manufacturer_deleted', { id });
	return { success: true, id };
}

module.exports = {
	list,
	getById,
	search,
	create,
	findOrCreate,
	update,
	remove,
};
