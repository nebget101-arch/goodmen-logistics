const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');
const auth = require('./auth-middleware');

// GET application logs (from dtLogger buffer)
router.get('/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const level = req.query.level; // Filter by level if provided

    let logs = dtLogger.getRecentLogs(limit);

    // Apply level filter if specified
    if (level && level !== 'all') {
      logs = logs.filter(log => log.level === level.toUpperCase());
    }

    res.json(logs);
  } catch (error) {
    console.error('Error fetching application logs:', error);
    res.status(500).json({ message: 'Failed to fetch application logs' });
  }
});

// GET audit trail
router.get('/trail', async (req, res) => {
  try {
    const params = [];
    const where = [];

    if (req.context && req.context.tenantId) {
      params.push(req.context.tenantId);
      where.push(`tenant_id = $${params.length}`);
    }

    if (req.context && !req.context.isGlobalAdmin && req.context.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      where.push(`operating_entity_id = $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC`;

    try {
      const result = await query(sql, params);
      res.json(result.rows);
    } catch (err) {
      // If the audit_logs table doesn't have tenant_id/operating_entity_id, fall back
      // to an unscoped trail to avoid crashing the endpoint. Log and expose a debug header.
      if (err && err.code === '42703') {
        console.warn('audit_trail_scope_missing_columns, falling back to unscoped audit trail', { error: err.message });
        res.setHeader('X-Debug-Audit-Scope', 'fallback-unscoped');
        const fallback = await query(`SELECT * FROM audit_logs ORDER BY created_at DESC`);
        return res.json(fallback.rows);
      }
      throw err;
    }
  } catch (error) {
    console.error('Error fetching audit trail:', error);
    res.status(500).json({ message: 'Failed to fetch audit trail' });
  }
});

// Protect all audit routes: admin, safety
router.use(auth(['admin', 'safety']));

// GET export data for compliance review
router.get('/export/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const { startDate, endDate } = req.query;

    let exportData = {};

    switch (category) {
      case 'dqf':
        {
          const params = [];
          const where = [];
          if (req.context && req.context.tenantId) {
            params.push(req.context.tenantId);
            where.push(`tenant_id = $${params.length}`);
          }
          if (req.context && !req.context.isGlobalAdmin && req.context.operatingEntityId) {
            params.push(req.context.operatingEntityId);
            where.push(`operating_entity_id = $${params.length}`);
          }
          const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
          const drivers = await query(`
            SELECT id, first_name, last_name, cdl_number, cdl_expiry,
                   medical_cert_expiry, hire_date, dqf_completeness, status
            FROM drivers
            ${whereClause}
            ORDER BY last_name, first_name
          `, params);

          exportData = {
            exportType: 'Driver Qualification Files',
            generatedAt: new Date().toISOString(),
            dateRange: { startDate, endDate },
            records: drivers.rows
          };
        }
        break;

      case 'hos':
        {
          const params = [];
          const where = [];
          if (req.context && req.context.tenantId) {
            params.push(req.context.tenantId);
            where.push(`d.tenant_id = $${params.length}`);
          }
          if (req.context && !req.context.isGlobalAdmin && req.context.operatingEntityId) {
            params.push(req.context.operatingEntityId);
            where.push(`d.operating_entity_id = $${params.length}`);
          }
          const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

          const hos = await query(`
            SELECT hr.*, d.first_name || ' ' || d.last_name as driver_name
            FROM hos_records hr
            JOIN drivers d ON hr.driver_id = d.id
            ${whereClause}
            ORDER BY hr.record_date DESC
          `, params);

          exportData = {
            exportType: 'Hours of Service Records',
            generatedAt: new Date().toISOString(),
            dateRange: { startDate, endDate },
            records: hos.rows,
            retentionNote: 'Records must be retained for 6 months per 49 CFR 395.8'
          };
        }
        break;

      case 'maintenance':
        {
          const params = [];
          const where = [];
          if (req.context && req.context.tenantId) {
            params.push(req.context.tenantId);
            where.push(`v.tenant_id = $${params.length}`);
          }
          if (req.context && !req.context.isGlobalAdmin && req.context.operatingEntityId) {
            params.push(req.context.operatingEntityId);
            where.push(`v.operating_entity_id = $${params.length}`);
          }
          const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

          const maintenance = await query(`
            SELECT mr.*, v.unit_number
            FROM maintenance_records mr
            JOIN all_vehicles v ON mr.vehicle_id = v.id
            ${whereClause}
            ORDER BY mr.date_performed DESC NULLS LAST
          `, params);

          exportData = {
            exportType: 'Maintenance Records',
            generatedAt: new Date().toISOString(),
            dateRange: { startDate, endDate },
            records: maintenance.rows,
            retentionNote: 'Records must be retained for 1 year per 49 CFR 396.3'
          };
        }
        break;

      case 'drug-alcohol':
        {
          const params = [];
          const where = [];
          if (req.context && req.context.tenantId) {
            params.push(req.context.tenantId);
            where.push(`d.tenant_id = $${params.length}`);
          }
          if (req.context && !req.context.isGlobalAdmin && req.context.operatingEntityId) {
            params.push(req.context.operatingEntityId);
            where.push(`d.operating_entity_id = $${params.length}`);
          }
          const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

          const drugTests = await query(`
            SELECT dt.*, d.first_name || ' ' || d.last_name as driver_name
            FROM drug_alcohol_tests dt
            JOIN drivers d ON dt.driver_id = d.id
            ${whereClause}
            ORDER BY dt.test_date DESC
          `, params);

          exportData = {
            exportType: 'Drug & Alcohol Testing Records',
            generatedAt: new Date().toISOString(),
            dateRange: { startDate, endDate },
            records: drugTests.rows,
            retentionNote: 'Records must be retained per 49 CFR 382.401 schedules',
            securityNote: 'CONFIDENTIAL - Restricted Access Only'
          };
        }
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
    // Build scoped counts honoring tenant and operating entity
    const tenantId = req.context?.tenantId || null;
    const operatingEntityId = req.context?.operatingEntityId || null;
    const isGlobalAdmin = !!req.context?.isGlobalAdmin;

    // Drivers
    const driverParams = [];
    const driverWhere = [];
    if (tenantId) {
      driverParams.push(tenantId);
      driverWhere.push(`tenant_id = $${driverParams.length}`);
    }
    if (!isGlobalAdmin && operatingEntityId) {
      driverParams.push(operatingEntityId);
      driverWhere.push(`operating_entity_id = $${driverParams.length}`);
    }
    const driverWhereClause = driverWhere.length ? `WHERE ${driverWhere.join(' AND ')}` : '';

    const totalDriversRes = await query(`SELECT COUNT(*) as count FROM drivers ${driverWhereClause}`, driverParams);
    const activeDriversRes = await query(`SELECT COUNT(*) as count FROM drivers ${driverWhereClause} ${driverWhereClause ? 'AND' : 'WHERE'} status = 'active'`, driverParams);
    const avgDqfRes = await query(`SELECT COALESCE(ROUND(AVG(dqf_completeness)), 0) as avg FROM drivers ${driverWhereClause}`, driverParams);
    const expiredMedRes = await query(`SELECT COUNT(*) as count FROM drivers ${driverWhereClause} ${driverWhereClause ? 'AND' : 'WHERE'} medical_cert_expiry <= CURRENT_DATE`, driverParams);
    const upcomingMedRes = await query(`SELECT COUNT(*) as count FROM drivers ${driverWhereClause} ${driverWhereClause ? 'AND' : 'WHERE'} medical_cert_expiry > CURRENT_DATE AND medical_cert_expiry <= CURRENT_DATE + INTERVAL '30 days'`, driverParams);

    // Vehicles (all_vehicles view)
    const vehParams = [];
    const vehWhere = [];
    if (tenantId) {
      vehParams.push(tenantId);
      vehWhere.push(`v.tenant_id = $${vehParams.length}`);
    }
    if (!isGlobalAdmin && operatingEntityId) {
      vehParams.push(operatingEntityId);
      vehWhere.push(`v.operating_entity_id = $${vehParams.length}`);
    }
    const vehWhereClause = vehWhere.length ? `WHERE ${vehWhere.join(' AND ')}` : '';
    const totalVehiclesRes = await query(`SELECT COUNT(*) as count FROM all_vehicles v ${vehWhereClause}`, vehParams);
    const inServiceRes = await query(`SELECT COUNT(*) as count FROM all_vehicles v ${vehWhereClause} ${vehWhereClause ? 'AND' : 'WHERE'} status = 'in-service'`, vehParams);
    const outServiceRes = await query(`SELECT COUNT(*) as count FROM all_vehicles v ${vehWhereClause} ${vehWhereClause ? 'AND' : 'WHERE'} status = 'out-of-service'`, vehParams);
    const maintenanceOverdueRes = await query(`SELECT COUNT(*) as count FROM all_vehicles v ${vehWhereClause} ${vehWhereClause ? 'AND' : 'WHERE'} next_pm_due <= CURRENT_DATE`, vehParams);

    // HOS records (join drivers to apply driver scoping)
    const hosParams = [];
    const hosWhere = [];
    if (tenantId) {
      hosParams.push(tenantId);
      hosWhere.push(`d.tenant_id = $${hosParams.length}`);
    }
    if (!isGlobalAdmin && operatingEntityId) {
      hosParams.push(operatingEntityId);
      hosWhere.push(`d.operating_entity_id = $${hosParams.length}`);
    }
    const hosWhereClause = hosWhere.length ? `WHERE ${hosWhere.join(' AND ')}` : '';
    const totalHosRes = await query(`SELECT COUNT(*) as count FROM hos_records hr JOIN drivers d ON hr.driver_id = d.id ${hosWhereClause}`, hosParams);
    const hosViolationsRes = await query(`SELECT COUNT(*) as count FROM hos_records hr JOIN drivers d ON hr.driver_id = d.id ${hosWhereClause} ${hosWhereClause ? 'AND' : 'WHERE'} array_length(hr.violations, 1) > 0`, hosParams);
    const hosWarningsRes = await query(`SELECT COUNT(*) as count FROM hos_records hr JOIN drivers d ON hr.driver_id = d.id ${hosWhereClause} ${hosWhereClause ? 'AND' : 'WHERE'} hr.status = 'warning'`, hosParams);
    const hosCompliantRes = await query(`SELECT COUNT(*) as count FROM hos_records hr JOIN drivers d ON hr.driver_id = d.id ${hosWhereClause} ${hosWhereClause ? 'AND' : 'WHERE'} hr.status = 'compliant'`, hosParams);

    const stats = {
      total_drivers: totalDriversRes.rows[0].count,
      active_drivers: activeDriversRes.rows[0].count,
      avg_dqf: avgDqfRes.rows[0].avg,
      expired_med_certs: expiredMedRes.rows[0].count,
      upcoming_expirations: upcomingMedRes.rows[0].count,
      total_vehicles: totalVehiclesRes.rows[0].count,
      vehicles_in_service: inServiceRes.rows[0].count,
      vehicles_oos: outServiceRes.rows[0].count,
      maintenance_overdue: maintenanceOverdueRes.rows[0].count,
      total_hos_records: totalHosRes.rows[0].count,
      hos_violations: hosViolationsRes.rows[0].count,
      hos_warnings: hosWarningsRes.rows[0].count,
      hos_compliant: hosCompliantRes.rows[0].count
    };

    // Determine display name: prefer operating entity name, fall back to tenant name
    let companyName = 'Organization';
    try {
      if (operatingEntityId) {
        const oe = await query(`SELECT name FROM operating_entities WHERE id = $1 AND is_active = true`, [operatingEntityId]);
        if (oe.rows && oe.rows[0] && oe.rows[0].name) companyName = oe.rows[0].name;
      }
      if (!companyName || companyName === 'Organization') {
        const t = await query(`SELECT name FROM tenants WHERE id = $1`, [tenantId]);
        if (t.rows && t.rows[0] && t.rows[0].name) companyName = t.rows[0].name;
      }
    } catch (err) {
      // ignore lookup errors and keep default
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      companyName,
      reportPeriod: {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
      },
      driverCompliance: {
        totalDrivers: parseInt(stats.total_drivers, 10),
        activeDrivers: parseInt(stats.active_drivers, 10),
        averageDQFCompleteness: parseInt(stats.avg_dqf, 10),
        expiredMedCerts: parseInt(stats.expired_med_certs, 10),
        upcomingExpirations: parseInt(stats.upcoming_expirations, 10)
      },
      vehicleCompliance: {
        totalVehicles: parseInt(stats.total_vehicles, 10),
        inService: parseInt(stats.vehicles_in_service, 10),
        outOfService: parseInt(stats.vehicles_oos, 10),
        maintenanceOverdue: parseInt(stats.maintenance_overdue, 10)
      },
      hosCompliance: {
        totalRecords: parseInt(stats.total_hos_records, 10),
        violations: parseInt(stats.hos_violations, 10),
        warnings: parseInt(stats.hos_warnings, 10),
        compliant: parseInt(stats.hos_compliant, 10)
      },
      recommendedActions: [
        parseInt(stats.upcoming_expirations, 10) > 0
          ? 'Schedule medical certificate renewals for drivers with upcoming expirations'
          : null,
        parseInt(stats.vehicles_oos, 10) > 0
          ? 'Address out-of-service vehicles immediately'
          : null,
        parseInt(stats.hos_violations, 10) > 0
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
