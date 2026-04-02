const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');

/**
 * Export / compliance-summary require more than generic login.
 * Legacy JWT uses users.role; canonical codes include safety_manager (FN-129).
 * When req.user.rbac is loaded (reporting service), allow granular safety.* or audit.*.
 */
function requireAuditExportAccess(req, res, next) {
  const role = (req.user?.role || '').toString().trim().toLowerCase();
  const legacyOk = new Set(['admin', 'company_admin', 'super_admin', 'safety', 'safety_manager']);
  if (legacyOk.has(role)) return next();

  const codes = req.user?.rbac?.permissionCodes || [];
  const hasSafetyOrAudit = codes.some(
    (c) =>
      c.startsWith('safety.incidents.') ||
      c.startsWith('safety.claims.') ||
      c === 'safety.reports.view' ||
      c === 'safety.manage' ||
      c.startsWith('audit.')
  );
  if (hasSafetyOrAudit) return next();

  return res.status(403).json({ error: 'Forbidden: insufficient permission for this audit operation' });
}

async function listScopedAuditTrail(req, res) {
  const params = [];
  const where = [];

  if (req.context && req.context.tenantId) {
    params.push(req.context.tenantId);
    where.push(`tenant_id = $${params.length}`);
  }

  if (req.context?.operatingEntityId) {
    params.push(req.context.operatingEntityId);
    where.push(`operating_entity_id = $${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC`;

  try {
    const result = await query(sql, params);
    return res.json(result.rows);
  } catch (err) {
    if (err && err.code === '42703') {
      console.warn('audit_trail_scope_missing_columns, falling back to unscoped audit trail', { error: err.message });
      res.setHeader('X-Debug-Audit-Scope', 'fallback-unscoped');
      const fallback = await query(`SELECT * FROM audit_logs ORDER BY created_at DESC`);
      return res.json(fallback.rows);
    }
    throw err;
  }
}

/**
 * @openapi
 * /api/audit/logs:
 *   get:
 *     summary: Application logs
 *     description: Returns recent in-memory application log entries from the dtLogger buffer. Optionally filter by log level.
 *     tags:
 *       - Audit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of log entries to return
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [all, INFO, WARN, ERROR, DEBUG]
 *         description: Filter logs by level (case-insensitive; 'all' returns everything)
 *     responses:
 *       200:
 *         description: Log entries returned
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   level:
 *                     type: string
 *                   message:
 *                     type: string
 *                   timestamp:
 *                     type: string
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/audit/trail:
 *   get:
 *     summary: Audit trail
 *     description: Returns audit_logs rows scoped to the caller's tenant and operating entity. Falls back to unscoped results if scope columns are missing.
 *     tags:
 *       - Audit
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Audit log entries returned
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
router.get('/trail', async (req, res) => {
  try {
    return await listScopedAuditTrail(req, res);
  } catch (error) {
    console.error('Error fetching audit trail:', error);
    res.status(500).json({ message: 'Failed to fetch audit trail' });
  }
});

/**
 * @openapi
 * /api/audit:
 *   get:
 *     summary: Audit list (alias for /trail)
 *     description: Alias endpoint that returns the same scoped audit_logs data as /api/audit/trail.
 *     tags:
 *       - Audit
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Audit log entries returned
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  try {
    return await listScopedAuditTrail(req, res);
  } catch (error) {
    console.error('Error fetching audit list:', error);
    return res.status(500).json({ message: 'Failed to fetch audit list' });
  }
});

// Sensitive audit routes: legacy roles + RBAC safety/audit permissions (FN-129)
router.use(requireAuditExportAccess);

/**
 * @openapi
 * /api/audit/export/{category}:
 *   get:
 *     summary: Compliance data export
 *     description: |
 *       Exports compliance records for a given category. Requires elevated access
 *       (admin, company_admin, super_admin, safety, safety_manager roles or RBAC safety/audit permissions).
 *
 *       Available categories:
 *       - **dqf** — Driver Qualification Files (CDL, medical cert, DQF completeness)
 *       - **hos** — Hours of Service records (6-month retention per 49 CFR 395.8)
 *       - **maintenance** — Vehicle maintenance records (1-year retention per 49 CFR 396.3)
 *       - **drug-alcohol** — Drug & Alcohol testing records (CONFIDENTIAL, per 49 CFR 382.401)
 *     tags:
 *       - Audit
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *           enum: [dqf, hos, maintenance, drug-alcohol]
 *         description: Export category
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start of date range (informational, included in response metadata)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End of date range (informational, included in response metadata)
 *     responses:
 *       200:
 *         description: Export data returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 exportType:
 *                   type: string
 *                 generatedAt:
 *                   type: string
 *                 dateRange:
 *                   type: object
 *                   properties:
 *                     startDate:
 *                       type: string
 *                     endDate:
 *                       type: string
 *                 records:
 *                   type: array
 *                   items:
 *                     type: object
 *                 retentionNote:
 *                   type: string
 *                 securityNote:
 *                   type: string
 *       400:
 *         description: Invalid export category
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/audit/compliance-summary:
 *   get:
 *     summary: Compliance summary report
 *     description: |
 *       Generates a comprehensive compliance summary covering driver compliance
 *       (total/active drivers, DQF completeness, medical cert expirations),
 *       vehicle compliance (total, in-service, out-of-service, maintenance overdue),
 *       and HOS compliance (violations, warnings, compliant records).
 *       Includes recommended remediation actions. Returns degraded (zeroed) data on error.
 *       Requires elevated access (admin, company_admin, super_admin, safety, safety_manager
 *       roles or RBAC safety/audit permissions).
 *     tags:
 *       - Audit
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Compliance summary returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 generatedAt:
 *                   type: string
 *                 companyName:
 *                   type: string
 *                 reportPeriod:
 *                   type: object
 *                   properties:
 *                     start:
 *                       type: string
 *                     end:
 *                       type: string
 *                 driverCompliance:
 *                   type: object
 *                   properties:
 *                     totalDrivers:
 *                       type: integer
 *                     activeDrivers:
 *                       type: integer
 *                     averageDQFCompleteness:
 *                       type: integer
 *                     expiredMedCerts:
 *                       type: integer
 *                     upcomingExpirations:
 *                       type: integer
 *                 vehicleCompliance:
 *                   type: object
 *                   properties:
 *                     totalVehicles:
 *                       type: integer
 *                     inService:
 *                       type: integer
 *                     outOfService:
 *                       type: integer
 *                     maintenanceOverdue:
 *                       type: integer
 *                 hosCompliance:
 *                   type: object
 *                   properties:
 *                     totalRecords:
 *                       type: integer
 *                     violations:
 *                       type: integer
 *                     warnings:
 *                       type: integer
 *                     compliant:
 *                       type: integer
 *                 recommendedActions:
 *                   type: array
 *                   items:
 *                     type: string
 *                 degraded:
 *                   type: boolean
 *                   description: Present and true when data could not be fully loaded
 *       403:
 *         description: Insufficient permissions
 */
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
    res.json({
      generatedAt: new Date().toISOString(),
      companyName: 'Organization',
      reportPeriod: {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
      },
      driverCompliance: {
        totalDrivers: 0,
        activeDrivers: 0,
        averageDQFCompleteness: 0,
        expiredMedCerts: 0,
        upcomingExpirations: 0
      },
      vehicleCompliance: {
        totalVehicles: 0,
        inService: 0,
        outOfService: 0,
        maintenanceOverdue: 0
      },
      hosCompliance: {
        totalRecords: 0,
        violations: 0,
        warnings: 0,
        compliant: 0
      },
      recommendedActions: [],
      degraded: true
    });
  }
});

module.exports = router;
