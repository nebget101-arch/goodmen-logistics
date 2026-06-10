'use strict';

/**
 * FN-1279: Tests for the nightly rollup service.
 *
 * Run standalone: node backend/microservices/reporting-service/__tests__/rollup.service.spec.js
 */

const assert = require('node:assert/strict');
const { buildRollupService } = require('../services/rollup.service');

const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';
const DAY = '2026-05-10';

// ── fake knex ────────────────────────────────────────────────────────────────

function makeFakeKnex(handlers) {
  const calls = [];

  async function raw(sql, bindings) {
    calls.push({ sql: sql.trim(), bindings: bindings || [] });
    for (const h of handlers) {
      if (h.match.test(sql)) {
        return { rows: await h.respond(bindings, sql) };
      }
    }
    throw new Error(`fake knex.raw: no handler matched:\n${sql.trim()}`);
  }

  return { raw, calls };
}

function defaultSourceHandlers() {
  return [
    {
      match: /FROM roadside_calls\s+WHERE/i,
      respond: (_b) => [
        { total_incidents: 5, resolved_incidents: 3, critical_incidents: 1, avg_resolution_hours: 2.5 }
      ]
    },
    {
      match: /FROM roadside_dispatch_assignments/i,
      respond: (_b) => [
        { dispatches_total: 4, dispatches_accepted: 3, avg_eta_minutes: 35, avg_response_minutes: 28, sla_met_count: 3 }
      ]
    },
    {
      match: /FROM roadside_payments/i,
      respond: (_b) => [
        { payment_count: 2, total_amount: 450.00, avg_payment_amount: 225.00, failed_count: 0 }
      ]
    }
  ];
}

function defaultUpsertHandlers() {
  return [
    {
      match: /INSERT INTO daily_incident_metrics/i,
      respond: () => []
    },
    {
      match: /INSERT INTO daily_vendor_sla/i,
      respond: () => []
    },
    {
      match: /INSERT INTO daily_payment_metrics/i,
      respond: () => []
    }
  ];
}

// ── tests ────────────────────────────────────────────────────────────────────

async function testRollupTenantSuccess() {
  const knex = makeFakeKnex([...defaultSourceHandlers(), ...defaultUpsertHandlers()]);
  const service = buildRollupService({ knex });

  const result = await service.rollupTenant(TENANT_A, DAY);

  assert.equal(result.tenantId, TENANT_A, 'tenantId echoed');
  assert.equal(result.day, DAY, 'day echoed');
  assert.equal(result.rowsWritten, 3, '3 tables written (one per upsert)');
  assert.equal(result.errors.length, 0, 'no errors');

  const insertCalls = knex.calls.filter((c) => /INSERT INTO/.test(c.sql));
  assert.equal(insertCalls.length, 3, '3 INSERT statements issued');
}

async function testRollupTenantBindsTenantId() {
  const capturedBindings = [];
  const knex = makeFakeKnex([
    {
      match: /FROM roadside_calls\s+WHERE/i,
      respond: (b) => { capturedBindings.push(b); return [{}]; }
    },
    {
      match: /FROM roadside_dispatch_assignments/i,
      respond: (b) => { capturedBindings.push(b); return [{}]; }
    },
    {
      match: /FROM roadside_payments/i,
      respond: (b) => { capturedBindings.push(b); return [{}]; }
    },
    {
      match: /INSERT INTO/i,
      respond: () => []
    }
  ]);
  const service = buildRollupService({ knex });

  await service.rollupTenant(TENANT_A, DAY);

  for (const bindings of capturedBindings) {
    assert.equal(bindings[0], TENANT_A, 'first binding is always tenant_id');
    assert.equal(bindings[1], DAY, 'second binding is the day');
  }
}

async function testRollupTenantUpsertHasConflictClause() {
  const upsertSqls = [];
  const knex = makeFakeKnex([
    ...defaultSourceHandlers(),
    {
      match: /INSERT INTO/i,
      respond: (_b, sql) => { upsertSqls.push(sql); return []; }
    }
  ]);
  const service = buildRollupService({ knex });

  await service.rollupTenant(TENANT_A, DAY);

  assert.equal(upsertSqls.length, 3, '3 upserts issued');
  for (const sql of upsertSqls) {
    assert.ok(
      /ON CONFLICT \(tenant_id, day\)/i.test(sql),
      `upsert has ON CONFLICT clause: ${sql.slice(0, 60)}`
    );
    assert.ok(
      /DO UPDATE SET/i.test(sql),
      `upsert has DO UPDATE SET clause: ${sql.slice(0, 60)}`
    );
  }
}

async function testRollupTenantNullAggregatesHandled() {
  const knex = makeFakeKnex([
    {
      match: /FROM roadside_calls\s+WHERE/i,
      respond: () => [{ total_incidents: 0, resolved_incidents: 0, critical_incidents: 0, avg_resolution_hours: null }]
    },
    {
      match: /FROM roadside_dispatch_assignments/i,
      respond: () => [{ dispatches_total: 0, dispatches_accepted: 0, avg_eta_minutes: null, avg_response_minutes: null, sla_met_count: 0 }]
    },
    {
      match: /FROM roadside_payments/i,
      respond: () => [{ payment_count: 0, total_amount: 0, avg_payment_amount: null, failed_count: 0 }]
    },
    { match: /INSERT INTO/i, respond: () => [] }
  ]);
  const service = buildRollupService({ knex });

  const result = await service.rollupTenant(TENANT_A, DAY);
  assert.equal(result.rowsWritten, 3, 'null aggregates still produce 3 upserts');
  assert.equal(result.errors.length, 0, 'no errors on null aggregates');
}

async function testRollupTenantPerTableErrorIsolation() {
  const knex = makeFakeKnex([
    ...defaultSourceHandlers(),
    {
      match: /INSERT INTO daily_incident_metrics/i,
      respond: () => { throw new Error('table does not exist'); }
    },
    { match: /INSERT INTO daily_vendor_sla/i, respond: () => [] },
    { match: /INSERT INTO daily_payment_metrics/i, respond: () => [] }
  ]);
  const service = buildRollupService({ knex });

  const result = await service.rollupTenant(TENANT_A, DAY);
  assert.equal(result.rowsWritten, 2, '2 successful tables');
  assert.equal(result.errors.length, 1, '1 error recorded');
  assert.equal(result.errors[0].table, 'daily_incident_metrics', 'failed table name captured');
  assert.match(result.errors[0].error, /table does not exist/, 'error message captured');
}

async function testRollupTenantEmptySourceReturnsZeros() {
  const knex = makeFakeKnex([
    { match: /FROM roadside_calls\s+WHERE/i,        respond: () => [] },
    { match: /FROM roadside_dispatch_assignments/i, respond: () => [] },
    { match: /FROM roadside_payments/i,             respond: () => [] },
    { match: /INSERT INTO/i,                        respond: () => [] }
  ]);
  const service = buildRollupService({ knex });

  const result = await service.rollupTenant(TENANT_A, DAY);
  assert.equal(result.rowsWritten, 3, 'empty source still writes 3 rows (with zeroes)');
  assert.equal(result.errors.length, 0, 'no errors on empty source');
}

async function testRunForDayIteratesAllTenants() {
  const queriedTenants = [];
  const knex = makeFakeKnex([
    {
      match: /FROM tenants/i,
      respond: () => [{ id: TENANT_A }, { id: TENANT_B }]
    },
    {
      match: /FROM roadside_calls\s+WHERE/i,
      respond: (b) => { queriedTenants.push(b[0]); return [{}]; }
    },
    { match: /FROM roadside_dispatch_assignments/i, respond: () => [{}] },
    { match: /FROM roadside_payments/i,             respond: () => [{}] },
    { match: /INSERT INTO/i,                        respond: () => [] }
  ]);
  const service = buildRollupService({ knex });

  const results = await service.runForDay(DAY);

  assert.equal(results.length, 2, 'one result per tenant');
  assert.deepEqual(
    results.map((r) => r.tenantId).sort(),
    [TENANT_A, TENANT_B].sort(),
    'both tenants processed'
  );
  assert.ok(
    queriedTenants.includes(TENANT_A) && queriedTenants.includes(TENANT_B),
    'source queries scoped to each tenant'
  );
}

async function testRunForDayNoTenants() {
  const knex = makeFakeKnex([
    { match: /FROM tenants/i, respond: () => [] }
  ]);
  const service = buildRollupService({ knex });

  const results = await service.runForDay(DAY);
  assert.equal(results.length, 0, 'no results when no tenants');
}

async function testBuildRollupServiceRequiresKnex() {
  assert.throws(
    () => buildRollupService({}),
    /knex is required/,
    'buildRollupService throws without knex'
  );
}

// ── runner ───────────────────────────────────────────────────────────────────

(async () => {
  const cases = [
    ['rollupTenant: happy path — 3 rows written, no errors',    testRollupTenantSuccess],
    ['rollupTenant: tenant_id bound first in every query',       testRollupTenantBindsTenantId],
    ['rollupTenant: upserts have ON CONFLICT (tenant_id, day)', testRollupTenantUpsertHasConflictClause],
    ['rollupTenant: null aggregates produce upserts safely',     testRollupTenantNullAggregatesHandled],
    ['rollupTenant: single-table failure is isolated',           testRollupTenantPerTableErrorIsolation],
    ['rollupTenant: empty source writes zero-value rows',        testRollupTenantEmptySourceReturnsZeros],
    ['runForDay: iterates all tenants',                          testRunForDayIteratesAllTenants],
    ['runForDay: handles no tenants gracefully',                 testRunForDayNoTenants],
    ['buildRollupService: throws without knex',                  testBuildRollupServiceRequiresKnex]
  ];

  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`PASS  ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL  ${name}\n${err && err.stack ? err.stack : err}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} test(s) passed.`);
})();
