const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');
const auth = require('./auth-middleware');
const db = require('../config/knex');

// Protect all dashboard routes: admin, safety
router.use(auth(['admin', 'safety']));

// GET dashboard statistics
router.get('/stats', async (req, res) => {
  const startTime = Date.now();
  try {
    const stats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM drivers WHERE status = 'active') as "activeDrivers",
        (SELECT COUNT(*) FROM drivers) as "totalDrivers",
        (SELECT COUNT(*) FROM all_vehicles WHERE status = 'in-service') as "activeVehicles",
        (SELECT COUNT(*) FROM all_vehicles) as "totalVehicles",
        (SELECT COUNT(*) FROM all_vehicles WHERE status = 'out-of-service') as "oosVehicles",
        (SELECT COUNT(*) FROM loads WHERE status = 'in-transit') as "activeLoads",
        (SELECT COUNT(*) FROM loads WHERE status = 'pending') as "pendingLoads",
        (SELECT COUNT(*) FROM loads WHERE status = 'completed' AND DATE(delivery_date) = CURRENT_DATE) as "completedLoadsToday",
        (SELECT COUNT(*) FROM hos_records WHERE array_length(violations, 1) > 0) as "hosViolations",
        (SELECT COUNT(*) FROM hos_records WHERE status = 'warning') as "hosWarnings",
        (SELECT COALESCE(ROUND(AVG(dqf_completeness)), 0) FROM drivers) as "dqfComplianceRate",
        (SELECT COUNT(*) FROM all_vehicles WHERE next_pm_due <= CURRENT_DATE + INTERVAL '30 days') as "vehiclesNeedingMaintenance",
        (SELECT COUNT(*) FROM drivers WHERE medical_cert_expiry <= CURRENT_DATE) as "expiredMedCerts",
        (SELECT COUNT(*) FROM drivers WHERE medical_cert_expiry > CURRENT_DATE AND medical_cert_expiry <= CURRENT_DATE + INTERVAL '30 days') as "upcomingMedCerts",
        (SELECT COUNT(*) FROM drivers WHERE cdl_expiry <= CURRENT_DATE) as "expiredCDLs",
        (SELECT COUNT(*) FROM drivers WHERE clearinghouse_status != 'eligible') as "clearinghouseIssues"
    `);
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
    
    // Get driver compliance data
    const drivers = await db('drivers')
      .select('id', 'first_name', 'last_name', 'medical_cert_expiry', 'cdl_expiry', 'dqf_completeness', 'clearinghouse_status')
      .where('status', 'active');
    
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
    const vehicles = await db('all_vehicles')
      .select('id', 'unit_number', 'status', 'oos_reason', 'next_pm_due');
    
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
