'use strict';

/**
 * FN-1566: Route-level tests for
 *   PATCH /api/receiving/:ticketId/lines/:lineId
 *   PATCH /api/parts/:id
 *
 * Uses an in-memory knex stub injected via setDatabase() and a mocked
 * auth-middleware so we don't depend on a real DB or JWT. Modeled on
 * routes/__tests__/work-orders-parts-patch.test.js.
 *
 * Run: cd backend/packages/goodmen-shared
 *      node --test routes/__tests__/receiving-line-patch.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');
const http = require('http');

const sharedRoot = path.resolve(__dirname, '..', '..');
const authMiddlewarePath = path.resolve(sharedRoot, 'middleware/auth-middleware.js');

let mockUser = { id: 'user-1', role: 'parts_manager' };
require.cache[authMiddlewarePath] = {
	id: authMiddlewarePath,
	filename: authMiddlewarePath,
	loaded: true,
	exports: function authMiddlewareMock(req, _res, next) {
		req.user = { ...mockUser };
		next();
	}
};

class FakeQuery {
	constructor(state, table) {
		this.state = state;
		this.table = table;
		this.filters = [];
		this._mode = 'select';
		this._patch = null;
		this._returning = false;
	}
	where(arg, val) {
		if (typeof arg === 'object' && arg !== null) {
			Object.entries(arg).forEach(([col, value]) => this.filters.push({ col, value }));
		} else if (val !== undefined) {
			this.filters.push({ col: arg, value: val });
		}
		return this;
	}
	andWhere(...args) { return this.where(...args); }
	update(patch) { this._mode = 'update'; this._patch = patch || {}; return this; }
	returning() { this._returning = true; return this; }
	_matches(row) { return this.filters.every((f) => row[f.col] === f.value); }
	_matching() { return (this.state[this.table] || []).filter((r) => this._matches(r)); }
	_execute() {
		if (this._mode === 'select') return this._matching().map((r) => ({ ...r }));
		if (this._mode === 'update') {
			const matching = this._matching();
			const updated = [];
			for (const row of matching) {
				if (this._patch) Object.entries(this._patch).forEach(([k, v]) => { row[k] = v; });
				updated.push({ ...row });
			}
			return this._returning ? updated : matching.length;
		}
		return [];
	}
	async first() {
		const rows = this._mode === 'select' ? this._execute() : [];
		return rows.length ? rows[0] : undefined;
	}
	then(resolve, reject) {
		try { resolve(this._execute()); } catch (e) { reject(e); }
	}
}

function makeKnex(state) {
	function db(tableSpec) {
		const table = String(tableSpec).split(/\s+as\s+/i)[0].trim();
		return new FakeQuery(state, table);
	}
	db.fn = { now: () => new Date('2026-05-08T00:00:00Z') };
	db.raw = (sql) => ({ __raw: sql });
	db.transaction = async (fn) => fn(db);
	return db;
}

const TICKET_ID = 'ticket-1';
const LINE_ID = 'line-1';
const PART_ID = 'part-1';

function buildState(overrides = {}) {
	return {
		receiving_tickets: [{ id: TICKET_ID, status: 'DRAFT', ...(overrides.ticket || {}) }],
		receiving_ticket_lines: [{
			id: LINE_ID,
			ticket_id: TICKET_ID,
			part_id: PART_ID,
			qty_received: 5,
			unit_cost: 0,
			bin_location_override: null,
			...(overrides.line || {})
		}],
		parts: [{
			id: PART_ID,
			sku: 'TRN-442',
			default_cost: 0,
			default_retail_price: 0,
			...(overrides.part || {})
		}]
	};
}

let app;
let server;
let state;

before(async () => {
	state = buildState();
	const shared = require('../../index');
	shared.setDatabase({
		pool: null,
		query: async () => ({ rows: [] }),
		getClient: async () => null,
		knex: makeKnex(state)
	});

	// Force fresh require so service captures the stub knex.
	for (const rel of [
		'../../services/parts.service',
		'../../services/receiving.service',
		'../receiving',
		'../parts'
	]) {
		const p = require.resolve(rel);
		delete require.cache[p];
	}

	const receivingRouter = require('../receiving');
	const partsRouter = require('../parts');

	app = express();
	app.use(express.json());
	app.use('/api/receiving', receivingRouter);
	app.use('/api/parts', partsRouter);

	server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s));
	});
});

after(() => { if (server) server.close(); });

beforeEach(() => {
	const fresh = buildState();
	for (const key of Object.keys(state)) delete state[key];
	Object.assign(state, fresh);
	mockUser = { id: 'user-1', role: 'parts_manager' };
});

function request(method, urlPath, payload) {
	return new Promise((resolve, reject) => {
		const body = payload === undefined ? '' : JSON.stringify(payload);
		const { port } = server.address();
		const req = http.request({
			hostname: '127.0.0.1',
			port,
			path: urlPath,
			method,
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(body)
			}
		}, (res) => {
			const chunks = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				let parsed = text;
				try { parsed = text ? JSON.parse(text) : null; } catch (_e) { /* keep text */ }
				resolve({ status: res.statusCode, body: parsed });
			});
		});
		req.on('error', reject);
		if (body) req.write(body);
		req.end();
	});
}

describe('PATCH /api/receiving/:ticketId/lines/:lineId', () => {
	it('updates unit_cost on a DRAFT line and returns the row', async () => {
		const res = await request('PATCH', `/api/receiving/${TICKET_ID}/lines/${LINE_ID}`, { unit_cost: 87.5 });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.success, true);
		assert.strictEqual(res.body.data.unit_cost, 87.5);
		assert.strictEqual(state.receiving_ticket_lines[0].unit_cost, 87.5);
	});

	it('coerces numeric strings', async () => {
		const res = await request('PATCH', `/api/receiving/${TICKET_ID}/lines/${LINE_ID}`, { unit_cost: '42.10' });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(state.receiving_ticket_lines[0].unit_cost, 42.1);
	});

	it('updates qty_received and bin_location_override together', async () => {
		const res = await request('PATCH', `/api/receiving/${TICKET_ID}/lines/${LINE_ID}`, {
			qty_received: 7,
			bin_location_override: '  A-12  '
		});
		assert.strictEqual(res.status, 200);
		assert.strictEqual(state.receiving_ticket_lines[0].qty_received, 7);
		assert.strictEqual(state.receiving_ticket_lines[0].bin_location_override, 'A-12');
	});

	it('rejects negative unit_cost with 400', async () => {
		const res = await request('PATCH', `/api/receiving/${TICKET_ID}/lines/${LINE_ID}`, { unit_cost: -1 });
		assert.strictEqual(res.status, 400);
		assert.match(res.body.error, /unit_cost/);
	});

	it('rejects non-numeric unit_cost with 400', async () => {
		const res = await request('PATCH', `/api/receiving/${TICKET_ID}/lines/${LINE_ID}`, { unit_cost: 'abc' });
		assert.strictEqual(res.status, 400);
	});

	it('rejects > 2 decimal places with 400', async () => {
		const res = await request('PATCH', `/api/receiving/${TICKET_ID}/lines/${LINE_ID}`, { unit_cost: 12.345 });
		assert.strictEqual(res.status, 400);
	});

	it('rejects empty body with 400', async () => {
		const res = await request('PATCH', `/api/receiving/${TICKET_ID}/lines/${LINE_ID}`, {});
		assert.strictEqual(res.status, 400);
	});

	it('returns 400 when ticket is POSTED', async () => {
		state.receiving_tickets[0].status = 'POSTED';
		const res = await request('PATCH', `/api/receiving/${TICKET_ID}/lines/${LINE_ID}`, { unit_cost: 10 });
		assert.strictEqual(res.status, 400);
		assert.match(res.body.error, /posted/i);
	});

	it('returns 404 when ticket is missing', async () => {
		const res = await request('PATCH', `/api/receiving/no-such-ticket/lines/${LINE_ID}`, { unit_cost: 10 });
		assert.strictEqual(res.status, 404);
	});

	it('returns 404 when line is on a different ticket', async () => {
		state.receiving_ticket_lines[0].ticket_id = 'other-ticket';
		const res = await request('PATCH', `/api/receiving/${TICKET_ID}/lines/${LINE_ID}`, { unit_cost: 10 });
		assert.strictEqual(res.status, 404);
	});

	it('returns 403 for technician role', async () => {
		mockUser = { id: 'user-2', role: 'technician' };
		const res = await request('PATCH', `/api/receiving/${TICKET_ID}/lines/${LINE_ID}`, { unit_cost: 10 });
		assert.strictEqual(res.status, 403);
	});
});

describe('PATCH /api/parts/:id', () => {
	const PART_UUID = '550e8400-e29b-41d4-a716-446655440000';

	beforeEach(() => {
		state.parts = [{
			id: PART_UUID,
			sku: 'TRN-442',
			default_cost: 0,
			default_retail_price: 0
		}];
	});

	it('updates default_cost and returns the row', async () => {
		const res = await request('PATCH', `/api/parts/${PART_UUID}`, { default_cost: 87.5 });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.body.success, true);
		assert.strictEqual(state.parts[0].default_cost, 87.5);
	});

	it('updates both default_cost and default_retail_price', async () => {
		const res = await request('PATCH', `/api/parts/${PART_UUID}`, {
			default_cost: 87.5,
			default_retail_price: 109.99,
			ticketId: 'rcv-1'
		});
		assert.strictEqual(res.status, 200);
		assert.strictEqual(state.parts[0].default_cost, 87.5);
		assert.strictEqual(state.parts[0].default_retail_price, 109.99);
	});

	it('rejects negative default_cost with 400', async () => {
		const res = await request('PATCH', `/api/parts/${PART_UUID}`, { default_cost: -1 });
		assert.strictEqual(res.status, 400);
	});

	it('rejects non-numeric default_cost with 400', async () => {
		const res = await request('PATCH', `/api/parts/${PART_UUID}`, { default_cost: 'free' });
		assert.strictEqual(res.status, 400);
	});

	it('rejects empty body with 400', async () => {
		const res = await request('PATCH', `/api/parts/${PART_UUID}`, {});
		assert.strictEqual(res.status, 400);
	});

	it('returns 404 for unknown part id', async () => {
		const res = await request('PATCH', '/api/parts/00000000-0000-0000-0000-000000000000', { default_cost: 10 });
		assert.strictEqual(res.status, 404);
	});

	it('returns 403 for technician role', async () => {
		mockUser = { id: 'user-2', role: 'technician' };
		const res = await request('PATCH', `/api/parts/${PART_UUID}`, { default_cost: 10 });
		assert.strictEqual(res.status, 403);
	});
});
