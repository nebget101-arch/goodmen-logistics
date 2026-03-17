'use strict';

/**
 * Phase 2.5 – Add tenant_id to root tables omitted from the initial
 * multi-MC scoping pass (20260310101000_add_multi_mc_scope_columns).
 *
 * Background
 * ----------
 * The initial pass deliberately left child/detail tables unscoped because
 * they inherit tenant context through their parent FK (design note in
 * 20260310101000). However, four tables were missed that ARE independently
 * queried at the API layer and therefore require direct tenant scoping:
 *
 *   divisions         – root RBAC org unit; no parent FK to inherit scope from.
 *   dqf_documents     – compliance doc repository queried for tenant-wide views.
 *   driver_documents  – driver doc management queries that skip the drivers JOIN.
 *   vehicle_documents – vehicle compliance docs (DOT inspections, registrations).
 *
 * All other tables in the "has_tenant_id = NO" query results are either:
 *   • True child tables (customer_credit_balance, customer_notes, etc.) that
 *     join through a tenanted parent – left as-is per design.
 *   • The dqf_requirements lookup table – system-wide seed data, no tenant scope.
 *   • driver_document_blobs – raw binary store with no business FK.
 *
 * Migration strategy
 * ------------------
 *   1. Add nullable tenant_id UUID FK → tenants.id (matching 20260310101000).
 *   2. Create a covering index on tenant_id.
 *   3. Backfill from the nearest tenanted ancestor where possible:
 *        dqf_documents     → drivers.tenant_id  (via driver_id)
 *        driver_documents  → drivers.tenant_id  (via driver_id)
 *        vehicle_documents → vehicles.tenant_id (via vehicle_id)
 *        divisions         → no ancestor; remains NULL until app writes.
 */

const ROOT_TABLES_BACKFILL = [
  {
    table: 'dqf_documents',
    parentTable: 'drivers',
    fkColumn: 'driver_id',
  },
  {
    table: 'driver_documents',
    parentTable: 'drivers',
    fkColumn: 'driver_id',
  },
  {
    table: 'vehicle_documents',
    parentTable: 'vehicles',
    fkColumn: 'vehicle_id',
  },
];

async function addTenantScope(knex, tableName) {
  const hasTable = await knex.schema.hasTable(tableName);
  if (!hasTable) return false;

  const hasCol = await knex.schema.hasColumn(tableName, 'tenant_id');
  if (!hasCol) {
    await knex.schema.alterTable(tableName, (t) => {
      t.uuid('tenant_id')
        .nullable()
        .references('id')
        .inTable('tenants')
        .onDelete('RESTRICT');
    });
  }

  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_${tableName}_tenant_id ON ${tableName}(tenant_id)`
  );

  return true;
}

exports.up = async function up(knex) {
  // 1. divisions – root org table (no parent to backfill from)
  await addTenantScope(knex, 'divisions');

  // 2–4. Document tables – add column then backfill from parent
  for (const { table, parentTable, fkColumn } of ROOT_TABLES_BACKFILL) {
    const added = await addTenantScope(knex, table);
    if (!added) continue;

    // Backfill tenant_id from the parent row that already has it
    const parentHasTenant = await knex.schema.hasColumn(parentTable, 'tenant_id');
    if (parentHasTenant) {
      await knex.raw(`
        UPDATE ${table} child
        SET    tenant_id = parent.tenant_id
        FROM   ${parentTable} parent
        WHERE  child.${fkColumn} = parent.id
          AND  child.tenant_id IS NULL
          AND  parent.tenant_id IS NOT NULL
      `);
    }
  }
};

exports.down = async function down(knex) {
  const tablesToRevert = [
    'vehicle_documents',
    'driver_documents',
    'dqf_documents',
    'divisions',
  ];

  for (const tableName of tablesToRevert) {
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) continue;

    const hasCol = await knex.schema.hasColumn(tableName, 'tenant_id');
    if (!hasCol) continue;

    await knex.schema.alterTable(tableName, (t) => {
      t.dropColumn('tenant_id');
    });
  }
};
