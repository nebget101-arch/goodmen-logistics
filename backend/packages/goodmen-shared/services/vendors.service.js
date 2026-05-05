'use strict';

const db = require('../internal/db').knex;
const dtLogger = require('../utils/logger');
const { normalizeName } = require('../utils/normalize-name');

const TABLE = 'vendors';

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
		throw new Error(`Vendor ${id} not found`);
	}
	return row;
}

async function search({ q, limit } = {}) {
	const max = Math.min(Math.max(Number(limit) || 10, 1), 50);
	const norm = normalizeName(q);
	if (!norm) return [];

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

async function create({ name, contact_email, contact_phone }) {
	if (!name || !String(name).trim()) {
		throw new Error('name is required');
	}
	const trimmed = String(name).trim();
	const norm = normalizeName(trimmed);

	const existing = await db(TABLE).where({ normalized_name: norm }).first();
	if (existing) return existing;

	const [row] = await db(TABLE)
		.insert({
			name: trimmed,
			normalized_name: norm,
			contact_email: contact_email || null,
			contact_phone: contact_phone || null,
		})
		.returning('*');
	dtLogger.info('vendor_created', { id: row.id, name: row.name });
	return row;
}

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
		if (err.code === '23505') {
			return db(TABLE).where({ normalized_name: norm }).first();
		}
		throw err;
	}
}

async function update(id, { name, contact_email, contact_phone }) {
	const existing = await db(TABLE).where({ id }).first();
	if (!existing) throw new Error(`Vendor ${id} not found`);

	const updateData = {};
	if (name !== undefined) {
		const trimmed = String(name).trim();
		if (!trimmed) throw new Error('name cannot be empty');
		updateData.name = trimmed;
		updateData.normalized_name = normalizeName(trimmed);
	}
	if (contact_email !== undefined) updateData.contact_email = contact_email || null;
	if (contact_phone !== undefined) updateData.contact_phone = contact_phone || null;
	if (Object.keys(updateData).length === 0) return existing;

	updateData.updated_at = db.fn.now();
	const [row] = await db(TABLE).where({ id }).update(updateData).returning('*');
	dtLogger.info('vendor_updated', { id: row.id });
	return row;
}

async function remove(id) {
	const existing = await db(TABLE).where({ id }).first();
	if (!existing) throw new Error(`Vendor ${id} not found`);
	await db(TABLE).where({ id }).del();
	dtLogger.info('vendor_deleted', { id });
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
