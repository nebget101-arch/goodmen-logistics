'use strict';

/**
 * FN-1533: Tests for the inline-edit PATCH endpoint
 *   PATCH /api/work-orders/:id/parts/:partLineId
 * and for the selling-price source change in `reservePart()`.
 *
 * Uses an in-memory knex stub injected via setDatabase(). The stub supports
 * the chain shapes the work-orders.service.js implementation uses:
 *   - .where({...}).first()
 *   - .where({...}).update({...}).returning('*')
 *   - .where({...}).increment(col, n).update({...})
 *   - .where({...}).decrement(col, n).decrement(col, n).update({...})
 *   - .insert({...}).returning('*')
 *   - awaiting the chain itself returns matching rows
 *   - .transaction(fn) — runs fn(trx) where trx is the same fake
 *
 * Run: cd backend/packages/goodmen-shared && node --test routes/__tests__/work-orders-parts-patch.test.js
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');
const http = require('http');

const sharedRoot = path.resolve(__dirname, '..', '..');
const authMiddlewarePath = path.resolve(sharedRoot, 'middleware/auth-middleware.js');
const requireRolePath = path.resolve(sharedRoot, 'middleware/require-role.js');

require.cache[authMiddlewarePath] = {
  id: authMiddlewarePath,
  filename: authMiddlewarePath,
  loaded: true,
  exports: function authMiddlewareMock(req, _res, next) {
    req.user = {
      id: req.headers['x-mock-user'] || 'user-1',
      role: req.headers['x-mock-role'] || 'admin'
    };
    next();
  }
};

require.cache[requireRolePath] = {
  id: requireRolePath,
  filename: requireRolePath,
  loaded: true,
  exports: function requireRoleMock() {
    return (_req, _res, next) => next();
  }
};

class FakeQuery {
  constructor(state, table) {
    this.state = state;
    this.table = table;
    this.filters = [];
    this.increments = {};
    this.decrements = {};
    this._mode = 'select';
    this._patch = null;
    this._insertRows = null;
    this._returning = false;
  }

  where(arg, val) {
    if (typeof arg === 'object' && arg !== null) {
      Object.entries(arg).forEach(([col, value]) => {
        this.filters.push({ col, value });
      });
    } else if (val !== undefined) {
      this.filters.push({ col: arg, value: val });
    }
    return this;
  }

  andWhere(...args) { return this.where(...args); }
  whereRaw() { return this; }
  whereIn(col, values) {
    this.filters.push({ col, kind: 'in', value: values });
    return this;
  }

  modify(fn) { fn(this); return this; }

  increment(col, n) {
    this.increments[col] = (this.increments[col] || 0) + (Number(n) || 0);
    if (this._mode === 'select') this._mode = 'update';
    return this;
  }

  decrement(col, n) {
    this.decrements[col] = (this.decrements[col] || 0) + (Number(n) || 0);
    if (this._mode === 'select') this._mode = 'update';
    return this;
  }

  update(patch) {
    this._mode = 'update';
    this._patch = patch || {};
    return this;
  }

  insert(row) {
    this._mode = 'insert';
    this._insertRows = Array.isArray(row) ? row : [row];
    return this;
  }

  del() { this._mode = 'delete'; return this; }
  returning() { this._returning = true; return this; }

  _matches(row) {
    return this.filters.every((f) => {
      if (f.kind === 'in') return Array.isArray(f.value) && f.value.includes(row[f.col]);
      return row[f.col] === f.value;
    });
  }

  _getMatchingRows() {
    const rows = this.state[this.table] || [];
    return rows.filter((r) => this._matches(r));
  }

  _execute() {
    if (this._mode === 'select') {
      return this._getMatchingRows().map((r) => ({ ...r }));
    }
    if (this._mode === 'update') {
      const matching = this._getMatchingRows();
      const updated = [];
      for (const row of matching) {
        Object.entries(this.increments).forEach(([col, delta]) => {
          row[col] = (Number(row[col]) || 0) + delta;
        });
        Object.entries(this.decrements).forEach(([col, delta]) => {
          row[col] = (Number(row[col]) || 0) - delta;
        });
        if (this._patch) {
          Object.entries(this._patch).forEach(([col, value]) => {
            row[col] = value;
          });
        }
        updated.push({ ...row });
      }
      return this._returning ? updated : matching.length;
    }
    if (this._mode === 'insert') {
      if (!this.state[this.table]) this.state[this.table] = [];
      const inserted = [];
      for (const row of this._insertRows) {
        const newRow = { ...row };
        if (!('id' in newRow) || newRow.id === undefined || newRow.id === null) {
          newRow.id = `${this.table}-${Math.random().toString(36).slice(2, 10)}`;
        }
        this.state[this.table].push(newRow);
        inserted.push({ ...newRow });
      }
      return this._returning ? inserted : inserted.map((r) => r.id);
    }
    if (this._mode === 'delete') {
      const before = this.state[this.table] || [];
      const survivors = before.filter((r) => !this._matches(r));
      const removed = before.length - survivors.length;
      this.state[this.table] = survivors;
      return removed;
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
  db.fn = { now: () => new Date('2026-05-07T22:00:00Z') };
  db.raw = (sql) => {
    // The service uses db.raw() in resolveVehicleSource to detect tables; return
    // a shape that matches the to_regclass query result so resolveVehicleSource
    // returns 'vehicles'.
    if (typeof sql === 'string' && sql.includes('to_regclass')) {
      return Promise.resolve({
        rows: [{ rel: sql.includes('all_vehicles') ? null : 'vehicles' }]
      });
    }
    return { __raw: sql };
  };
  db.transaction = async (fn) => fn(db);
  return db;
}

const WO_ID = 'wo-1';
const LINE_ID = 'line-1';
const PART_ID = 'part-1';
const LOC_ID = 'loc-1';

function buildState(overrides = {}) {
  const partLine = {
    id: LINE_ID,
    work_order_id: WO_ID,
    part_id: PART_ID,
    location_id: LOC_ID,
    qty_requested: 10,
    qty_reserved: 6,
    qty_issued: 2,
    unit_price: 25,
    taxable: true,
    status: 'BACKORDERED',
    line_total: 50,
    ...overrides.partLine
  };
  return {
    work_orders: [{
      id: WO_ID,
      tenant_id: null,
      location_id: LOC_ID,
      discount_type: 'NONE',
      discount_value: 0,
      tax_rate_percent: 0,
      labor_subtotal: 0,
      parts_subtotal: 0,
      fees_subtotal: 0,
      tax_amount: 0,
      total_amount: 0
    }],
    work_order_part_items: [partLine],
    work_order_labor_items: [],
    work_order_fees: [],
    inventory: [{
      location_id: LOC_ID,
      part_id: PART_ID,
      on_hand_qty: 20,
      reserved_qty: 6
    }],
    inventory_transactions: [],
    parts: [{
      id: PART_ID,
      default_retail_price: 99,
      default_cost: 30,
      quantity_on_hand: 20,
      reorder_level: 0,
      taxable: true
    }],
    users: [{ id: 'user-1', username: 'tester' }],
    ...(overrides.extra || {})
  };
}

let app;
let server;
let state;
let workOrdersService;

before(async () => {
  // Inject the fake knex BEFORE requiring routes/services so the
  // `const db = require('../internal/db').knex;` capture sees our stub.
  state = buildState();
  const shared = require('../../index');
  shared.setDatabase({
    pool: null,
    query: async () => ({ rows: [] }),
    getClient: async () => null,
    knex: makeKnex(state)
  });

  // Force a fresh require so service captures the stub knex.
  const servicePath = require.resolve('../../services/work-orders.service');
  delete require.cache[servicePath];
  workOrdersService = require('../../services/work-orders.service');

  const routePath = require.resolve('../work-orders-hub');
  delete require.cache[routePath];
  const router = require('../work-orders-hub');

  app = express();
  app.use(express.json());
  app.use('/api/work-orders', router);

  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
});

after(() => { if (server) server.close(); });

beforeEach(() => {
  // Reset state by mutating in place so the stub closure keeps the same ref.
  const fresh = buildState();
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, fresh);
});

function patch(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const { port } = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: `/api/work-orders/${WO_ID}/parts/${LINE_ID}`,
      method: 'PATCH',
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
    req.write(body);
    req.end();
  });
}

describe('PATCH /api/work-orders/:id/parts/:partLineId — happy path', () => {
  it('updates qtyRequested, qtyReserved, qtyIssued together and returns line + WO totals', async () => {
    const res = await patch({ qtyRequested: 8, qtyReserved: 5, qtyIssued: 3 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.data.line, 'response.data.line present');
    assert.ok(res.body.data.workOrder, 'response.data.workOrder present');

    const line = state.work_order_part_items[0];
    assert.strictEqual(Number(line.qty_requested), 8);
    assert.strictEqual(Number(line.qty_reserved), 5);
    assert.strictEqual(Number(line.qty_issued), 3);

    // line_total = qty_issued * unit_price = 3 * 25 = 75
    assert.strictEqual(Number(line.line_total), 75);

    // WO parts_subtotal recomputed from the part line.
    const wo = state.work_orders[0];
    assert.strictEqual(Number(wo.parts_subtotal), 75);
    assert.strictEqual(Number(wo.total_amount), 75);
  });

  it('updates unitPrice and taxable; line_total reflects new price', async () => {
    const res = await patch({ unitPrice: 40, taxable: false });
    assert.strictEqual(res.status, 200);
    const line = state.work_order_part_items[0];
    assert.strictEqual(Number(line.unit_price), 40);
    assert.strictEqual(line.taxable, false);
    // line_total = qty_issued (2) * 40 = 80
    assert.strictEqual(Number(line.line_total), 80);
  });

  it('derives status: BACKORDERED when reserved < requested, RESERVED when reserved >= requested, ISSUED when issued >= requested', async () => {
    let res = await patch({ qtyRequested: 10, qtyReserved: 6, qtyIssued: 2 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(state.work_order_part_items[0].status, 'BACKORDERED');

    res = await patch({ qtyRequested: 6, qtyReserved: 6, qtyIssued: 2 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(state.work_order_part_items[0].status, 'RESERVED');

    res = await patch({ qtyRequested: 6, qtyReserved: 6, qtyIssued: 6 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(state.work_order_part_items[0].status, 'ISSUED');
  });
});

describe('PATCH /api/work-orders/:id/parts/:partLineId — invariant violations', () => {
  it('rejects when qty_reserved > qty_requested', async () => {
    const res = await patch({ qtyRequested: 5, qtyReserved: 6 });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /qty_reserved cannot exceed qty_requested/);
  });

  it('rejects when qty_issued > qty_reserved', async () => {
    const res = await patch({ qtyIssued: 7 });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /qty_issued cannot exceed qty_reserved/);
  });

  it('rejects negative quantities', async () => {
    const res = await patch({ qtyRequested: -1 });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /qtyRequested cannot be negative/);
  });

  it('rejects negative unitPrice', async () => {
    const res = await patch({ unitPrice: -5 });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /unitPrice cannot be negative/);
  });

  it('returns 400 for missing line', async () => {
    const before = state.work_order_part_items.length;
    state.work_order_part_items = [];
    const res = await patch({ qtyRequested: 4 });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Part line not found/);
    // Restore so beforeEach reset still leaves arrays in the same shape.
    state.work_order_part_items = [];
    assert.strictEqual(before, 1);
  });
});

describe('PATCH /api/work-orders/:id/parts/:partLineId — inventory side effects', () => {
  it('decrementing qty_reserved releases inventory.reserved_qty back to available', async () => {
    // current reserved=6, set to 4 — release 2.
    const beforeInv = state.inventory[0];
    assert.strictEqual(Number(beforeInv.reserved_qty), 6);
    const res = await patch({ qtyReserved: 4 });
    assert.strictEqual(res.status, 200);
    const inv = state.inventory[0];
    assert.strictEqual(Number(inv.reserved_qty), 4);
    assert.strictEqual(Number(inv.on_hand_qty), 20); // unchanged
    // inventory_transactions logs the release
    const tx = state.inventory_transactions.find((t) => t.transaction_type === 'RESERVE');
    assert.ok(tx, 'expect a RESERVE inventory_transactions row');
    assert.strictEqual(Number(tx.qty_change), -2);
  });

  it('incrementing qty_reserved checks inventory availability and reserves more', async () => {
    // current reserved=6, on_hand=20. Available = 14. Set reserved to 10 — need +4.
    const res = await patch({ qtyReserved: 10 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(Number(state.inventory[0].reserved_qty), 10);
    const tx = state.inventory_transactions.find((t) => t.transaction_type === 'RESERVE');
    assert.strictEqual(Number(tx.qty_change), 4);
  });

  it('incrementing qty_reserved past available inventory is rejected and inventory is unchanged', async () => {
    // current reserved=6, on_hand=20. Available = 14. Try to set to 25 — need +19, only 14 available.
    const res = await patch({ qtyReserved: 25, qtyRequested: 25 });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Not enough inventory available/);
  });

  it('decrementing qty_issued returns inventory to on-hand stock', async () => {
    // current issued=2, on_hand=20. Set issued=0 — return 2 to stock.
    const res = await patch({ qtyIssued: 0 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(Number(state.inventory[0].on_hand_qty), 22);
    const tx = state.inventory_transactions.find((t) => t.transaction_type === 'RETURN');
    assert.ok(tx, 'expect a RETURN inventory_transactions row');
    assert.strictEqual(Number(tx.qty_change), 2);
  });

  it('incrementing qty_issued reduces both reserved_qty and on_hand_qty', async () => {
    // current reserved=6, issued=2. Set issued=5 — need +3 issued.
    const res = await patch({ qtyIssued: 5 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(Number(state.inventory[0].reserved_qty), 3); // 6 - 3
    assert.strictEqual(Number(state.inventory[0].on_hand_qty), 17); // 20 - 3
    const tx = state.inventory_transactions.find((t) => t.transaction_type === 'ISSUE');
    assert.ok(tx, 'expect an ISSUE inventory_transactions row');
    assert.strictEqual(Number(tx.qty_change), -3);
  });
});

describe('reservePart() — selling-price source (FN-1533)', () => {
  it('uses parts.default_retail_price when payload.unitPrice is omitted', async () => {
    // Reset and remove existing line so reservePart inserts a new one.
    state.work_order_part_items = [];

    const result = await workOrdersService.reservePart(WO_ID, {
      partId: PART_ID,
      qtyRequested: 1,
      locationId: LOC_ID
    }, 'user-1');

    assert.ok(result, 'reservePart returns a line');
    assert.strictEqual(Number(result.unit_price), 99);
  });

  it('payload.unitPrice overrides default_retail_price when provided', async () => {
    state.work_order_part_items = [];

    const result = await workOrdersService.reservePart(WO_ID, {
      partId: PART_ID,
      qtyRequested: 1,
      unitPrice: 42,
      locationId: LOC_ID
    }, 'user-1');

    assert.strictEqual(Number(result.unit_price), 42);
  });

  it('falls through to 0 when neither payload.unitPrice nor parts.default_retail_price is set', async () => {
    state.work_order_part_items = [];
    state.parts[0].default_retail_price = null;

    const result = await workOrdersService.reservePart(WO_ID, {
      partId: PART_ID,
      qtyRequested: 1,
      locationId: LOC_ID
    }, 'user-1');

    assert.strictEqual(Number(result.unit_price), 0);
  });
});
