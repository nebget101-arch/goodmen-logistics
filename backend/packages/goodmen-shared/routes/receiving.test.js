'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const express = require('express');
const http = require('http');

/**
 * FN-1482: Tests for the GET /draft and GET /summary/today endpoints on the
 * receiving route. Uses a knex-shaped stub injected via setDatabase() and a
 * mocked auth-middleware so we don't depend on a real database or JWT.
 */

const sharedRoot = path.resolve(__dirname, '..');
const authMiddlewarePath = path.resolve(sharedRoot, 'middleware/auth-middleware.js');

// Mock auth-middleware before receiving.js is loaded — keeps req.user under
// test control instead of falling through to the dev-fallback in the real
// middleware.
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
    this.countAlias = null;
    this.rawCols = [];
  }
  where(arg1, arg2, arg3) {
    if (typeof arg1 === 'object' && arg1 !== null) {
      for (const [col, value] of Object.entries(arg1)) {
        this.filters.push({ col, op: '=', value });
      }
    } else if (arg3 !== undefined) {
      this.filters.push({ col: arg1, op: arg2, value: arg3 });
    } else {
      this.filters.push({ col: arg1, op: '=', value: arg2 });
    }
    return this;
  }
  andWhere(...args) { return this.where(...args); }
  leftJoin() { return this; }
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
  select(...cols) {
    for (const c of cols) {
      if (c && typeof c === 'object' && c.__raw) {
        this.rawCols.push(c.__raw);
      }
    }
    return this;
  }
  orderBy(col, dir = 'asc') {
    this.orderBys.push({ col, dir });
    return this;
  }
  count(spec) {
    this.countAlias = (typeof spec === 'object' && spec !== null)
      ? Object.keys(spec)[0]
      : 'count';
    return this;
  }
  _resolveValue(combined, colSpec) {
    if (colSpec && colSpec.includes('.')) {
      const [pre, k] = colSpec.split('.');
      const ref = combined[pre];
      return ref ? ref[k] : undefined;
    }
    const primary = combined[this.alias] || combined[this.table];
    return primary ? primary[colSpec] : undefined;
  }
  _rows() {
    const base = this.state[this.table] || [];
    let rows = base.map((r) => ({ [this.alias]: r, [this.table]: r }));
    for (const j of this.joins) {
      const right = this.state[j.table] || [];
      rows = rows.flatMap((combined) => {
        const lkey = this._resolveValue(combined, j.leftCol);
        const matches = right.filter((rr) => {
          const k = j.rightCol.includes('.') ? j.rightCol.split('.').pop() : j.rightCol;
          return rr[k] === lkey;
        });
        return matches.map((m) => ({ ...combined, [j.alias]: m, [j.table]: m }));
      });
    }
    rows = rows.filter((combined) => {
      return this.filters.every(({ col, op, value }) => {
        const v = this._resolveValue(combined, col);
        if (op === '=') return v === value;
        if (op === '>=') return v >= value;
        if (op === '<=') return v <= value;
        return false;
      });
    });
    if (this.orderBys.length > 0) {
      const { col, dir } = this.orderBys[0];
      rows = rows.slice().sort((a, b) => {
        const av = this._resolveValue(a, col);
        const bv = this._resolveValue(b, col);
        if (av < bv) return dir === 'desc' ? 1 : -1;
        if (av > bv) return dir === 'desc' ? -1 : 1;
        return 0;
      });
    }
    return rows;
  }
  _project(rows) {
    if (this.countAlias) {
      return [{ [this.countAlias]: rows.length }];
    }
    if (this.rawCols.length > 0) {
      const result = {};
      for (const raw of this.rawCols) {
        const c = raw.match(/count\(([^)]+)\)\s+as\s+"?(\w+)"?/i);
        if (c) {
          result[c[2]] = rows.length;
          continue;
        }
        const s = raw.match(/coalesce\(sum\(([^)]+)\),\s*0\)\s+as\s+"?(\w+)"?/i);
        if (s) {
          const colSpec = s[1];
          result[s[2]] = rows.reduce((acc, r) => {
            const v = this._resolveValue(r, colSpec);
            return acc + (Number(v) || 0);
          }, 0);
        }
      }
      return [result];
    }
    return rows.map((r) => {
      const out = {};
      Object.assign(out, r[this.alias] || r[this.table] || {});
      for (const j of this.joins) {
        if (r[j.alias]) Object.assign(out, r[j.alias]);
      }
      return out;
    });
  }
  async first() {
    return this._project(this._rows())[0];
  }
  then(resolve, reject) {
    try {
      resolve(this._project(this._rows()));
    } catch (e) {
      reject(e);
    }
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

  const router = require('./receiving');
  const app = express();
  app.use(express.json());
  app.use('/api/receiving', router);
  return app;
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function request(server, { method, path: reqPath, body, headers }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch (_e) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('receiving routes — DRAFT-resume + today summary (FN-1482)', () => {
  let state;
  let server;

  before(async () => {
    state = {
      receiving_tickets: [],
      receiving_ticket_lines: [],
      users: [
        { id: 'mock-user-id', name: 'Alice' },
        { id: 'u-other', name: 'Bob' }
      ],
      parts: [
        { id: 'p1', sku: 'SKU-A', name: 'Part A', uom: 'EA', default_cost: 10 }
      ]
    };
    const app = buildApp(state);
    server = await startServer(app);
  });

  after(() => { if (server) server.close(); });

  beforeEach(() => {
    state.receiving_tickets = [];
    state.receiving_ticket_lines = [];
  });

  describe('GET /draft', () => {
    it('returns 400 when locationId is missing', async () => {
      const res = await request(server, { method: 'GET', path: '/api/receiving/draft' });
      assert.strictEqual(res.status, 400);
    });

    it('returns 204 when no DRAFT exists for user/location', async () => {
      const res = await request(server, {
        method: 'GET',
        path: '/api/receiving/draft?locationId=loc-1'
      });
      assert.strictEqual(res.status, 204);
    });

    it('returns the most recent DRAFT for the current user with lines', async () => {
      state.receiving_tickets = [
        { id: 't-old', location_id: 'loc-1', status: 'DRAFT', created_by: 'mock-user-id', created_at: '2026-05-01T10:00:00Z', ticket_number: 'OLD' },
        { id: 't-new', location_id: 'loc-1', status: 'DRAFT', created_by: 'mock-user-id', created_at: '2026-05-07T10:00:00Z', ticket_number: 'NEW' },
        { id: 't-other-user', location_id: 'loc-1', status: 'DRAFT', created_by: 'u-other', created_at: '2026-05-07T11:00:00Z', ticket_number: 'OTHER' },
        { id: 't-posted', location_id: 'loc-1', status: 'POSTED', created_by: 'mock-user-id', created_at: '2026-05-07T11:30:00Z', ticket_number: 'POSTED' }
      ];
      state.receiving_ticket_lines = [
        { id: 'l1', ticket_id: 't-new', part_id: 'p1', qty_received: 5, unit_cost: 9 }
      ];

      const res = await request(server, {
        method: 'GET',
        path: '/api/receiving/draft?locationId=loc-1'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.id, 't-new');
      assert.strictEqual(res.body.data.lines.length, 1);
      assert.strictEqual(res.body.data.lines[0].sku, 'SKU-A');
    });

    it('returns 204 when only another user has a DRAFT at the location', async () => {
      state.receiving_tickets = [
        { id: 't-other-user', location_id: 'loc-1', status: 'DRAFT', created_by: 'u-other', created_at: '2026-05-07T11:00:00Z', ticket_number: 'OTHER' }
      ];
      const res = await request(server, {
        method: 'GET',
        path: '/api/receiving/draft?locationId=loc-1'
      });
      assert.strictEqual(res.status, 204);
    });

    it('does not return DRAFTs from a different location', async () => {
      state.receiving_tickets = [
        { id: 't-other-loc', location_id: 'loc-2', status: 'DRAFT', created_by: 'mock-user-id', created_at: '2026-05-07T11:00:00Z', ticket_number: 'OTHER-LOC' }
      ];
      const res = await request(server, {
        method: 'GET',
        path: '/api/receiving/draft?locationId=loc-1'
      });
      assert.strictEqual(res.status, 204);
    });
  });

  describe('GET /summary/today', () => {
    it('returns 400 when locationId is missing', async () => {
      const res = await request(server, { method: 'GET', path: '/api/receiving/summary/today' });
      assert.strictEqual(res.status, 400);
    });

    it('returns zeroes when no tickets are posted today at the location', async () => {
      const res = await request(server, {
        method: 'GET',
        path: '/api/receiving/summary/today?locationId=loc-1'
      });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body.data, { totalParts: 0, totalLines: 0, totalTickets: 0 });
    });

    it('aggregates parts/lines/tickets for tickets posted today at the location', async () => {
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);

      state.receiving_tickets = [
        { id: 't-today1', location_id: 'loc-1', status: 'POSTED', posted_at: today },
        { id: 't-today2', location_id: 'loc-1', status: 'POSTED', posted_at: today },
        { id: 't-yesterday', location_id: 'loc-1', status: 'POSTED', posted_at: yesterday },
        { id: 't-otherloc', location_id: 'loc-2', status: 'POSTED', posted_at: today },
        { id: 't-draft', location_id: 'loc-1', status: 'DRAFT', posted_at: null }
      ];
      state.receiving_ticket_lines = [
        { id: 'l-a', ticket_id: 't-today1', part_id: 'p1', qty_received: 5 },
        { id: 'l-b', ticket_id: 't-today1', part_id: 'p1', qty_received: 3 },
        { id: 'l-c', ticket_id: 't-today2', part_id: 'p1', qty_received: 7 },
        { id: 'l-d', ticket_id: 't-yesterday', part_id: 'p1', qty_received: 99 },
        { id: 'l-e', ticket_id: 't-otherloc', part_id: 'p1', qty_received: 99 }
      ];

      const res = await request(server, {
        method: 'GET',
        path: '/api/receiving/summary/today?locationId=loc-1'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.totalTickets, 2);
      assert.strictEqual(res.body.data.totalLines, 3);
      assert.strictEqual(res.body.data.totalParts, 15);
    });
  });
});
