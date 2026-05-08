'use strict';

/**
 * FN-1485: Tests for the recent-at-location and common-at-location parts
 * endpoints used by the warehouse-receiving quick-add panel (FN-1479).
 *
 * Uses a Proxy-based fake `knex` injected via setDatabase() so we don't need
 * a real postgres. The route builds a sub-query and joins parts/inventory;
 * we don't model the SQL execution — we just record which fake rows the
 * outer awaitable chain should resolve to.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

const VALID_LOCATION = '11111111-1111-4111-8111-111111111111';

function makeKnex(state) {
	function makeChain() {
		const handler = {
			get(_target, prop) {
				if (prop === 'then') {
					return (resolve, reject) =>
						Promise.resolve(state.outerRows || []).then(resolve, reject);
				}
				if (prop === 'catch' || prop === 'finally') {
					return undefined;
				}
				// Every other property — select, max, sum, where, andWhere, groupBy,
				// orderBy, limit, innerJoin, leftJoin, modify, as — returns a callable
				// that returns the same chain (so the chain stays fluent).
				return () => proxy;
			}
		};
		const proxy = new Proxy(function () {}, handler);
		return proxy;
	}

	function knexFn(_tableSpec) {
		state.lastTable = _tableSpec;
		return makeChain();
	}
	knexFn.from = function () {
		return makeChain();
	};
	knexFn.raw = function (sql, bindings) {
		return { __raw: sql, bindings };
	};
	knexFn.fn = { now: () => ({ __raw: 'NOW()' }) };
	return knexFn;
}

function buildApp(state) {
	const shared = require('../index');
	shared.setDatabase({
		pool: null,
		query: async () => ({ rows: [] }),
		getClient: async () => null,
		knex: makeKnex(state)
	});

	// Force a fresh require so the route picks up the latest stub.
	const routePath = require.resolve('./parts');
	delete require.cache[routePath];
	const router = require('./parts');

	const app = express();
	app.use(express.json());
	app.use('/api/parts', router);
	return app;
}

function startServer(app) {
	return new Promise((resolve) => {
		const server = app.listen(0, '127.0.0.1', () => resolve(server));
	});
}

function request(server, { method, path }) {
	return new Promise((resolve, reject) => {
		const { port } = server.address();
		const req = http.request(
			{
				hostname: '127.0.0.1',
				port,
				path,
				method,
				headers: { 'Content-Type': 'application/json' }
			},
			(res) => {
				let data = '';
				res.on('data', (chunk) => {
					data += chunk;
				});
				res.on('end', () => {
					let parsed = null;
					try {
						parsed = data ? JSON.parse(data) : null;
					} catch (_err) {
						parsed = data;
					}
					resolve({ status: res.statusCode, body: parsed });
				});
			}
		);
		req.on('error', reject);
		req.end();
	});
}

describe('parts quick-add endpoints (FN-1485)', () => {
	let state;
	let server;

	before(async () => {
		state = { outerRows: [] };
		const app = buildApp(state);
		server = await startServer(app);
	});

	after(() => {
		if (server) server.close();
	});

	beforeEach(() => {
		state.outerRows = [];
	});

	describe('GET /api/parts/recent-at-location/:locationId', () => {
		it('returns 400 when locationId is not a UUID', async () => {
			const res = await request(server, {
				method: 'GET',
				path: '/api/parts/recent-at-location/not-a-uuid'
			});
			assert.strictEqual(res.status, 400);
			assert.match(res.body.error || '', /UUID/);
		});

		it('returns { data: [] } when no transactions exist', async () => {
			state.outerRows = [];
			const res = await request(server, {
				method: 'GET',
				path: `/api/parts/recent-at-location/${VALID_LOCATION}`
			});
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.success, true);
			assert.deepStrictEqual(res.body.data, []);
		});

		it('returns rows with the documented shape', async () => {
			state.outerRows = [
				{
					id: '22222222-2222-4222-8222-222222222222',
					sku: 'OIL-001',
					name: 'Cummins Oil Filter',
					default_cost: '12.50',
					on_hand_qty: 8,
					last_received_at: '2026-05-01T10:00:00.000Z'
				},
				{
					id: '33333333-3333-4333-8333-333333333333',
					sku: 'AIR-002',
					name: 'Air Filter',
					default_cost: '18.00',
					on_hand_qty: 0,
					last_received_at: '2026-04-28T14:00:00.000Z'
				}
			];
			const res = await request(server, {
				method: 'GET',
				path: `/api/parts/recent-at-location/${VALID_LOCATION}?limit=5`
			});
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.success, true);
			assert.strictEqual(res.body.data.length, 2);
			const first = res.body.data[0];
			for (const key of ['id', 'sku', 'name', 'default_cost', 'on_hand_qty', 'last_received_at']) {
				assert.ok(Object.prototype.hasOwnProperty.call(first, key), `missing key ${key}`);
			}
		});
	});

	describe('GET /api/parts/common-at-location/:locationId', () => {
		it('returns 400 when locationId is not a UUID', async () => {
			const res = await request(server, {
				method: 'GET',
				path: '/api/parts/common-at-location/not-a-uuid'
			});
			assert.strictEqual(res.status, 400);
			assert.match(res.body.error || '', /UUID/);
		});

		it('returns { data: [] } when no transactions exist', async () => {
			state.outerRows = [];
			const res = await request(server, {
				method: 'GET',
				path: `/api/parts/common-at-location/${VALID_LOCATION}`
			});
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.success, true);
			assert.deepStrictEqual(res.body.data, []);
		});

		it('returns rows with total_received_qty', async () => {
			state.outerRows = [
				{
					id: '44444444-4444-4444-8444-444444444444',
					sku: 'BRK-PAD-01',
					name: 'Brake Pad Set',
					default_cost: '85.00',
					on_hand_qty: 24,
					total_received_qty: 120
				}
			];
			const res = await request(server, {
				method: 'GET',
				path: `/api/parts/common-at-location/${VALID_LOCATION}?days=30&limit=10`
			});
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.success, true);
			assert.strictEqual(res.body.data.length, 1);
			assert.strictEqual(res.body.data[0].total_received_qty, 120);
		});

		it('clamps out-of-range query params without 400', async () => {
			state.outerRows = [];
			// days=9999 → clamps to 365; limit=-5 → clamps to 1
			const res = await request(server, {
				method: 'GET',
				path: `/api/parts/common-at-location/${VALID_LOCATION}?days=9999&limit=-5`
			});
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.success, true);
		});
	});
});
