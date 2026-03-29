'use strict';

/**
 * Idle Truck Monitor — FN-506
 *
 * Scheduled job that scans all active vehicles with assigned drivers,
 * detects those idle for 7+ days, calculates accrued always-on deductions,
 * and creates tiered alerts in idle_truck_alerts.
 *
 * Tiers:
 *   week_1_idle         — 7+ days since last delivered load, with always-on deductions
 *   week_2_no_response  — 14+ days idle and no response to the week_1 alert
 */

const knex = require('../config/knex');
const dtLogger = require('../utils/logger');

// ─── Constants ──────────────────────────────────────────────────────────────

const IDLE_THRESHOLD_DAYS_1 = 7;
const IDLE_THRESHOLD_DAYS_2 = 14;

const ALERT_TYPE = {
  WEEK_1: 'week_1_idle',
  WEEK_2: 'week_2_no_response',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Return the number of full days between two dates.
 */
function daysBetween(dateA, dateB) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor(Math.abs(new Date(dateB) - new Date(dateA)) / msPerDay);
}

/**
 * Calculate total accrued always-on deductions for a driver/vehicle
 * during a given idle period (daily rate * idle days).
 *
 * Recurring deduction rules with applies_when = 'always' and enabled = true
 * are considered. Weekly amounts are converted to a daily rate.
 */
async function calculateAccruedDeductions(driverId, vehicleId, idleDays) {
  const rules = await knex('recurring_deduction_rules')
    .where({ enabled: true, applies_when: 'always' })
    .where(function () {
      this.where({ driver_id: driverId })
        .orWhere({ equipment_id: vehicleId });
    })
    .select('id', 'amount', 'frequency');

  let totalDaily = 0;
  for (const rule of rules) {
    let dailyRate = 0;
    switch (rule.frequency) {
      case 'daily':
        dailyRate = Number(rule.amount);
        break;
      case 'weekly':
        dailyRate = Number(rule.amount) / 7;
        break;
      case 'biweekly':
        dailyRate = Number(rule.amount) / 14;
        break;
      case 'monthly':
        dailyRate = Number(rule.amount) / 30;
        break;
      default:
        dailyRate = Number(rule.amount) / 7; // default to weekly
    }
    totalDaily += dailyRate;
  }

  return Math.round(totalDaily * idleDays * 100) / 100; // round to cents
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Run the idle truck check for a single tenant.
 *
 * @param {string} tenantId
 * @returns {{ created: number, skipped: number, errors: string[] }}
 */
async function runIdleTruckCheckForTenant(tenantId) {
  const stats = { created: 0, skipped: 0, errors: [] };
  const now = new Date();

  // 1. All active vehicles with an assigned driver
  const vehicles = await knex('vehicles as v')
    .join('drivers as d', function () {
      this.on('d.truck_id', '=', 'v.id')
        .andOn('d.tenant_id', '=', 'v.tenant_id');
    })
    .where('v.tenant_id', tenantId)
    .whereRaw("LOWER(COALESCE(v.status, 'active')) NOT IN ('inactive', 'out_of_service', 'sold')")
    .whereRaw("LOWER(COALESCE(d.status, 'active')) NOT IN ('inactive', 'terminated')")
    .select(
      'v.id as vehicle_id',
      'v.equipment_owner_id',
      'd.id as driver_id'
    );

  for (const veh of vehicles) {
    try {
      // 2. Last delivered load for this vehicle
      const lastLoad = await knex('loads')
        .where({ truck_id: veh.vehicle_id, status: 'DELIVERED' })
        .orderBy('completed_date', 'desc')
        .select('completed_date')
        .first();

      const lastCompletedDate = lastLoad?.completed_date || null;
      if (!lastCompletedDate) {
        // No delivered loads at all — treat as idle since creation, but skip
        // if there is no date anchor to measure from.
        stats.skipped++;
        continue;
      }

      const idleDays = daysBetween(lastCompletedDate, now);

      // ── Week 2 check (14+ days) ────────────────────────────────────
      if (idleDays >= IDLE_THRESHOLD_DAYS_2) {
        // Check for existing week_2 alert for this vehicle (avoid duplicates)
        const existingWeek2 = await knex('idle_truck_alerts')
          .where({
            tenant_id: tenantId,
            vehicle_id: veh.vehicle_id,
            alert_type: ALERT_TYPE.WEEK_2,
          })
          .first();

        if (!existingWeek2) {
          // Verify there is an unresponded week_1 alert
          const week1Alert = await knex('idle_truck_alerts')
            .where({
              tenant_id: tenantId,
              vehicle_id: veh.vehicle_id,
              alert_type: ALERT_TYPE.WEEK_1,
            })
            .whereRaw("(response_status IS NULL OR response_status = 'pending')")
            .first();

          if (week1Alert) {
            const accrued = await calculateAccruedDeductions(
              veh.driver_id,
              veh.vehicle_id,
              idleDays
            );

            await knex('idle_truck_alerts').insert({
              tenant_id: tenantId,
              vehicle_id: veh.vehicle_id,
              driver_id: veh.driver_id,
              equipment_owner_id: veh.equipment_owner_id || null,
              alert_type: ALERT_TYPE.WEEK_2,
              accrued_deductions: accrued,
              notified_roles: JSON.stringify([]),
              response_status: null,
            });
            stats.created++;
          }
        } else {
          stats.skipped++;
        }
      }

      // ── Week 1 check (7+ days) ────────────────────────────────────
      if (idleDays >= IDLE_THRESHOLD_DAYS_1) {
        // Check for existing week_1 alert for this vehicle
        const existingWeek1 = await knex('idle_truck_alerts')
          .where({
            tenant_id: tenantId,
            vehicle_id: veh.vehicle_id,
            alert_type: ALERT_TYPE.WEEK_1,
          })
          .first();

        if (existingWeek1) {
          stats.skipped++;
          continue;
        }

        // Only alert if there are always-on recurring deductions
        const hasAlwaysOnDeductions = await knex('recurring_deduction_rules')
          .where({ enabled: true, applies_when: 'always' })
          .where(function () {
            this.where({ driver_id: veh.driver_id })
              .orWhere({ equipment_id: veh.vehicle_id });
          })
          .first();

        if (!hasAlwaysOnDeductions) {
          stats.skipped++;
          continue;
        }

        const accrued = await calculateAccruedDeductions(
          veh.driver_id,
          veh.vehicle_id,
          idleDays
        );

        await knex('idle_truck_alerts').insert({
          tenant_id: tenantId,
          vehicle_id: veh.vehicle_id,
          driver_id: veh.driver_id,
          equipment_owner_id: veh.equipment_owner_id || null,
          alert_type: ALERT_TYPE.WEEK_1,
          accrued_deductions: accrued,
          notified_roles: JSON.stringify([]),
          response_status: null,
        });
        stats.created++;
      }
    } catch (err) {
      const msg = `Vehicle ${veh.vehicle_id}: ${err.message}`;
      dtLogger.error('[idle-truck-monitor]', msg);
      stats.errors.push(msg);
    }
  }

  return stats;
}

/**
 * Run the idle truck check across ALL tenants.
 * Intended to be called by a cron/scheduled job.
 *
 * @returns {{ tenants: number, totalCreated: number, totalSkipped: number, errors: string[] }}
 */
async function runIdleTruckCheck() {
  const summary = { tenants: 0, totalCreated: 0, totalSkipped: 0, errors: [] };

  try {
    // Get distinct tenants that have vehicles
    const tenants = await knex('vehicles')
      .distinct('tenant_id')
      .whereNotNull('tenant_id');

    summary.tenants = tenants.length;

    for (const { tenant_id: tid } of tenants) {
      const result = await runIdleTruckCheckForTenant(tid);
      summary.totalCreated += result.created;
      summary.totalSkipped += result.skipped;
      summary.errors.push(...result.errors);
    }

    dtLogger.info(
      '[idle-truck-monitor] Run complete',
      `tenants=${summary.tenants} created=${summary.totalCreated} skipped=${summary.totalSkipped} errors=${summary.errors.length}`
    );
  } catch (err) {
    dtLogger.error('[idle-truck-monitor] Fatal error', err.message);
    summary.errors.push(err.message);
  }

  return summary;
}

module.exports = {
  runIdleTruckCheck,
  runIdleTruckCheckForTenant,
  calculateAccruedDeductions,
  ALERT_TYPE,
  IDLE_THRESHOLD_DAYS_1,
  IDLE_THRESHOLD_DAYS_2,
};
