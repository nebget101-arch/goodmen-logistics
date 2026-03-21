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

// GET dashboard statistics
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

    const activeDriversExpr = hasDrivers
      ? `(SELECT COUNT(*) FROM drivers WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND status = 'active')`
      : '0';
    const totalDriversExpr = hasDrivers
      ? `(SELECT COUNT(*) FROM drivers WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2))`
      : '0';

    const activeLoadsExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(status::text) IN ('IN_TRANSIT', 'IN-TRANSIT', 'in-transit'))`
      : '0';
    const pendingLoadsExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(status::text) IN ('NEW', 'PENDING', 'pending'))`
      : '0';
    const completedLoadsTodayExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(status::text) IN ('DELIVERED', 'COMPLETED', 'completed') AND DATE(COALESCE(completed_date, delivery_date, created_at)) = CURRENT_DATE)`
      : '0';
    const loadsDispatchedExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(REPLACE(status::text, ' ', '_')) IN ('DISPATCHED'))`
      : '0';
    const loadsInTransitExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(REPLACE(status::text, ' ', '_')) IN ('IN_TRANSIT', 'EN_ROUTE', 'PICKED_UP'))`
      : '0';
    const loadsDeliveredExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(status::text) IN ('DELIVERED', 'COMPLETED', 'completed'))`
      : '0';
    const loadsCanceledExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(status::text) IN ('CANCELLED', 'CANCELED', 'cancelled', 'canceled'))`
      : '0';

    const billingPendingExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(REPLACE(COALESCE(billing_status::text, 'PENDING'), ' ', '_')) = 'PENDING')`
      : '0';
    const billingCanceledExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(REPLACE(COALESCE(billing_status::text, 'PENDING'), ' ', '_')) IN ('CANCELLED', 'CANCELED'))`
      : '0';
    const billingInvoicedExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(REPLACE(COALESCE(billing_status::text, 'PENDING'), ' ', '_')) IN ('BOL_RECEIVED', 'INVOICED', 'SENT_TO_FACTORING'))`
      : '0';
    const billingFundedExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(REPLACE(COALESCE(billing_status::text, 'PENDING'), ' ', '_')) = 'FUNDED')`
      : '0';
    const billingPaidExpr = hasLoads
      ? `(SELECT COUNT(*) FROM loads WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND UPPER(REPLACE(COALESCE(billing_status::text, 'PENDING'), ' ', '_')) = 'PAID')`
      : '0';

    const hosViolationsExpr = hasHosRecords && hasDrivers
      ? `(SELECT COUNT(*) FROM hos_records hr JOIN drivers d ON d.id = hr.driver_id WHERE d.tenant_id = $1 AND ($2::uuid IS NULL OR d.operating_entity_id = $2) AND array_length(hr.violations, 1) > 0)`
      : '0';
    const hosWarningsExpr = hasHosRecords && hasDrivers
      ? `(SELECT COUNT(*) FROM hos_records hr JOIN drivers d ON d.id = hr.driver_id WHERE d.tenant_id = $1 AND ($2::uuid IS NULL OR d.operating_entity_id = $2) AND hr.status = 'warning')`
      : '0';

    const dqfComplianceRateExpr = hasDrivers
      ? `(SELECT COALESCE(ROUND(AVG(dqf_completeness)), 0) FROM drivers WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2))`
      : '0';
    const expiredMedCertsExpr = hasDrivers
      ? `(SELECT COUNT(*) FROM drivers WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND medical_cert_expiry <= CURRENT_DATE)`
      : '0';
    const upcomingMedCertsExpr = hasDrivers
      ? `(SELECT COUNT(*) FROM drivers WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND medical_cert_expiry > CURRENT_DATE AND medical_cert_expiry <= CURRENT_DATE + INTERVAL '30 days')`
      : '0';
    const expiredCDLsExpr = hasDrivers
      ? `(SELECT COUNT(*) FROM drivers WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND cdl_expiry <= CURRENT_DATE)`
      : '0';
    const clearinghouseIssuesExpr = hasDrivers
      ? `(SELECT COUNT(*) FROM drivers WHERE tenant_id = $1 AND ($2::uuid IS NULL OR operating_entity_id = $2) AND clearinghouse_status != 'eligible')`
      : '0';

    const stats = await query(`
      SELECT 
        ${activeDriversExpr} as "activeDrivers",
        ${totalDriversExpr} as "totalDrivers",
        (SELECT COUNT(*) FROM (${vehicleSqlPg}) scoped_vehicles WHERE status = 'in-service') as "activeVehicles",
        (SELECT COUNT(*) FROM (${vehicleSqlPg}) scoped_vehicles) as "totalVehicles",
        (SELECT COUNT(*) FROM (${vehicleSqlPg}) scoped_vehicles WHERE status = 'out-of-service') as "oosVehicles",
        ${activeLoadsExpr} as "activeLoads",
        ${pendingLoadsExpr} as "pendingLoads",
        ${completedLoadsTodayExpr} as "completedLoadsToday",
        ${loadsDispatchedExpr} as "loadsDispatched",
        ${loadsInTransitExpr} as "loadsInTransit",
        ${loadsDeliveredExpr} as "loadsDelivered",
        ${loadsCanceledExpr} as "loadsCanceled",
        ${billingPendingExpr} as "billingPending",
        ${billingCanceledExpr} as "billingCanceled",
        ${billingInvoicedExpr} as "billingInvoiced",
        ${billingFundedExpr} as "billingFunded",
        ${billingPaidExpr} as "billingPaid",
        ${hosViolationsExpr} as "hosViolations",
        ${hosWarningsExpr} as "hosWarnings",
        ${dqfComplianceRateExpr} as "dqfComplianceRate",
        (SELECT COUNT(*) FROM (${vehicleSqlPg}) scoped_vehicles WHERE next_pm_due <= CURRENT_DATE + INTERVAL '30 days') as "vehiclesNeedingMaintenance",
        ${expiredMedCertsExpr} as "expiredMedCerts",
        ${upcomingMedCertsExpr} as "upcomingMedCerts",
        ${expiredCDLsExpr} as "expiredCDLs",
        ${clearinghouseIssuesExpr} as "clearinghouseIssues"
      `, [tenantId, operatingEntityId]);
    const duration = Date.now() - startTime;
    
    const statsData = stats.rows[0];
    dtLogger.trackDatabase('SELECT', 'dashboard_stats', duration, true);
    dtLogger.trackRequest('GET', '/api/dashboard/stats', 200, duration);
    
    // Track key business metrics
    dtLogger.sendMetric('custom.drivers.active', parseInt(statsData.activeDrivers) || 0);
    dtLogger.sendMetric('custom.vehicles.active', parseInt(statsData.activeVehicles) || 0);
    dtLogger.sendMetric('custom.loads.active', parseInt(statsData.activeLoads) || 0);
    dtLogger.sendMetric('custom.hos.violations', parseInt(statsData.hosViolations) || 0);
    dtLogger.sendMetric('custom.compliance.dqf_rate', parseInt(statsData.dqfComplianceRate) || 0);
    
    res.json(statsData);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch dashboard stats', error, { path: '/api/dashboard/stats' });
    dtLogger.trackRequest('GET', '/api/dashboard/stats', 500, duration);
    
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard statistics' });
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
