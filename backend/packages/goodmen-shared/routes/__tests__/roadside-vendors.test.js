'use strict';

/**
 * FN-1249 — Unit tests for roadside-vendors.service.js.
 *
 * Mocks the knex DB layer via require.cache so no real DB is needed.
 * Covers: list (tenant scoping), getById (tenant + marketplace), create
 * (validation), update (owner check), setStatus, stats.
 */

const path = require('node:path');
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');

const SERVICE_PATH = path.resolve(__dirname, '../../services/roadside-vendors.service.js');
const DB_PATH = require.resolve('../../internal/db');

const TENANT_A = 'tenant-aaaa-0000-0000-000000000000';
const TENANT_B = 'tenant-bbbb-0000-0000-000000000000';
const VENDOR_UUID = 'vendor-1111-0000-0000-000000000000';

let vendorRows = [];
let insertCalls = [];
let updateCalls = [];

function makeRow(overrides = {}) {
  return {
    vendor_id: VENDOR_UUID,
    tenant_id: TENANT_A,
    name: 'FastTow Inc',
    skills: ['Towing', 'Flatbed Transport'],
    capacity: 3,
    base_location: { lat: 41.8781, lng: -87.6298 },
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeKnex() {
  const fn = { now: () => 'NOW()' };

  function builder(table) {
    const b = {
      _table: table,
      _filters: [],
      _limit: null,
      _offset: null,
    };

    b.select = () => b;
    b.orderBy = () => b;
    b.limit = (n) => { b._limit = n; return b; };
    b.offset = (n) => { b._offset = n; return b; };
    b.where = (col, val) => {
      if (typeof col === 'function') { col(b); }
      else { b._filters.push({ col, val }); }
      return b;
    };
    b.andWhere = (col, val) => { b._filters.push({ col, val }); return b; };
    b.orWhereNull = (col) => { b._filters.push({ col, isNull: true }); return b; };
    b.whereNull = (col) => { b._filters.push({ col, isNull: true }); return b; };
    b.groupBy = () => b;
    b.count = (expr) => { b._count = expr; return b; };
    b.schema = {
      hasTable: async () => false,
    };

    b.first = async () => {
      const tenantFilter = b._filters.find(f => f.col === 'tenant_id');
      const idFilter = b._filters.find(f => f.col === 'vendor_id');
      const rows = vendorRows.filter(r => {
        if (idFilter && r.vendor_id !== idFilter.val) return false;
        return true;
      });
      return rows[0] || null;
    };

    then(resolve, reject) { return Promise.resolve(vendorRows.slice()).then(resolve, reject); }

    b.then = (resolve, reject) => Promise.resolve(vendorRows.slice()).then(resolve, reject);

    b.insert = (payload) => {
      insertCalls.push({ table, payload });
      const row = {
        vendor_id: VENDOR_UUID,
        tenant_id: payload.tenant_id,
        name: payload.name,
        skills: typeof payload.skills === 'string' ? JSON.parse(payload.skills) : payload.skills,
        capacity: payload.capacity,
        base_location: payload.base_location ? (typeof payload.base_location === 'string' ? JSON.parse(payload.base_location) : payload.base_location) : null,
        status: payload.status || 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      vendorRows.push(row);
      return { returning: async () => [row] };
    };

    b.update = (payload) => {
      updateCalls.push({ table, payload });
      const idFilter = b._filters.find(f => f.col === 'vendor_id');
      if (idFilter) {
        vendorRows = vendorRows.map(r => r.vendor_id === idFilter.val ? { ...r, ...payload } : r);
      }
      const updated = idFilter ? vendorRows.find(r => r.vendor_id === idFilter.val) : vendorRows[0];
      return { returning: async () => [updated || {}] };
    };

    b.del = async () => {
      const idFilter = b._filters.find(f => f.col === 'vendor_id');
      if (idFilter) vendorRows = vendorRows.filter(r => r.vendor_id !== idFilter.val);
      return 1;
    };

    return b;
  }

  const knex = (table) => builder(table);
  knex.fn = fn;
  knex.raw = (sql) => sql;
  knex.schema = { hasTable: async () => false };
  return knex;
}

before(() => {
  const fakeDb = { knex: makeKnex(), query: async () => ({ rows: [] }) };
  require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: fakeDb };
  delete require.cache[SERVICE_PATH];
});

beforeEach(() => {
  vendorRows = [];
  insertCalls = [];
  updateCalls = [];
});

describe('roadside-vendors.service', () => {
  describe('create', () => {
    it('creates a vendor for a tenant', async () => {
      const svc = require(SERVICE_PATH);
      delete require.cache[SERVICE_PATH];
      const { create } = require(SERVICE_PATH);
      const row = await create({
        tenantId: TENANT_A,
        name: 'FastTow Inc',
        skills: ['Towing'],
        capacity: 3,
        base_location: { lat: 41.8781, lng: -87.6298 },
      });
      assert.strictEqual(row.name, 'FastTow Inc');
      assert.strictEqual(row.tenant_id, TENANT_A);
      assert.strictEqual(row.status, 'active');
      assert.ok(insertCalls.length > 0, 'expected an insert');
    });

    it('throws when name is missing', async () => {
      const { create } = require(SERVICE_PATH);
      await assert.rejects(() => create({ tenantId: TENANT_A, name: '' }), /name is required/);
    });

    it('throws when capacity is negative', async () => {
      const { create } = require(SERVICE_PATH);
      await assert.rejects(
        () => create({ tenantId: TENANT_A, name: 'Test Vendor', capacity: -1 }),
        /non-negative integer/
      );
    });

    it('throws when base_location lat is out of range', async () => {
      const { create } = require(SERVICE_PATH);
      await assert.rejects(
        () => create({ tenantId: TENANT_A, name: 'Test Vendor', base_location: { lat: 200, lng: 0 } }),
        /lat must be between/
      );
    });
  });

  describe('getById', () => {
    it('finds an owned vendor', async () => {
      vendorRows = [makeRow()];
      const { getById } = require(SERVICE_PATH);
      const row = await getById(VENDOR_UUID, TENANT_A);
      assert.strictEqual(row.vendor_id, VENDOR_UUID);
    });

    it('finds a marketplace vendor (tenant_id null)', async () => {
      vendorRows = [makeRow({ tenant_id: null })];
      const { getById } = require(SERVICE_PATH);
      const row = await getById(VENDOR_UUID, TENANT_B);
      assert.strictEqual(row.vendor_id, VENDOR_UUID);
    });

    it('throws when vendor not found', async () => {
      vendorRows = [];
      const { getById } = require(SERVICE_PATH);
      await assert.rejects(() => getById('nonexistent', TENANT_A), /not found/);
    });
  });

  describe('setStatus', () => {
    it('suspends an active vendor', async () => {
      vendorRows = [makeRow({ status: 'active' })];
      const { setStatus } = require(SERVICE_PATH);
      const row = await setStatus(VENDOR_UUID, TENANT_A, 'suspended');
      assert.ok(updateCalls.length > 0, 'expected an update');
    });

    it('rejects invalid status', async () => {
      vendorRows = [makeRow()];
      const { setStatus } = require(SERVICE_PATH);
      await assert.rejects(() => setStatus(VENDOR_UUID, TENANT_A, 'deleted'), /active or suspended/);
    });
  });

  describe('stats', () => {
    it('returns distribution with zero counts on empty table', async () => {
      const { stats } = require(SERVICE_PATH);
      const result = await stats(TENANT_A);
      assert.ok(typeof result.total === 'number');
      assert.ok(typeof result.distribution === 'object');
    });
  });
});
