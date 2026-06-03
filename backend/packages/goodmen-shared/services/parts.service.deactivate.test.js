'use strict';

/**
 * FN-1555: Tests for deactivatePart (soft-delete).
 *
 * Hermetic — uses an in-memory mock knex via the shared db bridge. The mock
 * supports the few chain shapes deactivatePart uses:
 *   db('parts').where({id}).first()
 *   db('parts').columnInfo()
 *   db('parts').where({id}).update({...}).returning('*')
 *   db.fn.now()
 *
 * Run with: cd backend/packages/goodmen-shared && node --test services/parts.service.deactivate.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const dbBridge = require('../internal/db');

function makeMockDb({ rows = [], columns = {} } = {}) {
	function tableBuilder() {
		let whereCriteria = null;
		const builder = {
			where(criteria) {
				whereCriteria = criteria;
				return this;
			},
			async first() {
				if (!whereCriteria) return rows[0] || null;
				return rows.find((r) =>
					Object.keys(whereCriteria).every((k) => r[k] === whereCriteria[k])
				) || null;
			},
			async columnInfo() {
				return columns;
			},
			update(patch) {
				const matches = rows.filter((r) =>
					Object.keys(whereCriteria || {}).every((k) => r[k] === whereCriteria[k])
				);
				matches.forEach((r) => Object.assign(r, patch));
				return {
					async returning() {
						return matches.map((r) => ({ ...r }));
					}
				};
			}
		};
		return builder;
	}

	function db(name) {
		if (name !== 'parts') throw new Error(`Unexpected table: ${name}`);
		return tableBuilder();
	}
	db.fn = { now: () => '__NOW__' };
	return db;
}

test('deactivatePart — status-column schema sets status=INACTIVE', async () => {
	const rows = [
		{ id: 'p1', sku: 'BRK-001', status: 'ACTIVE', updated_at: 'old' }
	];
	const db = makeMockDb({
		rows,
		columns: { id: {}, sku: {}, status: {}, updated_at: {} }
	});
	delete require.cache[require.resolve('./parts.service')];
	dbBridge.setDatabase({ knex: db });
	const partsService = require('./parts.service');

	const updated = await partsService.deactivatePart('p1');
	assert.equal(updated.status, 'INACTIVE');
	assert.equal(updated.updated_at, '__NOW__');
	assert.equal(rows[0].status, 'INACTIVE');
});

test('deactivatePart — is_active-column fallback sets is_active=false', async () => {
	const rows = [
		{ id: 'p2', sku: 'OIL-002', is_active: true }
	];
	const db = makeMockDb({
		rows,
		columns: { id: {}, sku: {}, is_active: {} }
	});
	delete require.cache[require.resolve('./parts.service')];
	dbBridge.setDatabase({ knex: db });
	const partsService = require('./parts.service');

	const updated = await partsService.deactivatePart('p2');
	assert.equal(updated.is_active, false);
	assert.equal(rows[0].is_active, false);
});

test('deactivatePart — throws "not found" when part missing', async () => {
	const db = makeMockDb({
		rows: [],
		columns: { id: {}, status: {} }
	});
	delete require.cache[require.resolve('./parts.service')];
	dbBridge.setDatabase({ knex: db });
	const partsService = require('./parts.service');

	await assert.rejects(
		() => partsService.deactivatePart('missing-id'),
		/not found/i
	);
});

test('deactivatePart — throws when neither status nor is_active column exists', async () => {
	const db = makeMockDb({
		rows: [{ id: 'p3', sku: 'X' }],
		columns: { id: {}, sku: {} }
	});
	delete require.cache[require.resolve('./parts.service')];
	dbBridge.setDatabase({ knex: db });
	const partsService = require('./parts.service');

	await assert.rejects(
		() => partsService.deactivatePart('p3'),
		/missing both status and is_active/
	);
});
