const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');
const auth = require('./auth-middleware');
const db = require('../internal/db').knex;

function buildVehicleUnionSqlPg(source = 'all_vehicles') {
  if (source === 'vehicles') {
    return `
      SELECT id, unit_number, status, oos_reason, next_pm_due, tenant_id, operating_entity_id
      FROM vehicles
      WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2)
    `;
  }

  if (source === 'none') {
    return `
      SELECT
        NULL::uuid AS id,
        NULL::text AS unit_number,
        NULL::text AS status,
        NULL::text AS oos_reason,
        NULL::date AS next_pm_due,
        NULL::uuid AS tenant_id,
        NULL::uuid AS operating_entity_id
      WHERE FALSE
    `;
  }

  return `
    SELECT id, unit_number, status, oos_reason, next_pm_due, tenant_id, operating_entity_id
    FROM all_vehicles
    WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2)
  `;
}

function buildVehicleUnionSqlKnex(source = 'all_vehicles') {
  if (source === 'vehicles') {
    return `
      SELECT id, unit_number, status, oos_reason, next_pm_due, tenant_id, operating_entity_id
      FROM vehicles
      WHERE tenant_id = ? AND (?::uuid IS NULL OR operating_entity_id = ?)
    `;
  }

  if (source === 'none') {
    return `
      SELECT
        NULL::uuid AS id,
        NULL::text AS unit_number,
        NULL::text AS status,
        NULL::text AS oos_reason,
        NULL::date AS next_pm_due,
        NULL::uuid AS tenant_id,
        NULL::uuid AS operating_entity_id
      WHERE FALSE
    `;
  }

  return `
    SELECT id, unit_number, status, oos_reason, next_pm_due, tenant_id, operating_entity_id
    FROM all_vehicles
    WHERE tenant_id = ? AND (?::uuid IS NULL OR operating_entity_id = ?)
  `;
}

async function resolveVehicleSource() {
  try {
    const viewResult = await query(`SELECT to_regclass('public.all_vehicles') AS rel`);
    if (viewResult?.rows?.[0]?.rel) return 'all_vehicles';

    const tableResult = await query(`SELECT to_regclass('public.vehicles') AS rel`);
    if (tableResult?.rows?.[0]?.rel) return 'vehicles';

    return 'none';
  } catch {
    return 'none';
  }
}

async function tableExists(tableName) {
  try {
    const safeName = String(tableName || '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeName) return false;
    const result = await query(`SELECT to_regclass('public.${safeName}') AS rel`);
    return !!result?.rows?.[0]?.rel;
  } catch {
    return false;
  }
}

// Protect all dashboard routes: admin, safety
router.use(auth(['admin', 'safety']));

// GET dashboard statistics — isolated query groups via Promise.allSettled
router.get('/stats', async (req, res) => {
  const startTime = Date.now();
  try {
    const tenantId = req.context?.tenantId || null;
    const operatingEntityId = req.context?.operatingEntityId || null;
    const vehicleSource = await resolveVehicleSource();
    const vehicleSqlPg = buildVehicleUnionSqlPg(vehicleSource);
    const hasDrivers = await tableExists('drivers');
    const hasLoads = await tableExists('loads');
    const hasHosRecords = await tableExists('hos_records');
    const params = [tenantId, operatingEntityId];

    // Define isolated query groups — each resolves independently
    const groups = {
      drivers: hasDrivers
        ? query(`SELECT
            COUNT(*) FILTER (WHERE status = 'active') AS "activeDrivers",
            COUNT(*) AS "totalDrivers"
          FROM drivers WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2)`, params)
        : Promise.resolve({ rows: [{ activeDrivers: 0, totalDrivers: 0 }] }),

      vehicles: query(`SELECT
          COUNT(*) FILTER (WHERE status = 'in-service') AS "activeVehicles",
          COUNT(*) AS "totalVehicles",
          COUNT(*) FILTER (WHERE status = 'out-of-service') AS "oosVehicles",
          COUNT(*) FILTER (WHERE next_pm_due <= CURRENT_DATE + INTERVAL '30 days') AS "vehiclesNeedingMaintenance"
        FROM (${vehicleSqlPg}) scoped_vehicles`, params),

      loads: hasLoads
        ? query(`SELECT
            COUNT(*) FILTER (WHERE UPPER(status::text) IN ('IN_TRANSIT', 'IN-TRANSIT')) AS "activeLoads",
            COUNT(*) FILTER (WHERE UPPER(status::text) IN ('NEW', 'PENDING')) AS "pendingLoads",
            COUNT(*) FILTER (WHERE UPPER(status::text) IN ('DELIVERED', 'COMPLETED') AND DATE(COALESCE(completed_date, delivery_date, created_at)) = CURRENT_DATE) AS "completedLoadsToday",
            COUNT(*) FILTER (WHERE UPPER(REPLACE(status::text, ' ', '_')) = 'DISPATCHED') AS "loadsDispatched",
            COUNT(*) FILTER (WHERE UPPER(REPLACE(status::text, ' ', '_')) IN ('IN_TRANSIT', 'EN_ROUTE', 'PICKED_UP')) AS "loadsInTransit",
            COUNT(*) FILTER (WHERE UPPER(status::text) IN ('DELIVERED', 'COMPLETED')) AS "loadsDelivered",
            COUNT(*) FILTER (WHERE UPPER(status::text) IN ('CANCELLED', 'CANCELED')) AS "loadsCanceled"
          FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2)`, params)
        : Promise.resolve({ rows: [{ activeLoads: 0, pendingLoads: 0, completedLoadsToday: 0, loadsDispatched: 0, loadsInTransit: 0, loadsDelivered: 0, loadsCanceled: 0 }] }),

      billing: hasLoads
        ? query(`SELECT
            COUNT(*) FILTER (WHERE UPPER(REPLACE(COALESCE(billing_status::text, 'PENDING'), ' ', '_')) = 'PENDING') AS "billingPending",
            COUNT(*) FILTER (WHERE UPPER(REPLACE(COALESCE(billing_status::text, 'PENDING'), ' ', '_')) IN ('CANCELLED', 'CANCELED')) AS "billingCanceled",
            COUNT(*) FILTER (WHERE UPPER(REPLACE(COALESCE(billing_status::text, 'PENDING'), ' ', '_')) IN ('BOL_RECEIVED', 'INVOICED', 'SENT_TO_FACTORING')) AS "billingInvoiced",
            COUNT(*) FILTER (WHERE UPPER(REPLACE(COALESCE(billing_status::text, 'PENDING'), ' ', '_')) = 'FUNDED') AS "billingFunded",
            COUNT(*) FILTER (WHERE UPPER(REPLACE(COALESCE(billing_status::text, 'PENDING'), ' ', '_')) = 'PAID') AS "billingPaid"
          FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2)`, params)
        : Promise.resolve({ rows: [{ billingPending: 0, billingCanceled: 0, billingInvoiced: 0, billingFunded: 0, billingPaid: 0 }] }),

      hos: hasHosRecords && hasDrivers
        ? query(`SELECT
            COUNT(*) FILTER (WHERE array_length(hr.violations, 1) > 0) AS "hosViolations",
            COUNT(*) FILTER (WHERE hr.status = 'warning') AS "hosWarnings"
          FROM hos_records hr JOIN drivers d ON d.id = hr.driver_id
          WHERE d.tenant_id = $1 AND ($2::uuid IS NULL OR d.operating_entity_id = $2)`, params)
        : Promise.resolve({ rows: [{ hosViolations: 0, hosWarnings: 0 }] }),

      compliance: hasDrivers
        ? query(`SELECT
            COALESCE(ROUND(AVG(dqf_completeness)), 0) AS "dqfComplianceRate",
            COUNT(*) FILTER (WHERE medical_cert_expiry <= CURRENT_DATE) AS "expiredMedCerts",
            COUNT(*) FILTER (WHERE medical_cert_expiry > CURRENT_DATE AND medical_cert_expiry <= CURRENT_DATE + INTERVAL '30 days') AS "upcomingMedCerts",
            COUNT(*) FILTER (WHERE cdl_expiry <= CURRENT_DATE) AS "expiredCDLs",
            COUNT(*) FILTER (WHERE clearinghouse_status != 'eligible') AS "clearinghouseIssues"
          FROM drivers WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2)`, params)
        : Promise.resolve({ rows: [{ dqfComplianceRate: 0, expiredMedCerts: 0, upcomingMedCerts: 0, expiredCDLs: 0, clearinghouseIssues: 0 }] })
    };

    // Default zeros for each group (used when a group fails)
    const groupDefaults = {
      drivers: { activeDrivers: 0, totalDrivers: 0 },
      vehicles: { activeVehicles: 0, totalVehicles: 0, oosVehicles: 0, vehiclesNeedingMaintenance: 0 },
      loads: { activeLoads: 0, pendingLoads: 0, completedLoadsToday: 0, loadsDispatched: 0, loadsInTransit: 0, loadsDelivered: 0, loadsCanceled: 0 },
      billing: { billingPending: 0, billingCanceled: 0, billingInvoiced: 0, billingFunded: 0, billingPaid: 0 },
      hos: { hosViolations: 0, hosWarnings: 0 },
      compliance: { dqfComplianceRate: 0, expiredMedCerts: 0, upcomingMedCerts: 0, expiredCDLs: 0, clearinghouseIssues: 0 }
    };

    const groupNames = Object.keys(groups);
    const results = await Promise.allSettled(Object.values(groups));

    const statsData = {};
    const degradedGroups = [];

    results.forEach((result, idx) => {
      const groupName = groupNames[idx];
      if (result.status === 'fulfilled') {
        const row = result.value?.rows?.[0] || groupDefaults[groupName];
        Object.entries(row).forEach(([k, v]) => { statsData[k] = Number(v) || 0; });
      } else {
        dtLogger.error(`Dashboard stats group "${groupName}" failed`, result.reason, {
          path: '/api/dashboard/stats',
          group: groupName
        });
        Object.assign(statsData, groupDefaults[groupName]);
        degradedGroups.push(groupName);
      }
    });

    if (degradedGroups.length > 0) {
      statsData.degraded = true;
      statsData.degradedGroups = degradedGroups;
    }

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('SELECT', 'dashboard_stats', duration, true);
    dtLogger.trackRequest('GET', '/api/dashboard/stats', 200, duration, degradedGroups.length > 0 ? { degraded: true, degradedGroups } : undefined);

    // Track key business metrics
    dtLogger.sendMetric('custom.drivers.active', statsData.activeDrivers || 0);
    dtLogger.sendMetric('custom.vehicles.active', statsData.activeVehicles || 0);
    dtLogger.sendMetric('custom.loads.active', statsData.activeLoads || 0);
    dtLogger.sendMetric('custom.hos.violations', statsData.hosViolations || 0);
    dtLogger.sendMetric('custom.compliance.dqf_rate', statsData.dqfComplianceRate || 0);

    res.json(statsData);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch dashboard stats', error, { path: '/api/dashboard/stats' });
    dtLogger.trackRequest('GET', '/api/dashboard/stats', 500, duration);
    return res.status(500).json({ message: 'Failed to fetch dashboard statistics' });
  }
});

// GET compliance alerts
router.get('/alerts', auth(['admin', 'safety']), async (req, res) => {
  try {
    const alerts = [];
    const now = new Date();
    const thirtyDaysFromNow = new Date(Date.now() + 30*24*60*60*1000);
    const tenantId = req.context?.tenantId || null;
    const operatingEntityId = req.context?.operatingEntityId || null;
    const isGlobalAdmin = !!req.context?.isGlobalAdmin;
    const vehicleSource = await resolveVehicleSource();
    const vehicleSqlKnex = buildVehicleUnionSqlKnex(vehicleSource);
    
    // Get driver compliance data
    const drivers = await db('drivers')
      .select('id', 'first_name', 'last_name', 'medical_cert_expiry', 'cdl_expiry', 'dqf_completeness', 'clearinghouse_status')
      .where('status', 'active')
      .modify((qb) => {
        if (tenantId) qb.andWhere('tenant_id', tenantId);
        if (!isGlobalAdmin && operatingEntityId) qb.andWhere('operating_entity_id', operatingEntityId);
      });
    
    drivers.forEach(driver => {
      const medExpiry = driver.medical_cert_expiry ? new Date(driver.medical_cert_expiry) : null;
      const cdlExpiry = driver.cdl_expiry ? new Date(driver.cdl_expiry) : null;
      
      if (medExpiry && medExpiry <= now) {
        alerts.push({
          type: 'critical',
          category: 'driver',
          message: `${driver.first_name} ${driver.last_name}'s medical certificate has expired`,
          driverId: driver.id,
          date: driver.medical_cert_expiry
        });
      } else if (medExpiry && medExpiry <= thirtyDaysFromNow) {
        alerts.push({
          type: 'warning',
          category: 'driver',
          message: `${driver.first_name} ${driver.last_name}'s medical certificate expires soon`,
          driverId: driver.id,
          date: driver.medical_cert_expiry
        });
      }
      
      if (cdlExpiry && cdlExpiry <= now) {
        alerts.push({
          type: 'critical',
          category: 'driver',
          message: `${driver.first_name} ${driver.last_name}'s CDL has expired`,
          driverId: driver.id,
          date: driver.cdl_expiry
        });
      }
      
      const dqf = parseInt(driver.dqf_completeness) || 0;
      if (dqf < 90) {
        alerts.push({
          type: 'warning',
          category: 'compliance',
          message: `${driver.first_name} ${driver.last_name}'s DQF is ${dqf}% complete`,
          driverId: driver.id
        });
      }
      
      if (driver.clearinghouse_status !== 'eligible') {
        alerts.push({
          type: 'critical',
          category: 'compliance',
          message: `${driver.first_name} ${driver.last_name} - Clearinghouse query pending`,
          driverId: driver.id
        });
      }
    });
    
    // Get vehicle maintenance alerts
    const vehicleBindings = vehicleSource === 'none'
      ? []
      : [tenantId, operatingEntityId, operatingEntityId];
    const vehiclesResult = await db.raw(vehicleSqlKnex, vehicleBindings);
    const vehicles = vehiclesResult?.rows || [];
    
    vehicles.forEach(vehicle => {
      if (vehicle.status === 'out-of-service' || vehicle.status === 'OOS') {
        alerts.push({
          type: 'critical',
          category: 'vehicle',
          message: `${vehicle.unit_number} is out of service: ${vehicle.oos_reason || 'Unknown reason'}`,
          vehicleId: vehicle.id
        });
      }
      
      if (vehicle.next_pm_due) {
        const pmDue = new Date(vehicle.next_pm_due);
        if (pmDue <= now) {
          alerts.push({
            type: 'critical',
            category: 'maintenance',
            message: `${vehicle.unit_number} preventive maintenance is overdue`,
            vehicleId: vehicle.id,
            date: vehicle.next_pm_due
          });
        } else if (pmDue <= thirtyDaysFromNow) {
          alerts.push({
            type: 'warning',
            category: 'maintenance',
            message: `${vehicle.unit_number} preventive maintenance due soon`,
            vehicleId: vehicle.id,
            date: vehicle.next_pm_due
          });
        }
      }
    });
    
    // Sort by type (critical first) then by date
    alerts.sort((a, b) => {
      if (a.type === 'critical' && b.type !== 'critical') return -1;
      if (a.type !== 'critical' && b.type === 'critical') return 1;
      return 0;
    });
    
    res.json(alerts);
  } catch (error) {
    console.error('Dashboard alerts error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
