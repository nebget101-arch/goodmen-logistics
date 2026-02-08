const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

// GET audit trail
router.get('/trail', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM audit_logs
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching audit trail:', error);
    res.status(500).json({ message: 'Failed to fetch audit trail' });
  }
});

// Old mock code below - keeping for reference
router.get('/trail-mock', (req, res) => {
  const auditLog = [
    {
      id: '1',
      timestamp: new Date(Date.now() - 2*60*60*1000).toISOString(),
      userId: 'admin@goodmenlogistics.com',
      action: 'UPDATE',
      resource: 'Driver',
      resourceId: 'mock-id',
      changes: { medicalCertExpiry: '2025-08-20' },
      ip: '192.168.1.100'
    },
    {
      id: '2',
      timestamp: new Date(Date.now() - 5*60*60*1000).toISOString(),
      userId: 'safety@goodmenlogistics.com',
      action: 'CREATE',
      resource: 'MaintenanceRecord',
      resourceId: 'mock-id',
      changes: {},
      ip: '192.168.1.101'
    },
    {
      id: '3',
      timestamp: new Date(Date.now() - 24*60*60*1000).toISOString(),
      userId: 'dispatcher@goodmenlogistics.com',
      action: 'UPDATE',
      resource: 'Load',
      resourceId: 'LD-2025-001',
      changes: { status: 'in-transit' },
      ip: '192.168.1.102'
    }
  ];
  
  res.json(auditLog);
});

// GET export data for compliance review
router.get('/export/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const { startDate, endDate } = req.query;
    
    let exportData = {};
    
    switch(category) {
      case 'dqf':
        const drivers = await query(`
          SELECT id, first_name, last_name, cdl_number, cdl_expiry,
                 medical_cert_expiry, hire_date, dqf_completeness, status
          FROM drivers
          ORDER BY last_name, first_name
        `);
        
        exportData = {
          exportType: 'Driver Qualification Files',
          generatedAt: new Date().toISOString(),
          dateRange: { startDate, endDate },
          records: drivers.rows
        };
        break;
        
      case 'hos':
        const hos = await query(`
          SELECT hr.*, d.first_name || ' ' || d.last_name as driver_name
          FROM hos_records hr
          JOIN drivers d ON hr.driver_id = d.id
          ORDER BY hr.record_date DESC
        `);
        
        exportData = {
          exportType: 'Hours of Service Records',
          generatedAt: new Date().toISOString(),
          dateRange: { startDate, endDate },
          records: hos.rows,
          retentionNote: 'Records must be retained for 6 months per 49 CFR 395.8'
        };
        break;
        
      case 'maintenance':
        const maintenance = await query(`
          SELECT mr.*, v.unit_number
          FROM maintenance_records mr
          JOIN vehicles v ON mr.vehicle_id = v.id
          ORDER BY mr.date_performed DESC NULLS LAST
        `);
        
        exportData = {
          exportType: 'Maintenance Records',
          generatedAt: new Date().toISOString(),
          dateRange: { startDate, endDate },
          records: maintenance.rows,
          retentionNote: 'Records must be retained for 1 year per 49 CFR 396.3'
        };
        break;
        
      case 'drug-alcohol':
        const drugTests = await query(`
          SELECT dt.*, d.first_name || ' ' || d.last_name as driver_name
          FROM drug_alcohol_tests dt
          JOIN drivers d ON dt.driver_id = d.id
          ORDER BY dt.test_date DESC
        `);
        
        exportData = {
          exportType: 'Drug & Alcohol Testing Records',
          generatedAt: new Date().toISOString(),
          dateRange: { startDate, endDate },
          records: drugTests.rows,
          retentionNote: 'Records must be retained per 49 CFR 382.401 schedules',
          securityNote: 'CONFIDENTIAL - Restricted Access Only'
        };
        break;
        
      default:
        return res.status(400).json({ message: 'Invalid export category' });
    }
    
    res.json(exportData);
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({ message: 'Failed to export data' });
  }
});

// GET compliance summary report
router.get('/compliance-summary', async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM drivers) as total_drivers,
        (SELECT COUNT(*) FROM drivers WHERE status = 'active') as active_drivers,
        (SELECT COALESCE(ROUND(AVG(dqf_completeness)), 0) FROM drivers) as avg_dqf,
        (SELECT COUNT(*) FROM drivers WHERE medical_cert_expiry <= CURRENT_DATE) as expired_med_certs,
        (SELECT COUNT(*) FROM drivers WHERE medical_cert_expiry > CURRENT_DATE 
         AND medical_cert_expiry <= CURRENT_DATE + INTERVAL '30 days') as upcoming_expirations,
        (SELECT COUNT(*) FROM vehicles) as total_vehicles,
        (SELECT COUNT(*) FROM vehicles WHERE status = 'in-service') as vehicles_in_service,
        (SELECT COUNT(*) FROM vehicles WHERE status = 'out-of-service') as vehicles_oos,
        (SELECT COUNT(*) FROM vehicles WHERE next_pm_due <= CURRENT_DATE) as maintenance_overdue,
        (SELECT COUNT(*) FROM hos_records) as total_hos_records,
        (SELECT COUNT(*) FROM hos_records WHERE array_length(violations, 1) > 0) as hos_violations,
        (SELECT COUNT(*) FROM hos_records WHERE status = 'warning') as hos_warnings,
        (SELECT COUNT(*) FROM hos_records WHERE status = 'compliant') as hos_compliant
    `);

    const summary = {
      generatedAt: new Date().toISOString(),
      companyName: 'Goodmen Logistics',
      reportPeriod: {
        start: new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
      },
      driverCompliance: {
        totalDrivers: parseInt(stats.rows[0].total_drivers),
        activeDrivers: parseInt(stats.rows[0].active_drivers),
        averageDQFCompleteness: parseInt(stats.rows[0].avg_dqf),
        expiredMedCerts: parseInt(stats.rows[0].expired_med_certs),
        upcomingExpirations: parseInt(stats.rows[0].upcoming_expirations)
      },
      vehicleCompliance: {
        totalVehicles: parseInt(stats.rows[0].total_vehicles),
        inService: parseInt(stats.rows[0].vehicles_in_service),
        outOfService: parseInt(stats.rows[0].vehicles_oos),
        maintenanceOverdue: parseInt(stats.rows[0].maintenance_overdue)
      },
      hosCompliance: {
        totalRecords: parseInt(stats.rows[0].total_hos_records),
        violations: parseInt(stats.rows[0].hos_violations),
        warnings: parseInt(stats.rows[0].hos_warnings),
        compliant: parseInt(stats.rows[0].hos_compliant)
      },
      recommendedActions: [
        stats.rows[0].upcoming_expirations > 0 
          ? 'Schedule medical certificate renewals for drivers with upcoming expirations'
          : null,
        stats.rows[0].vehicles_oos > 0
          ? 'Address out-of-service vehicles immediately'
          : null,
        stats.rows[0].hos_violations > 0
          ? 'Review and address HOS violations with affected drivers'
          : null
      ].filter(Boolean)
    };
    
    res.json(summary);
  } catch (error) {
    console.error('Error generating compliance summary:', error);
    res.status(500).json({ message: 'Failed to generate compliance summary' });
  }
});

module.exports = router;
