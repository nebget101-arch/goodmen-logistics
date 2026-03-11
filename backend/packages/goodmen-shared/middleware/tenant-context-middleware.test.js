'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const tenantContextMiddlewareModule = require('./tenant-context-middleware');

function normalizeColumn(column) {
  return String(column).split('.').pop();
}

function getRowValue(row, column) {
  if (column === 'uoe.user_id') return row.user_id;
  if (column === 'uoe.is_active') return row.uoe_is_active;
  if (column === 'oe.is_active') return row.oe_is_active;
  if (column === 'oe.tenant_id') return row.oe_tenant_id;
  return row[normalizeColumn(column)];
}

class FakeQuery {
  constructor(tableSpec, state) {
    this.table = String(tableSpec).split(/\s+as\s+/i)[0].trim();
    this.state = state;
    this.filters = [];
    this.firstOnly = false;
  }

  join() {
    return this;
  }

  where(arg1, arg2) {
    if (typeof arg1 === 'object' && arg1 !== null) {
      for (const [key, value] of Object.entries(arg1)) {
        this.filters.push({ column: key, value });
      }
      return this;
    }

    this.filters.push({ column: arg1, value: arg2 });
    return this;
  }

  andWhere(arg1, arg2) {
    return this.where(arg1, arg2);
  }

  orderBy() {
    return this;
  }

  select() {
    return this;
  }

  modify(callback) {
    callback(this);
    return this;
  }

  first() {
    this.firstOnly = true;
    return this;
  }

  then(resolve, reject) {
    Promise.resolve(this.execute()).then(resolve, reject);
  }

  async execute() {
    let rows = [];

    if (this.table === 'user_tenant_memberships') {
      rows = [...(this.state.userTenantMemberships || [])];
    } else if (this.table === 'users') {
      rows = [...(this.state.users || [])];
    } else if (this.table === 'tenants') {
      rows = [...(this.state.tenants || [])];
    } else if (this.table === 'operating_entities') {
      rows = [...(this.state.operatingEntities || [])];
    } else if (this.table === 'user_operating_entities') {
      rows = (this.state.userOperatingEntities || []).map((row) => {
        const entity = (this.state.operatingEntities || []).find((candidate) => candidate.id === row.operating_entity_id) || {};
        return {
          ...row,
          oe_tenant_id: entity.tenant_id,
          oe_is_active: entity.is_active,
          uoe_is_active: row.is_active,
          id: row.id || `${row.user_id}-${row.operating_entity_id}`
        };
      });
    }

    for (const filter of this.filters) {
      rows = rows.filter((row) => getRowValue(row, filter.column) === filter.value);
    }

    return this.firstOnly ? (rows[0] || undefined) : rows;
  }
}

function createFakeKnex(state) {
  return function fakeKnex(tableSpec) {
    return new FakeQuery(tableSpec, state);
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function createLogger() {
  return {
    errorCalls: [],
    error(event, payload) {
      this.errorCalls.push({ event, payload });
    }
  };
}

describe('tenant-context-middleware', () => {
  it('uses the default allowed operating entity when no header is provided', async () => {
    const middleware = tenantContextMiddlewareModule.createTenantContextMiddleware({
      knexClient: createFakeKnex({
        userTenantMemberships: [
          { user_id: 'u1', tenant_id: 't1', is_active: true, is_default: true, created_at: '2026-03-01' }
        ],
        userOperatingEntities: [
          { user_id: 'u1', operating_entity_id: 'oe-default', is_active: true, is_default: true, created_at: '2026-03-01' },
          { user_id: 'u1', operating_entity_id: 'oe-secondary', is_active: true, is_default: false, created_at: '2026-03-02' }
        ],
        operatingEntities: [
          { id: 'oe-default', tenant_id: 't1', is_active: true, created_at: '2026-03-01' },
          { id: 'oe-secondary', tenant_id: 't1', is_active: true, created_at: '2026-03-02' }
        ]
      }),
      logger: createLogger()
    });

    const req = { user: { id: 'u1' }, headers: {} };
    const res = createResponse();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
    assert.deepStrictEqual(req.context, {
      tenantId: 't1',
      operatingEntityId: 'oe-default',
      allowedOperatingEntityIds: ['oe-default', 'oe-secondary']
    });
  });

  it('uses a valid requested operating entity from the header', async () => {
    const middleware = tenantContextMiddlewareModule.createTenantContextMiddleware({
      knexClient: createFakeKnex({
        userTenantMemberships: [
          { user_id: 'u1', tenant_id: 't1', is_active: true, is_default: true, created_at: '2026-03-01' }
        ],
        userOperatingEntities: [
          { user_id: 'u1', operating_entity_id: 'oe-default', is_active: true, is_default: true, created_at: '2026-03-01' },
          { user_id: 'u1', operating_entity_id: 'oe-secondary', is_active: true, is_default: false, created_at: '2026-03-02' }
        ],
        operatingEntities: [
          { id: 'oe-default', tenant_id: 't1', is_active: true, created_at: '2026-03-01' },
          { id: 'oe-secondary', tenant_id: 't1', is_active: true, created_at: '2026-03-02' }
        ]
      }),
      logger: createLogger()
    });

    const req = { user: { id: 'u1' }, headers: { 'x-operating-entity-id': 'oe-secondary' } };
    const res = createResponse();

    await middleware(req, res, () => {});

    assert.strictEqual(req.context.operatingEntityId, 'oe-secondary');
  });

  it('returns 403 when the requested operating entity is outside the allowed set', async () => {
    const middleware = tenantContextMiddlewareModule.createTenantContextMiddleware({
      knexClient: createFakeKnex({
        userTenantMemberships: [
          { user_id: 'u1', tenant_id: 't1', is_active: true, is_default: true, created_at: '2026-03-01' }
        ],
        userOperatingEntities: [
          { user_id: 'u1', operating_entity_id: 'oe-default', is_active: true, is_default: true, created_at: '2026-03-01' }
        ],
        operatingEntities: [
          { id: 'oe-default', tenant_id: 't1', is_active: true, created_at: '2026-03-01' },
          { id: 'oe-other', tenant_id: 't1', is_active: true, created_at: '2026-03-02' }
        ]
      }),
      logger: createLogger()
    });

    const req = { user: { id: 'u1' }, headers: { 'x-operating-entity-id': 'oe-other' } };
    const res = createResponse();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 403);
    assert.deepStrictEqual(res.body, { error: 'Forbidden: operating entity not allowed' });
  });

  it('returns 403 when entity assignments exist but none are active', async () => {
    const middleware = tenantContextMiddlewareModule.createTenantContextMiddleware({
      knexClient: createFakeKnex({
        userTenantMemberships: [
          { user_id: 'u1', tenant_id: 't1', is_active: true, is_default: true, created_at: '2026-03-01' }
        ],
        userOperatingEntities: [
          { id: 'assignment-1', user_id: 'u1', operating_entity_id: 'oe-default', is_active: false, is_default: false, created_at: '2026-03-01' }
        ],
        operatingEntities: [
          { id: 'oe-default', tenant_id: 't1', is_active: true, created_at: '2026-03-01' }
        ]
      }),
      logger: createLogger()
    });

    const req = { user: { id: 'u1' }, headers: {} };
    const res = createResponse();

    await middleware(req, res, () => {});

    assert.strictEqual(res.statusCode, 403);
    assert.deepStrictEqual(res.body, { error: 'Forbidden: no active operating entity access configured' });
  });

  it('falls back safely for legacy single-entity users via users.tenant_id', async () => {
    const middleware = tenantContextMiddlewareModule.createTenantContextMiddleware({
      knexClient: createFakeKnex({
        users: [
          { id: 'legacy-user', tenant_id: 't-legacy' }
        ],
        operatingEntities: [
          { id: 'oe-legacy', tenant_id: 't-legacy', is_active: true, created_at: '2026-03-01' }
        ]
      }),
      logger: createLogger()
    });

    const req = { user: { id: 'legacy-user' }, headers: {} };
    const res = createResponse();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
    assert.deepStrictEqual(req.context, {
      tenantId: 't-legacy',
      operatingEntityId: 'oe-legacy',
      allowedOperatingEntityIds: ['oe-legacy']
    });
  });
});