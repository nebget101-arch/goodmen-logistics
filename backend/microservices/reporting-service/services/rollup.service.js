'use strict';

/**
 * FN-1279: Nightly rollup service.
 *
 * Reads from source tables (roadside_calls, roadside_dispatch_assignments,
 * roadside_payments) and upserts into three daily rollup tables for a given
 * tenant + day.  Idempotent: re-running for the same (tenant_id, day) key
 * replaces the row in place.
 *
 * Rollup tables are created by the FN-1280 database migration.
 */

async function computeIncidentMetrics(knex, tenantId, day) {
  const result = await knex.raw(
    `SELECT
       COUNT(*)::int                                                        AS total_incidents,
       COUNT(*) FILTER (WHERE status IN ('RESOLVED','CANCELED'))::int       AS resolved_incidents,
       COUNT(*) FILTER (WHERE urgency = 'CRITICAL')::int                   AS critical_incidents,
       AVG(
         CASE WHEN closed_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (closed_at - opened_at)) / 3600.0
         END
       )::float                                                             AS avg_resolution_hours
     FROM roadside_calls
     WHERE tenant_id = ?
       AND opened_at::date = ?::date`,
    [tenantId, day]
  );
  const row = (result.rows || [])[0] || {};
  return {
    total_incidents:      row.total_incidents      ?? 0,
    resolved_incidents:   row.resolved_incidents   ?? 0,
    critical_incidents:   row.critical_incidents   ?? 0,
    avg_resolution_hours: row.avg_resolution_hours ?? null
  };
}

async function computeVendorSla(knex, tenantId, day) {
  const result = await knex.raw(
    `SELECT
       COUNT(*)::int                                                                  AS dispatches_total,
       COUNT(*) FILTER (WHERE d.dispatch_status NOT IN ('PENDING','CANCELED'))::int  AS dispatches_accepted,
       AVG(d.eta_minutes)::float                                                     AS avg_eta_minutes,
       AVG(
         CASE WHEN d.arrived_at IS NOT NULL AND d.dispatched_at IS NOT NULL
              THEN EXTRACT(EPOCH FROM (d.arrived_at - d.dispatched_at)) / 60.0
         END
       )::float                                                                      AS avg_response_minutes,
       COUNT(*) FILTER (
         WHERE d.arrived_at IS NOT NULL
           AND d.dispatched_at IS NOT NULL
           AND EXTRACT(EPOCH FROM (d.arrived_at - d.dispatched_at)) / 60.0 <= 60
       )::int                                                                        AS sla_met_count
     FROM roadside_dispatch_assignments d
     JOIN roadside_calls c ON c.id = d.call_id
     WHERE c.tenant_id = ?
       AND d.created_at::date = ?::date`,
    [tenantId, day]
  );
  const row = (result.rows || [])[0] || {};
  return {
    dispatches_total:     row.dispatches_total     ?? 0,
    dispatches_accepted:  row.dispatches_accepted  ?? 0,
    avg_eta_minutes:      row.avg_eta_minutes      ?? null,
    avg_response_minutes: row.avg_response_minutes ?? null,
    sla_met_count:        row.sla_met_count        ?? 0
  };
}

async function computePaymentMetrics(knex, tenantId, day) {
  const result = await knex.raw(
    `SELECT
       COUNT(*) FILTER (WHERE p.payment_status = 'PAID')::int    AS payment_count,
       COALESCE(SUM(p.amount) FILTER (WHERE p.payment_status = 'PAID'), 0)::float AS total_amount,
       AVG(p.amount)       FILTER (WHERE p.payment_status = 'PAID')::float        AS avg_payment_amount,
       COUNT(*) FILTER (WHERE p.payment_status = 'FAILED')::int  AS failed_count
     FROM roadside_payments p
     JOIN roadside_calls c ON c.id = p.call_id
     WHERE c.tenant_id = ?
       AND p.created_at::date = ?::date`,
    [tenantId, day]
  );
  const row = (result.rows || [])[0] || {};
  return {
    payment_count:      row.payment_count      ?? 0,
    total_amount:       row.total_amount       ?? 0,
    avg_payment_amount: row.avg_payment_amount ?? null,
    failed_count:       row.failed_count       ?? 0
  };
}

async function upsertIncidentMetrics(knex, tenantId, day, metrics) {
  await knex.raw(
    `INSERT INTO daily_incident_metrics
       (tenant_id, day, total_incidents, resolved_incidents, critical_incidents, avg_resolution_hours, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (tenant_id, day)
       DO UPDATE SET
         total_incidents      = EXCLUDED.total_incidents,
         resolved_incidents   = EXCLUDED.resolved_incidents,
         critical_incidents   = EXCLUDED.critical_incidents,
         avg_resolution_hours = EXCLUDED.avg_resolution_hours,
         computed_at          = EXCLUDED.computed_at`,
    [tenantId, day, metrics.total_incidents, metrics.resolved_incidents, metrics.critical_incidents, metrics.avg_resolution_hours]
  );
}

async function upsertVendorSla(knex, tenantId, day, metrics) {
  await knex.raw(
    `INSERT INTO daily_vendor_sla
       (tenant_id, day, dispatches_total, dispatches_accepted, avg_eta_minutes, avg_response_minutes, sla_met_count, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (tenant_id, day)
       DO UPDATE SET
         dispatches_total     = EXCLUDED.dispatches_total,
         dispatches_accepted  = EXCLUDED.dispatches_accepted,
         avg_eta_minutes      = EXCLUDED.avg_eta_minutes,
         avg_response_minutes = EXCLUDED.avg_response_minutes,
         sla_met_count        = EXCLUDED.sla_met_count,
         computed_at          = EXCLUDED.computed_at`,
    [tenantId, day, metrics.dispatches_total, metrics.dispatches_accepted, metrics.avg_eta_minutes, metrics.avg_response_minutes, metrics.sla_met_count]
  );
}

async function upsertPaymentMetrics(knex, tenantId, day, metrics) {
  await knex.raw(
    `INSERT INTO daily_payment_metrics
       (tenant_id, day, payment_count, total_amount, avg_payment_amount, failed_count, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (tenant_id, day)
       DO UPDATE SET
         payment_count      = EXCLUDED.payment_count,
         total_amount       = EXCLUDED.total_amount,
         avg_payment_amount = EXCLUDED.avg_payment_amount,
         failed_count       = EXCLUDED.failed_count,
         computed_at        = EXCLUDED.computed_at`,
    [tenantId, day, metrics.payment_count, metrics.total_amount, metrics.avg_payment_amount, metrics.failed_count]
  );
}

function buildRollupService(deps) {
  const { knex } = deps;
  if (!knex) throw new Error('rollup-service: knex is required');

  /**
   * Roll up metrics for a single tenant + day.
   * Returns { tenantId, day, rowsWritten, errors }.
   */
  async function rollupTenant(tenantId, day) {
    const errors = [];
    let rowsWritten = 0;

    const tasks = [
      {
        label: 'daily_incident_metrics',
        compute: () => computeIncidentMetrics(knex, tenantId, day),
        upsert:  (m)  => upsertIncidentMetrics(knex, tenantId, day, m)
      },
      {
        label: 'daily_vendor_sla',
        compute: () => computeVendorSla(knex, tenantId, day),
        upsert:  (m)  => upsertVendorSla(knex, tenantId, day, m)
      },
      {
        label: 'daily_payment_metrics',
        compute: () => computePaymentMetrics(knex, tenantId, day),
        upsert:  (m)  => upsertPaymentMetrics(knex, tenantId, day, m)
      }
    ];

    for (const task of tasks) {
      try {
        const metrics = await task.compute();
        await task.upsert(metrics);
        rowsWritten += 1;
      } catch (err) {
        errors.push({ table: task.label, error: err && err.message ? err.message : String(err) });
      }
    }

    return { tenantId, day, rowsWritten, errors };
  }

  /**
   * Fetch all active tenant IDs and roll up for the given day.
   * Tenants with expired/canceled status are excluded.
   */
  async function runForDay(day) {
    const tenantsResult = await knex.raw(
      `SELECT id FROM tenants WHERE trial_status IS DISTINCT FROM 'expired' ORDER BY id`
    );
    const tenantIds = (tenantsResult.rows || []).map((r) => r.id);

    const results = [];
    for (const tenantId of tenantIds) {
      const result = await rollupTenant(tenantId, day);
      results.push(result);
    }

    return results;
  }

  return { rollupTenant, runForDay };
}

module.exports = { buildRollupService };
