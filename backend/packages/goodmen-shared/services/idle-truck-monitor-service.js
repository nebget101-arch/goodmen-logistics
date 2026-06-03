/**
 * Idle Truck Monitor Service — FN-501
 *
 * Detects trucks with active drivers that have had no recent loads but still
 * accrue recurring deductions. Creates idle_truck_alerts and sends notifications.
 *
 * Alert types:
 *   week_1_idle          — no load in 7+ days; notifies dispatch/accounting/EO
 *   week_2_no_response   — no load in 14+ days AND week_1 alert has no response; notifies admin
 *   deactivation_suggested — placeholder for future manual escalation
 *
 * Trigger: POST /api/idle-truck-monitor/run  (or external Render cron job)
 */

const { sendEmail, sendInAppNotificationsToUsers } = require('./notification-service');

const IDLE_WEEK_1_DAYS = 7;
const IDLE_WEEK_2_DAYS = 14;

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value).trim();
  const iso = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(str);
  return !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

/**
 * Get all active vehicles that have a driver currently assigned.
 * Returns { vehicleId, driverId, tenantId, equipmentOwnerId, equipmentOwnerName, truckNumber }
 */
async function getActiveVehiclesWithDrivers(knex) {
  const rows = await knex('drivers as d')
    .join('vehicles as v', 'v.id', 'd.truck_id')
    .whereNotNull('d.truck_id')
    .where('d.driver_status', 'active')
    .select(
      'd.id as driver_id',
      'd.tenant_id',
      'd.first_name',
      'd.last_name',
      'd.email as driver_email',
      'v.id as vehicle_id',
      'v.unit_number as truck_number',
      'v.equipment_owner_id',
      'v.equipment_owner_name'
    );
  return rows;
}

/**
 * Find the most recent load for a driver (by pickup or delivery date).
 */
async function getLastLoadDate(knex, driverId, tenantId) {
  const row = await knex('loads')
    .where({ driver_id: driverId })
    .whereNotNull('pickup_date')
    .modify((q) => { if (tenantId) q.where('tenant_id', tenantId); })
    .orderBy('pickup_date', 'desc')
    .select('pickup_date', 'delivery_date')
    .first();

  if (!row) return null;
  const deliveryStr = toDateOnly(row.delivery_date);
  const pickupStr = toDateOnly(row.pickup_date);
  // Return the later of the two
  if (deliveryStr && pickupStr) return deliveryStr > pickupStr ? deliveryStr : pickupStr;
  return deliveryStr || pickupStr;
}

/**
 * Get the sum of always-on recurring deductions for a driver.
 * Applies to rules where applies_when = 'always' or applies_when IS NULL.
 */
async function getAlwaysOnDeductionTotal(knex, driverId, tenantId) {
  const rules = await knex('recurring_deduction_rules')
    .where({ driver_id: driverId, enabled: true })
    .where(function () {
      this.where('applies_when', 'always').orWhereNull('applies_when');
    })
    .modify((q) => { if (tenantId) q.where('tenant_id', tenantId); })
    .select('amount');

  return rules.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

/**
 * Check whether an open week_1_idle alert already exists for this vehicle
 * (status is not resolved/rejected).
 */
async function getOpenAlert(knex, vehicleId, alertType, tenantId) {
  return knex('idle_truck_alerts')
    .where({ vehicle_id: vehicleId, alert_type: alertType })
    .whereNotIn('response_status', ['resolved'])
    .modify((q) => { if (tenantId) q.where('tenant_id', tenantId); })
    .orderBy('created_at', 'desc')
    .first();
}

/**
 * Get the week_1_idle alert that is >7 days old with no response (for week 2 check).
 */
async function getUnrespondedWeek1Alert(knex, vehicleId, tenantId, today) {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - IDLE_WEEK_1_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return knex('idle_truck_alerts')
    .where({ vehicle_id: vehicleId, alert_type: 'week_1_idle' })
    .whereIn('response_status', ['pending', null])
    .whereRaw('created_at::date <= ?', [cutoffStr])
    .modify((q) => { if (tenantId) q.where('tenant_id', tenantId); })
    .orderBy('created_at', 'desc')
    .first();
}

/**
 * Get users with specific roles for a tenant (for notification targeting).
 */
async function getUsersByRole(knex, tenantId, roles) {
  const rows = await knex('users')
    .whereIn('role', roles)
    .modify((q) => { if (tenantId) q.where('tenant_id', tenantId); })
    .whereNot('is_active', false)
    .select('id', 'email', 'role', 'first_name', 'last_name')
    .catch(() => []);
  return rows || [];
}

/**
 * Send email + in-app notifications for an idle truck alert. — FN-507
 */
async function sendAlertNotifications(knex, alertRecord, vehicle, alertType, idleDays, accruedTotal) {
  const { tenantId, driverId } = alertRecord;
  const truckLabel = vehicle.truck_number || vehicle.vehicle_id;
  const driverLabel = [vehicle.first_name, vehicle.last_name].filter(Boolean).join(' ') || driverId;

  const emailSubject = alertType === 'week_1_idle'
    ? `[Fleet Alert] Idle Truck: ${truckLabel} — ${idleDays} days idle`
    : `[Fleet Alert — URGENT] ${truckLabel} idle ${idleDays} days, no response`;

  const emailBody = alertType === 'week_1_idle'
    ? `Truck ${truckLabel} (Driver: ${driverLabel}) has had no loads for ${idleDays} days.\n\nAccrued deductions while idle: $${accruedTotal.toFixed(2)}/period\n\nPlease review and assign a load or take action to reduce costs.`
    : `Truck ${truckLabel} (Driver: ${driverLabel}) has been idle for ${idleDays} days with no response to the week-1 alert.\n\nRecommended actions:\n• Remove truck from active insurance\n• Mark truck as inactive\n• Transfer or terminate driver assignment\n\nAccrued deductions: $${accruedTotal.toFixed(2)}/period`;

  const inAppTitle = alertType === 'week_1_idle'
    ? `Idle Truck: ${truckLabel} — ${idleDays} days without a load`
    : `URGENT: ${truckLabel} idle ${idleDays} days — no response to week-1 alert`;

  const inAppBody = alertType === 'week_1_idle'
    ? `Driver ${driverLabel} has accrued $${accruedTotal.toFixed(2)} in deductions while idle. Assign a load or take action.`
    : `Recommended: remove from insurance, mark inactive, or transfer/terminate driver assignment. Accrued: $${accruedTotal.toFixed(2)}.`;

  const targetRoles = alertType === 'week_1_idle'
    ? ['admin', 'manager', 'dispatcher', 'accounting']
    : ['admin'];

  const inAppType = alertType === 'week_1_idle' ? 'idle_truck_week1' : 'idle_truck_week2';
  const notifMeta = {
    vehicle_id: vehicle.vehicle_id,
    driver_id: driverId,
    truck_number: vehicle.truck_number,
    idle_days: idleDays,
    accrued_deductions: accruedTotal
  };

  const users = await getUsersByRole(knex, tenantId, targetRoles);
  const emailResults = [];

  // Email (only users with an email address)
  for (const user of users) {
    if (!user.email) continue;
    const result = await sendEmail({ to: user.email, subject: emailSubject, text: emailBody });
    emailResults.push({ userId: user.id, email: user.email, ...result });
  }

  // In-app notification bell
  await sendInAppNotificationsToUsers(knex, users, {
    type: inAppType,
    title: inAppTitle,
    body: inAppBody,
    meta: notifMeta,
    tenantId
  }).catch(() => {}); // non-fatal

  return emailResults;
}

/**
 * Create an idle_truck_alerts record.
 */
async function createAlert(knex, {
  tenantId, vehicleId, driverId, equipmentOwnerId, alertType, accruedDeductions, notifiedRoles, userId
}) {
  const hasAlertsTable = await knex.schema.hasTable('idle_truck_alerts').catch(() => false);
  if (!hasAlertsTable) {
    console.warn('[IdleTruckMonitor] idle_truck_alerts table not found — run FN-495 migration first');
    return null;
  }

  const [alert] = await knex('idle_truck_alerts')
    .insert({
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      driver_id: driverId || null,
      equipment_owner_id: equipmentOwnerId || null,
      alert_type: alertType,
      accrued_deductions: accruedDeductions || 0,
      notified_roles: JSON.stringify(notifiedRoles || []),
      response_status: 'pending',
      responded_by: null
    })
    .returning('*');

  return alert;
}

// ---------------------------------------------------------------------------
// Main job
// ---------------------------------------------------------------------------

/**
 * Run the idle truck check for all tenants.
 * Should be called daily (e.g., from a Render Cron Job hitting POST /api/idle-truck-monitor/run).
 *
 * @param {object} knex - Knex instance
 * @param {string|null} userId - User or system triggering the run
 * @returns {{ checked: number, week1Created: number, week2Created: number, errors: string[] }}
 */
async function runIdleTruckCheck(knex, userId = null) {
  const today = toDateOnly(new Date());
  const stats = { checked: 0, week1Created: 0, week2Created: 0, errors: [] };

  let vehicles;
  try {
    vehicles = await getActiveVehiclesWithDrivers(knex);
  } catch (err) {
    stats.errors.push(`Failed to fetch active vehicles: ${err.message}`);
    return stats;
  }

  for (const vehicle of vehicles) {
    stats.checked++;
    const { vehicle_id, driver_id, tenant_id, equipment_owner_id } = vehicle;

    try {
      const lastLoadDate = await getLastLoadDate(knex, driver_id, tenant_id);
      const idleDays = lastLoadDate ? daysBetween(lastLoadDate, today) : 999;

      if (idleDays < IDLE_WEEK_1_DAYS) continue;

      // Calculate always-on deductions accrued per period (weekly)
      const weeklyDeductionTotal = await getAlwaysOnDeductionTotal(knex, driver_id, tenant_id);
      if (weeklyDeductionTotal === 0) continue; // No always-on deductions — skip

      const periodsIdle = Math.floor(idleDays / 7);
      const accruedTotal = weeklyDeductionTotal * periodsIdle;

      // --- Week 1 check ---
      if (idleDays >= IDLE_WEEK_1_DAYS && idleDays < IDLE_WEEK_2_DAYS) {
        const existing = await getOpenAlert(knex, vehicle_id, 'week_1_idle', tenant_id);
        if (!existing) {
          const notifiedRoles = ['admin', 'manager', 'dispatcher', 'accounting'];
          const alert = await createAlert(knex, {
            tenantId: tenant_id,
            vehicleId: vehicle_id,
            driverId: driver_id,
            equipmentOwnerId: equipment_owner_id,
            alertType: 'week_1_idle',
            accruedDeductions: accruedTotal,
            notifiedRoles,
            userId
          });

          if (alert) {
            stats.week1Created++;
            await sendAlertNotifications(knex, { tenantId: tenant_id, driverId: driver_id }, vehicle, 'week_1_idle', idleDays, accruedTotal).catch(() => {});
          }
        }
        continue;
      }

      // --- Week 2 check ---
      if (idleDays >= IDLE_WEEK_2_DAYS) {
        // First ensure week_1 alert exists for this vehicle
        const week1Open = await getOpenAlert(knex, vehicle_id, 'week_1_idle', tenant_id);
        if (!week1Open) {
          // Create week_1 retroactively if missing
          await createAlert(knex, {
            tenantId: tenant_id,
            vehicleId: vehicle_id,
            driverId: driver_id,
            equipmentOwnerId: equipment_owner_id,
            alertType: 'week_1_idle',
            accruedDeductions: weeklyDeductionTotal * 2,
            notifiedRoles: ['admin', 'manager', 'dispatcher', 'accounting'],
            userId
          });
        }

        const unrespondedWeek1 = await getUnrespondedWeek1Alert(knex, vehicle_id, tenant_id, today);
        if (!unrespondedWeek1) continue;

        const existingWeek2 = await getOpenAlert(knex, vehicle_id, 'week_2_no_response', tenant_id);
        if (!existingWeek2) {
          const alert = await createAlert(knex, {
            tenantId: tenant_id,
            vehicleId: vehicle_id,
            driverId: driver_id,
            equipmentOwnerId: equipment_owner_id,
            alertType: 'week_2_no_response',
            accruedDeductions: accruedTotal,
            notifiedRoles: ['admin'],
            userId
          });

          if (alert) {
            stats.week2Created++;
            await sendAlertNotifications(knex, { tenantId: tenant_id, driverId: driver_id }, vehicle, 'week_2_no_response', idleDays, accruedTotal).catch(() => {});
          }
        }
      }
    } catch (err) {
      stats.errors.push(`vehicle ${vehicle_id}: ${err.message}`);
    }
  }

  return stats;
}

module.exports = {
  runIdleTruckCheck,
  getActiveVehiclesWithDrivers,
  getLastLoadDate,
  getAlwaysOnDeductionTotal,
  createAlert
};
