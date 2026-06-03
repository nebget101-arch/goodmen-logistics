'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

/**
 * FN-1110: Tests for GET /api/parts/duplicate-check.
 * Stubs `knex.raw()` so we don't need a real Postgres or pg_trgm — the test
 * fixture controls which "candidate rows" come back per scenario, and we
 * assert on (a) the request validation, (b) the bindings the service builds,
 * and (c) the response shape the route returns.
 */

function makeKnexStub({ rawHandler }) {
	function knex() {
		throw new Error('table-builder access not expected in duplicate-check tests');
	}
	knex.raw = rawHandler;
	return knex;
}

function buildApp({ rawHandler }) {
	// Bust the require cache so wiring db BEFORE re-require'ing the route works
	// even if another test in the same process already loaded the route.
	const sharedDbPath = require.resolve('../internal/db');
	const partsServicePath = require.resolve('../services/parts.service');
	const partsRoutePath = require.resolve('./parts');
	const manufacturersServicePath = require.resolve('../services/manufacturers.service');
	const vendorsServicePath = require.resolve('../services/vendors.service');
	for (const p of [partsRoutePath, partsServicePath, manufacturersServicePath, vendorsServicePath]) {
		delete require.cache[p];
	}
	void sharedDbPath;

	const shared = require('../index');
	shared.setDatabase({
		pool: null,
		query: async () => ({ rows: [] }),
		getClient: async () => null,
		knex: makeKnexStub({ rawHandler })
	});

	const router = require('./parts');
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 'mock-user', role: 'parts_manager' };
		next();
	});
	app.use('/api/parts', router);
	return app;
}

function startServer(app) {
	return new Promise(resolve => {
		const server = app.listen(0, () => resolve(server));
	});
}

function request(server, { method, path, headers }) {
	return new Promise((resolve, reject) => {
		const { port } = server.address();
		const req = http.request({
			hostname: '127.0.0.1',
			port,
			path,
			method,
			headers: headers || {}
		}, (res) => {
			let data = '';
			res.on('data', chunk => { data += chunk; });
			res.on('end', () => {
				let parsed = null;
				try { parsed = data ? JSON.parse(data) : null; } catch (_) { parsed = data; }
				resolve({ status: res.statusCode, body: parsed });
			});
		});
		req.on('error', reject);
		req.end();
	});
}

describe('GET /api/parts/duplicate-check (FN-1110)', () => {
	let server;
	let lastBindings = null;
	let nextRows = [];

	before(async () => {
		const rawHandler = async (_sql, bindings) => {
			lastBindings = bindings;
			return { rows: nextRows };
		};
		const app = buildApp({ rawHandler });
		server = await startServer(app);
	});

	after(() => {
		if (server) server.close();
	});

	it('returns 400 when no query terms are provided', async () => {
		const res = await request(server, { method: 'GET', path: '/api/parts/duplicate-check' });
		assert.strictEqual(res.status, 400);
		assert.match(res.body.error || '', /At least one of name, sku, or manufacturer/);
	});

	it('returns 400 when only whitespace terms are provided', async () => {
		const res = await request(server, {
			method: 'GET',
			path: '/api/parts/duplicate-check?name=%20%20&sku=&manufacturer='
		});
		assert.strictEqual(res.status, 400);
	});

	it('returns matching rows for a typo variant ("Fleetguard" vs "FleetGuard")', async () => {
		// Service stub returns one near-exact match (case difference only).
		nextRows = [
			{
				id: 'p-1',
				name: 'Oil Filter — Cummins ISX',
				sku: 'OF-ISX-12',
				manufacturer: 'FleetGuard',
				similarity: 0.9
			}
		];
		const res = await request(server, {
			method: 'GET',
			path: '/api/parts/duplicate-check?manufacturer=Fleetguard'
		});
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.success, true);
		assert.strictEqual(res.body.data.length, 1);
		assert.strictEqual(res.body.data[0].manufacturer, 'FleetGuard');
		assert.ok(res.body.data[0].similarity >= 0.85);
		// Bindings: [name='', sku='', mfg='Fleetguard', threshold=0.85, limit=5]
		assert.deepStrictEqual(lastBindings, ['', '', 'Fleetguard', 0.85, 5]);
	});

	it('returns the exact-match row for a name query', async () => {
		nextRows = [
			{
				id: 'p-2',
				name: 'Brake Pad Set',
				sku: 'BPS-100',
				manufacturer: 'Bendix',
				similarity: 1.0
			}
		];
		const res = await request(server, {
			method: 'GET',
			path: '/api/parts/duplicate-check?name=Brake%20Pad%20Set'
		});
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.data.length, 1);
		assert.strictEqual(res.body.data[0].similarity, 1);
		assert.deepStrictEqual(lastBindings, ['Brake Pad Set', '', '', 0.85, 5]);
	});

	it('returns an empty array when the database has no candidates above the threshold', async () => {
		nextRows = [];
		const res = await request(server, {
			method: 'GET',
			path: '/api/parts/duplicate-check?name=Completely%20New%20Part'
		});
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.body.data, []);
	});

	it('respects a custom limit and clamps it to a sane upper bound', async () => {
		nextRows = [];
		await request(server, {
			method: 'GET',
			path: '/api/parts/duplicate-check?name=Filter&limit=999'
		});
		// Limit clamps to 25 (service-side cap).
		assert.strictEqual(lastBindings[4], 25);

		await request(server, {
			method: 'GET',
			path: '/api/parts/duplicate-check?name=Filter&limit=0'
		});
		// limit=0 falls back to the default 5.
		assert.strictEqual(lastBindings[4], 5);
	});

	it('rounds returned similarity to 4 decimal places', async () => {
		nextRows = [
			{ id: 'p-3', name: 'X', sku: 'X-1', manufacturer: 'M', similarity: 0.876543 }
		];
		const res = await request(server, {
			method: 'GET',
			path: '/api/parts/duplicate-check?name=X'
		});
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.data[0].similarity, 0.8765);
	});
});
