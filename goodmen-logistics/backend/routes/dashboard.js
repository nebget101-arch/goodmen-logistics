const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');

// GET dashboard statistics
router.get('/stats', async (req, res) => {
  const startTime = Date.now();
  try {
    const stats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM drivers WHERE status = 'active') as "activeDrivers",
        (SELECT COUNT(*) FROM drivers) as "totalDrivers",
        (SELECT COUNT(*) FROM vehicles WHERE status = 'in-service') as "activeVehicles",
        (SELECT COUNT(*) FROM vehicles) as "totalVehicles",
        (SELECT COUNT(*) FROM vehicles WHERE status = 'out-of-service') as "oosVehicles",
        (SELECT COUNT(*) FROM loads WHERE status = 'in-transit') as "activeLoads",
        (SELECT COUNT(*) FROM loads WHERE status = 'pending') as "pendingLoads",
        (SELECT COUNT(*) FROM loads WHERE status = 'completed' AND DATE(delivery_date) = CURRENT_DATE) as "completedLoadsToday",
        (SELECT COUNT(*) FROM hos_records WHERE array_length(violations, 1) > 0) as "hosViolations",
        (SELECT COUNT(*) FROM hos_records WHERE status = 'warning') as "hosWarnings",
        (SELECT COALESCE(ROUND(AVG(dqf_completeness)), 0) FROM drivers) as "dqfComplianceRate",
        (SELECT COUNT(*) FROM vehicles WHERE next_pm_due <= CURRENT_DATE + INTERVAL '30 days') as "vehiclesNeedingMaintenance",
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
router.get('/alerts', (req, res) => {
  const alerts = [];
  const now = new Date();
  const thirtyDaysFromNow = new Date(Date.now() + 30*24*60*60*1000);
  
  // Driver compliance alerts
  drivers.forEach(driver => {
    const medExpiry = new Date(driver.medicalCertExpiry);
    const cdlExpiry = new Date(driver.cdlExpiry);
    
    if (medExpiry <= now) {
      alerts.push({
        type: 'critical',
        category: 'driver',
        message: `${driver.firstName} ${driver.lastName}'s medical certificate has expired`,
        driverId: driver.id,
        date: driver.medicalCertExpiry
      });
    } else if (medExpiry <= thirtyDaysFromNow) {
      alerts.push({
        type: 'warning',
        category: 'driver',
        message: `${driver.firstName} ${driver.lastName}'s medical certificate expires soon`,
        driverId: driver.id,
        date: driver.medicalCertExpiry
      });
    }
    
    if (cdlExpiry <= now) {
      alerts.push({
        type: 'critical',
        category: 'driver',
        message: `${driver.firstName} ${driver.lastName}'s CDL has expired`,
        driverId: driver.id,
        date: driver.cdlExpiry
      });
    }
    
    if (driver.dqfCompleteness < 90) {
      alerts.push({
        type: 'warning',
        category: 'compliance',
        message: `${driver.firstName} ${driver.lastName}'s DQF is ${driver.dqfCompleteness}% complete`,
        driverId: driver.id
      });
    }
    
    if (driver.clearinghouseStatus !== 'eligible') {
      alerts.push({
        type: 'critical',
        category: 'compliance',
        message: `${driver.firstName} ${driver.lastName} - Clearinghouse query pending`,
        driverId: driver.id
      });
    }
  });
  
  // Vehicle maintenance alerts
  vehicles.forEach(vehicle => {
    if (vehicle.status === 'out-of-service') {
      alerts.push({
        type: 'critical',
        category: 'vehicle',
        message: `${vehicle.unitNumber} is out of service: ${vehicle.oosReason || 'Unknown reason'}`,
        vehicleId: vehicle.id
      });
    }
    
    if (vehicle.nextPMDue) {
      const pmDue = new Date(vehicle.nextPMDue);
      if (pmDue <= now) {
        alerts.push({
          type: 'critical',
          category: 'maintenance',
          message: `${vehicle.unitNumber} preventive maintenance is overdue`,
          vehicleId: vehicle.id,
          date: vehicle.nextPMDue
        });
      } else if (pmDue <= thirtyDaysFromNow) {
        alerts.push({
          type: 'warning',
          category: 'maintenance',
          message: `${vehicle.unitNumber} preventive maintenance due soon`,
          vehicleId: vehicle.id,
          date: vehicle.nextPMDue
        });
      }
    }
  });
  
  // HOS violations
  hosRecords.forEach(record => {
    if (record.violations.length > 0) {
      record.violations.forEach(violation => {
        alerts.push({
          type: 'warning',
          category: 'hos',
          message: `${record.driverName}: ${violation}`,
          driverId: record.driverId,
          date: record.date
        });
      });
    }
  });
  
  // Sort by type (critical first)
  alerts.sort((a, b) => {
    if (a.type === 'critical' && b.type !== 'critical') return -1;
    if (a.type !== 'critical' && b.type === 'critical') return 1;
    return 0;
  });
  
  res.json(alerts);
});

module.exports = router;
