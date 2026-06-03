'use strict';

/**
 * FN-1469 — Add columns referenced by work-orders.service.js / work-orders-hub.js
 * that no prior migration ever created.
 *
 * Background
 * ----------
 * `backend/packages/goodmen-shared/services/work-orders.service.js` and
 * `backend/packages/goodmen-shared/routes/work-orders-hub.js` read/write the
 * following columns on every work-order create/update path:
 *
 *   work_orders.tenant_id            (already added in 20260310101000 — guarded)
 *   work_orders.requested_by_user_id (NEW — never created)
 *   work_orders.cost_type            (NEW — never created)
 *
 * Likewise the invoice reconciliation paths reference:
 *
 *   invoices.tenant_id           (already added in 20260310101000 — guarded)
 *   invoices.operating_entity_id (already added in 20260310101000 — guarded)
 *
 * PostgreSQL only reports the first missing column per failed statement, so
 * `requested_by_user_id` masked the rest. This migration is fully idempotent —
 * any column already added by a prior migration is skipped via hasColumn guards.
 *
 * FK semantics
 * ------------
 * - tenant_id              → tenants(id)            ON DELETE RESTRICT (matches 20260310101000 pattern)
 * - operating_entity_id    → operating_entities(id) ON DELETE RESTRICT (matches 20260310101000 pattern)
 * - requested_by_user_id   → users(id)              ON DELETE SET NULL (per ticket — preserve WO history if user deleted)
 *
 * cost_type defaults to 'BILLABLE' per the ticket. The service compares
 * lowercase ('internal' vs anything else), so 'BILLABLE' is treated as
 * billable everywhere — no behavioral change for existing rows.
 */

async function addColumnIfMissing(knex, table, column, builder) {
  const hasTable = await knex.schema.hasTable(table);
  if (!hasTable) return false;

  const hasCol = await knex.schema.hasColumn(table, column);
  if (hasCol) return false;

  await knex.schema.alterTable(table, builder);
  return true;
}

async function dropColumnIfExists(knex, table, column) {
  const hasTable = await knex.schema.hasTable(table);
  if (!hasTable) return;

  const hasCol = await knex.schema.hasColumn(table, column);
  if (!hasCol) return;

  await knex.schema.alterTable(table, (t) => {
    t.dropColumn(column);
  });
}

exports.up = async function up(knex) {
  const hasTenants = await knex.schema.hasTable('tenants');
  const hasUsers = await knex.schema.hasTable('users');
  const hasOperatingEntities = await knex.schema.hasTable('operating_entities');

  // ---- work_orders ---------------------------------------------------------
  if (await knex.schema.hasTable('work_orders')) {
    await addColumnIfMissing(knex, 'work_orders', 'tenant_id', (t) => {
      const col = t.uuid('tenant_id').nullable();
      if (hasTenants) {
        col.references('id').inTable('tenants').onDelete('RESTRICT');
      }
    });

    await addColumnIfMissing(knex, 'work_orders', 'requested_by_user_id', (t) => {
      const col = t.uuid('requested_by_user_id').nullable();
      if (hasUsers) {
        col.references('id').inTable('users').onDelete('SET NULL');
      }
    });

    await addColumnIfMissing(knex, 'work_orders', 'cost_type', (t) => {
      t.text('cost_type').defaultTo('BILLABLE');
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_work_orders_tenant ON work_orders(tenant_id)');
  }

  // ---- invoices -----------------------------------------------------------
  if (await knex.schema.hasTable('invoices')) {
    await addColumnIfMissing(knex, 'invoices', 'tenant_id', (t) => {
      const col = t.uuid('tenant_id').nullable();
      if (hasTenants) {
        col.references('id').inTable('tenants').onDelete('RESTRICT');
      }
    });

    await addColumnIfMissing(knex, 'invoices', 'operating_entity_id', (t) => {
      const col = t.uuid('operating_entity_id').nullable();
      if (hasOperatingEntities) {
        col.references('id').inTable('operating_entities').onDelete('RESTRICT');
      }
    });

    await knex.raw('CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id)');
    await knex.raw('CREATE INDEX IF NOT EXISTS idx_invoices_op_entity ON invoices(operating_entity_id)');
  }
};

exports.down = async function down(knex) {
  // Drop the indexes this migration created. Other migrations
  // (e.g. 20260310101000) created their own differently-named indexes
  // (idx_work_orders_tenant_id, idx_invoices_tenant_id,
  //  idx_invoices_operating_entity_id) — those are intentionally untouched.
  await knex.raw('DROP INDEX IF EXISTS idx_invoices_op_entity');
  await knex.raw('DROP INDEX IF EXISTS idx_invoices_tenant');
  await knex.raw('DROP INDEX IF EXISTS idx_work_orders_tenant');

  // Only drop columns that this migration may have added. tenant_id /
  // operating_entity_id were typically added by 20260310101000; in that case
  // those columns pre-existed our up() (hasColumn guard returned false) and
  // dropping them in down() would over-revert. To preserve "rollback removes
  // the new columns without touching pre-existing ones", we ONLY drop the
  // two columns that are unique to this migration: requested_by_user_id and
  // cost_type. tenant_id / operating_entity_id are owned by 20260310101000.
  await dropColumnIfExists(knex, 'work_orders', 'cost_type');
  await dropColumnIfExists(knex, 'work_orders', 'requested_by_user_id');
};
