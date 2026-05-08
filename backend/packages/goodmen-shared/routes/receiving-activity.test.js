'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');
const http = require('http');
const { EventEmitter } = require('node:events');

/**
 * FN-1493: Tests for the receiving activity report endpoints
 * (`GET /api/receiving/activity` and `GET /api/receiving/activity.csv`).
 *
 * Uses a knex-shaped stub (`FakeQuery`) that supports the operations the route
 * needs — including `whereIn`, `andWhere(col, op, value)`, multi-join column
 * aliasing, `raw('locations.name AS location_name')`, and a `.stream()` that
 * emits each projected row as a `data` event. We avoid relying on a real DB
 * here so the tests stay fast and deterministic.
 */

const sharedRoot = path.resolve(__dirname, '..');
const authMiddlewarePath = path.resolve(sharedRoot, 'middleware/auth-middleware.js');

require.cache[authMiddlewarePath] = {
	id: authMiddlewarePath,
	filename: authMiddlewarePath,
	loaded: true,
	exports: function authMiddlewareMock(req, _res, next) {
		req.user = {
			id: req.headers['x-mock-user'] || 'mock-user-id',
			role: req.headers['x-mock-role'] || 'admin'
		};
		next();
	}
};

class FakeQuery {
	constructor(state, table, alias) {
		this.state = state;
		this.table = table;
		this.alias = alias || table;
		this.filters = [];
		this.joins = [];
		this.orderBys = [];
		this.selectSpecs = [];
	}
	where(arg1, arg2, arg3) {
		if (typeof arg1 === 'object' && arg1 !== null) {
			for (const [col, value] of Object.entries(arg1)) {
				this.filters.push({ kind: '=', col, value });
			}
		} else if (arg3 !== undefined) {
			this.filters.push({ kind: arg2, col: arg1, value: arg3 });
		} else {
			this.filters.push({ kind: '=', col: arg1, value: arg2 });
		}
		return this;
	}
	andWhere(...args) { return this.where(...args); }
	whereIn(col, values) {
		this.filters.push({ kind: 'in', col, value: values });
		return this;
	}
	leftJoin(tableSpec, leftCol, rightCol) {
		const parts = String(tableSpec).split(/\s+as\s+/i);
		this.joins.push({
			table: parts[0].trim(),
			alias: parts[1] ? parts[1].trim() : parts[0].trim(),
			leftCol,
			rightCol,
			outer: true
		});
		return this;
	}
	join(tableSpec, leftCol, rightCol) {
		const parts = String(tableSpec).split(/\s+as\s+/i);
		this.joins.push({
			table: parts[0].trim(),
			alias: parts[1] ? parts[1].trim() : parts[0].trim(),
			leftCol,
			rightCol
		});
		return this;
	}
	select(...specs) {
		for (const s of specs) {
			this.selectSpecs.push(s);
		}
		return this;
	}
	orderBy(col, dir = 'asc') {
		this.orderBys.push({ col, dir });
		return this;
	}
	_resolveValue(combined, colSpec) {
		if (colSpec && colSpec.includes('.')) {
			const [pre, k] = colSpec.split('.');
			const ref = combined[pre];
			return ref ? ref[k] : undefined;
		}
		// Bare column name — fall back to the primary table.
		const primary = combined[this.alias] || combined[this.table];
		return primary ? primary[colSpec] : undefined;
	}
	_buildRows() {
		const base = this.state[this.table] || [];
		let rows = base.map((r) => ({ [this.alias]: r, [this.table]: r }));
		for (const j of this.joins) {
			const right = this.state[j.table] || [];
			rows = rows.flatMap((combined) => {
				const lkey = this._resolveValue(combined, j.leftCol);
				const rightKeyName = j.rightCol.includes('.') ? j.rightCol.split('.').pop() : j.rightCol;
				const matches = right.filter((rr) => rr[rightKeyName] === lkey);
				if (matches.length === 0 && j.outer) {
					return [{ ...combined, [j.alias]: null, [j.table]: null }];
				}
				return matches.map((m) => ({ ...combined, [j.alias]: m, [j.table]: m }));
			});
		}
		// Apply filters.
		rows = rows.filter((combined) => this.filters.every(({ kind, col, value }) => {
			const v = this._resolveValue(combined, col);
			if (kind === '=') return v === value;
			if (kind === '>=') return v >= value;
			if (kind === '<=') return v <= value;
			if (kind === 'in') return Array.isArray(value) && value.includes(v);
			return false;
		}));
		// Sort (single key — sufficient for our queries).
		if (this.orderBys.length > 0) {
			const { col, dir } = this.orderBys[0];
			rows = rows.slice().sort((a, b) => {
				const av = this._resolveValue(a, col);
				const bv = this._resolveValue(b, col);
				if (av == null && bv == null) return 0;
				if (av == null) return dir === 'desc' ? 1 : -1;
				if (bv == null) return dir === 'desc' ? -1 : 1;
				if (av < bv) return dir === 'desc' ? 1 : -1;
				if (av > bv) return dir === 'desc' ? -1 : 1;
				return 0;
			});
		}
		return rows;
	}
	_project(rows) {
		return rows.map((combined) => {
			const out = {};
			for (const spec of this.selectSpecs) {
				if (spec && typeof spec === 'object' && spec.__raw) {
					this._applyRawSelect(spec.__raw, combined, out);
					continue;
				}
				if (typeof spec !== 'string') continue;
				if (spec.endsWith('.*')) {
					const tbl = spec.slice(0, -2);
					const ref = combined[tbl];
					if (ref) Object.assign(out, ref);
					continue;
				}
				// `table.col as alias` or `col as alias`.
				const aliasMatch = spec.match(/^(.+?)\s+as\s+(\w+)$/i);
				if (aliasMatch) {
					out[aliasMatch[2]] = this._resolveValue(combined, aliasMatch[1].trim());
					continue;
				}
				if (spec.includes('.')) {
					const [, col] = spec.split('.');
					out[col] = this._resolveValue(combined, spec);
				} else {
					out[spec] = this._resolveValue(combined, spec);
				}
			}
			// If no select() at all, default to base table's columns.
			if (this.selectSpecs.length === 0) {
				const base = combined[this.alias] || combined[this.table];
				if (base) Object.assign(out, base);
			}
			return out;
		});
	}
	_applyRawSelect(raw, combined, out) {
		// COALESCE(<a>.<c1> || '<sep>' || <b>.<c2>, '<fallback>') AS <alias>
		let m = raw.match(/COALESCE\(\s*(\w+)\.(\w+)\s*\|\|\s*'([^']*)'\s*\|\|\s*(\w+)\.(\w+)\s*,\s*'([^']*)'\s*\)\s+AS\s+(\w+)/i);
		if (m) {
			const [, a1, c1, sep, a2, c2, fallback, outName] = m;
			const v1 = combined[a1] ? combined[a1][c1] : null;
			const v2 = combined[a2] ? combined[a2][c2] : null;
			out[outName] = (v1 == null || v2 == null) ? fallback : `${v1}${sep}${v2}`;
			return;
		}
		// COALESCE(SUM(<col>), 0) AS <alias> — handled as scalar sum across rows.
		// Not needed for activity (we sum in JS), so skipped.

		// Plain `<table>.<col> AS <alias>`.
		m = raw.match(/^\s*(\w+)\.(\w+)\s+AS\s+(\w+)\s*$/i);
		if (m) {
			const [, t, c, alias] = m;
			out[alias] = combined[t] ? combined[t][c] : null;
			return;
		}
	}
	async first() {
		return this._project(this._buildRows())[0];
	}
	then(resolve, reject) {
		try {
			resolve(this._project(this._buildRows()));
		} catch (e) {
			reject(e);
		}
	}
	stream() {
		const emitter = new EventEmitter();
		const rows = this._project(this._buildRows());
		queueMicrotask(() => {
			for (const row of rows) {
				emitter.emit('data', row);
			}
			emitter.emit('end');
		});
		return emitter;
	}
}

function makeKnex(state) {
	function knex(tableSpec) {
		const parts = String(tableSpec).split(/\s+as\s+/i);
		return new FakeQuery(state, parts[0].trim(), parts[1] ? parts[1].trim() : null);
	}
	knex.raw = (sql) => ({ __raw: sql });
	return knex;
}

function buildApp(state) {
	const shared = require('../index');
	shared.setDatabase({
		pool: null,
		query: async () => ({ rows: [] }),
		getClient: async () => null,
		knex: makeKnex(state)
	});
	delete require.cache[require.resolve('./receiving')];
	const router = require('./receiving');
	const app = express();
	app.use(express.json());
	app.use('/api/receiving', router);
	return app;
}

function startServer(app) {
	return new Promise((resolve) => {
		const server = app.listen(0, '127.0.0.1', () => resolve(server));
	});
}

function request(server, { method, path: reqPath, headers }) {
	return new Promise((resolve, reject) => {
		const { port } = server.address();
		const req = http.request({
			hostname: '127.0.0.1',
			port,
			path: reqPath,
			method,
			headers: { 'Content-Type': 'application/json', ...(headers || {}) }
		}, (res) => {
			const chunks = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				const ct = res.headers['content-type'] || '';
				let parsed = text;
				if (ct.includes('application/json')) {
					try { parsed = text ? JSON.parse(text) : null; } catch (_e) { /* leave as text */ }
				}
				resolve({ status: res.statusCode, headers: res.headers, body: parsed });
			});
		});
		req.on('error', reject);
		req.end();
	});
}

const SAMPLE_USERS = [
	{ id: 'u-alice', first_name: 'Alice', last_name: 'Smith' },
	{ id: 'u-bob', first_name: 'Bob', last_name: 'Jones' }
];

const SAMPLE_LOCATIONS = [
	{ id: 'loc-1', name: 'Main DC' },
	{ id: 'loc-2', name: 'East, Hub' } // comma in name to exercise CSV escaping
];

const SAMPLE_PARTS = [
	{ id: 'p1', sku: 'SKU-A', name: 'Brake "Pad"', uom: 'EA', default_cost: 10 }, // quotes in name
	{ id: 'p2', sku: 'SKU-B', name: 'Filter', uom: 'EA', default_cost: 5 }
];

function buildSampleState() {
	return {
		users: SAMPLE_USERS.map((u) => ({ ...u })),
		locations: SAMPLE_LOCATIONS.map((l) => ({ ...l })),
		parts: SAMPLE_PARTS.map((p) => ({ ...p })),
		receiving_tickets: [
			// Two POSTED tickets at loc-1 by Alice (Acme), one yesterday and one today
			{ id: 't-1', location_id: 'loc-1', status: 'POSTED', vendor_name: 'Acme', reference_number: 'PO-1', ticket_number: 'RCV-1', posted_by: 'u-alice', posted_at: new Date('2026-05-06T10:00:00Z') },
			{ id: 't-2', location_id: 'loc-1', status: 'POSTED', vendor_name: 'Acme', reference_number: 'PO-2', ticket_number: 'RCV-2', posted_by: 'u-alice', posted_at: new Date('2026-05-07T10:00:00Z') },
			// One POSTED ticket at loc-1 by Bob (Globex)
			{ id: 't-3', location_id: 'loc-1', status: 'POSTED', vendor_name: 'Globex, Inc.', reference_number: 'PO-3', ticket_number: 'RCV-3', posted_by: 'u-bob', posted_at: new Date('2026-05-07T11:00:00Z') },
			// One DRAFT ticket — must be excluded
			{ id: 't-draft', location_id: 'loc-1', status: 'DRAFT', vendor_name: 'Acme', reference_number: 'PO-D', ticket_number: 'RCV-D', posted_by: null, posted_at: null },
			// One POSTED ticket at a different location — excluded when locationId=loc-1
			{ id: 't-other-loc', location_id: 'loc-2', status: 'POSTED', vendor_name: 'Acme', reference_number: 'PO-4', ticket_number: 'RCV-4', posted_by: 'u-alice', posted_at: new Date('2026-05-07T12:00:00Z') }
		],
		receiving_ticket_lines: [
			// t-1: 2 lines
			{ id: 'l1', ticket_id: 't-1', part_id: 'p1', qty_received: 5, unit_cost: 10 },
			{ id: 'l2', ticket_id: 't-1', part_id: 'p2', qty_received: 3, unit_cost: 5 },
			// t-2: 1 line
			{ id: 'l3', ticket_id: 't-2', part_id: 'p1', qty_received: 4, unit_cost: 12 },
			// t-3: 1 line
			{ id: 'l4', ticket_id: 't-3', part_id: 'p2', qty_received: 7, unit_cost: 6 },
			// t-other-loc: 1 line
			{ id: 'l5', ticket_id: 't-other-loc', part_id: 'p1', qty_received: 99, unit_cost: 99 }
		]
	};
}

describe('GET /api/receiving/activity', () => {
	let state;
	let server;

	before(async () => {
		state = buildSampleState();
		const app = buildApp(state);
		server = await startServer(app);
	});

	after(() => { if (server) server.close(); });

	beforeEach(() => {
		const fresh = buildSampleState();
		state.users = fresh.users;
		state.locations = fresh.locations;
		state.parts = fresh.parts;
		state.receiving_tickets = fresh.receiving_tickets;
		state.receiving_ticket_lines = fresh.receiving_ticket_lines;
	});

	it('returns POSTED tickets at the location with posted_by_name + location_name resolved', async () => {
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity?locationId=loc-1' });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.success, true);
		assert.strictEqual(res.body.total, 3);
		assert.strictEqual(res.headers['x-total-count'], '3');
		assert.strictEqual(res.body.data.length, 3);
		// Most recent first
		assert.strictEqual(res.body.data[0].id, 't-3');
		assert.strictEqual(res.body.data[0].posted_by_name, 'Bob Jones');
		assert.strictEqual(res.body.data[0].location_name, 'Main DC');
		// Lines are populated for the page
		const t1 = res.body.data.find((t) => t.id === 't-1');
		assert.strictEqual(t1.lines.length, 2);
		const skus = t1.lines.map((l) => l.sku).sort();
		assert.deepStrictEqual(skus, ['SKU-A', 'SKU-B']);
	});

	it('excludes DRAFT tickets and tickets at other locations', async () => {
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity?locationId=loc-1' });
		const ids = res.body.data.map((t) => t.id);
		assert.ok(!ids.includes('t-draft'), 'DRAFT must be excluded');
		assert.ok(!ids.includes('t-other-loc'), 'other-location ticket must be excluded');
	});

	it('filters compose: locationId + userId returns only that user\'s tickets', async () => {
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity?locationId=loc-1&userId=u-bob' });
		assert.strictEqual(res.body.total, 1);
		assert.strictEqual(res.body.data.length, 1);
		assert.strictEqual(res.body.data[0].posted_by, 'u-bob');
	});

	it('filters compose: locationId + vendor returns only that vendor\'s tickets', async () => {
		const res = await request(server, { method: 'GET', path: `/api/receiving/activity?locationId=loc-1&vendor=${encodeURIComponent('Globex, Inc.')}` });
		assert.strictEqual(res.body.total, 1);
		assert.strictEqual(res.body.data[0].id, 't-3');
	});

	it('filters compose: from + to (inclusive) restricts the date window', async () => {
		// Only 2026-05-07
		const res = await request(server, {
			method: 'GET',
			path: '/api/receiving/activity?locationId=loc-1&from=2026-05-07T00:00:00.000Z&to=2026-05-07T23:59:59.999Z'
		});
		const ids = res.body.data.map((t) => t.id).sort();
		assert.deepStrictEqual(ids, ['t-2', 't-3']);
	});

	it('aggregations match SUM/COUNT across the full filtered set', async () => {
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity?locationId=loc-1' });
		// At loc-1, POSTED only: lines belong to t-1 (5+3), t-2 (4), t-3 (7) = 4 lines, totalParts=19, totalCost=5*10+3*5+4*12+7*6=50+15+48+42=155
		assert.strictEqual(res.body.totalLines, 4);
		assert.strictEqual(res.body.totalParts, 19);
		assert.strictEqual(res.body.totalCost, 155);
		// byUser
		const alice = res.body.byUser.find((u) => u.userId === 'u-alice');
		const bob = res.body.byUser.find((u) => u.userId === 'u-bob');
		assert.strictEqual(alice.count, 2);
		assert.strictEqual(alice.totalParts, 12); // t-1: 8 + t-2: 4
		assert.strictEqual(bob.count, 1);
		assert.strictEqual(bob.totalParts, 7);
		// byVendor
		const acme = res.body.byVendor.find((v) => v.name === 'Acme');
		const globex = res.body.byVendor.find((v) => v.name === 'Globex, Inc.');
		assert.strictEqual(acme.count, 2);
		assert.strictEqual(globex.count, 1);
	});

	it('aggregations are computed across the full filtered set, not just the page', async () => {
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity?locationId=loc-1&page=1&pageSize=1' });
		assert.strictEqual(res.body.data.length, 1);
		assert.strictEqual(res.body.total, 3);
		assert.strictEqual(res.headers['x-total-count'], '3');
		// Aggregations still match the unpaged set
		assert.strictEqual(res.body.totalLines, 4);
		assert.strictEqual(res.body.totalParts, 19);
		assert.strictEqual(res.body.totalCost, 155);
	});

	it('paginates: page=2&pageSize=1 returns the second-most-recent ticket', async () => {
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity?locationId=loc-1&page=2&pageSize=1' });
		assert.strictEqual(res.body.page, 2);
		assert.strictEqual(res.body.pageSize, 1);
		assert.strictEqual(res.body.data.length, 1);
		// Second by posted_at desc would be t-2
		assert.strictEqual(res.body.data[0].id, 't-2');
	});

	it('returns empty data and zero aggregations when filters match nothing', async () => {
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity?locationId=loc-1&userId=u-nobody' });
		assert.strictEqual(res.body.total, 0);
		assert.strictEqual(res.body.data.length, 0);
		assert.strictEqual(res.body.totalParts, 0);
		assert.strictEqual(res.body.totalLines, 0);
		assert.strictEqual(res.body.totalCost, 0);
		assert.deepStrictEqual(res.body.byUser, []);
		assert.deepStrictEqual(res.body.byVendor, []);
	});
});

describe('GET /api/receiving/activity.csv', () => {
	let state;
	let server;

	before(async () => {
		state = buildSampleState();
		const app = buildApp(state);
		server = await startServer(app);
	});

	after(() => { if (server) server.close(); });

	beforeEach(() => {
		const fresh = buildSampleState();
		state.users = fresh.users;
		state.locations = fresh.locations;
		state.parts = fresh.parts;
		state.receiving_tickets = fresh.receiving_tickets;
		state.receiving_ticket_lines = fresh.receiving_ticket_lines;
	});

	it('streams CSV with one row per line item, correct headers, and content-type', async () => {
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity.csv?locationId=loc-1' });
		assert.strictEqual(res.status, 200);
		assert.match(res.headers['content-type'], /^text\/csv/);
		assert.match(res.headers['content-disposition'], /receiving-activity\.csv/);
		const lines = res.body.split('\n').filter((l) => l.length > 0);
		// 1 header + 4 line items at loc-1
		assert.strictEqual(lines.length, 5);
		assert.strictEqual(lines[0], 'ticket_number,posted_at,location_name,vendor_name,reference_number,sku,part_name,qty_received,unit_cost,posted_by_name');
	});

	it('escapes commas and quotes correctly', async () => {
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity.csv?locationId=loc-2' });
		assert.strictEqual(res.status, 200);
		const lines = res.body.split('\n').filter((l) => l.length > 0);
		// loc-2 has 1 line item (l5) — vendor "Acme", location "East, Hub", part name "Brake \"Pad\""
		const dataRow = lines[1];
		// location_name "East, Hub" has a comma — must be wrapped in quotes
		assert.ok(dataRow.includes('"East, Hub"'), `expected quoted location_name; got: ${dataRow}`);
		// part name 'Brake "Pad"' has quotes — quotes doubled and wrapped
		assert.ok(dataRow.includes('"Brake ""Pad"""'), `expected escaped quotes in part_name; got: ${dataRow}`);
	});

	it('only includes POSTED ticket lines (excludes DRAFT)', async () => {
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity.csv?locationId=loc-1' });
		const lines = res.body.split('\n').filter((l) => l.length > 0);
		// header + 4 lines (no DRAFT lines exist in sample, but the filter must still hold)
		assert.strictEqual(lines.length, 5);
		assert.ok(!res.body.includes('RCV-D'));
	});

	it('respects userId filter', async () => {
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity.csv?locationId=loc-1&userId=u-bob' });
		const lines = res.body.split('\n').filter((l) => l.length > 0);
		// header + 1 line (l4 belongs to t-3 which is u-bob's)
		assert.strictEqual(lines.length, 2);
		assert.ok(lines[1].includes('Bob Jones'));
	});

	it('respects from/to date filters', async () => {
		const res = await request(server, {
			method: 'GET',
			path: '/api/receiving/activity.csv?locationId=loc-1&from=2026-05-07T00:00:00.000Z&to=2026-05-07T23:59:59.999Z'
		});
		const lines = res.body.split('\n').filter((l) => l.length > 0);
		// Only t-2 (1 line) and t-3 (1 line) match the date filter
		assert.strictEqual(lines.length, 3);
	});

	it('streams without buffering — handles many rows', async () => {
		// Seed many synthetic line items and verify each comes through.
		state.parts.push({ id: 'pX', sku: 'SKU-X', name: 'Big', uom: 'EA', default_cost: 1 });
		const N = 1500;
		state.receiving_tickets.push({
			id: 't-big', location_id: 'loc-1', status: 'POSTED',
			vendor_name: 'BigVendor', reference_number: 'PO-BIG', ticket_number: 'RCV-BIG',
			posted_by: 'u-alice', posted_at: new Date('2026-05-08T10:00:00Z')
		});
		for (let i = 0; i < N; i += 1) {
			state.receiving_ticket_lines.push({
				id: `lbig-${i}`, ticket_id: 't-big', part_id: 'pX', qty_received: 1, unit_cost: 1
			});
		}
		const res = await request(server, { method: 'GET', path: '/api/receiving/activity.csv?locationId=loc-1' });
		assert.strictEqual(res.status, 200);
		const lines = res.body.split('\n').filter((l) => l.length > 0);
		// header + 4 sample lines + N synthetic lines
		assert.strictEqual(lines.length, 1 + 4 + N);
	});
});
