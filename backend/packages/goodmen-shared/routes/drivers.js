const express = require('express');
const router = express.Router();
const { query, getClient } = require('../internal/db');
const { transformRows, transformRow, toSnakeCase } = require('../utils/case-converter');
const dtLogger = require('../utils/logger');
const { syncTollDeviceDrivers } = require('../services/toll-device-driver-sync');
const {
  hasDriverCompensationUpdate,
  pickLatestEquipmentOwnerPercentage,
  resolveCompensationProfileEffectiveStartDate
} = require('../services/driver-compensation-profile-sync');
const authMiddleware = require('../middleware/auth-middleware');
const tenantContextMiddleware = require('../middleware/tenant-context-middleware');
const { loadUserRbac } = require('../middleware/rbac-middleware');

router.use(authMiddleware);
router.use(tenantContextMiddleware);
router.use(loadUserRbac);

function getRoleCodes(req) {
  return (req.user?.rbac?.roles || [])
    .map((role) => {
      if (typeof role === 'string') return role;
      if (role && typeof role.code === 'string') return role.code;
      return null;
    })
    .filter(Boolean);
}

function getPermissionCodes(req) {
  return (req.user?.rbac?.permissionCodes || [])
    .map((code) => (typeof code === 'string' ? code : null))
    .filter(Boolean);
}

function hasAnyRole(req, roles) {
  if (!Array.isArray(roles) || roles.length === 0) return false;
  const roleSet = new Set(getRoleCodes(req));
  return roles.some((role) => roleSet.has(role));
}

function hasAnyPermission(req, perms) {
  if (!Array.isArray(perms) || perms.length === 0) return false;
  const permissionSet = new Set(getPermissionCodes(req));
  return perms.some((perm) => permissionSet.has(perm));
}

function canWriteDrivers(req) {
  const adminSafetyRoles = ['super_admin', 'admin', 'company_admin', 'safety_manager', 'safety'];
  return hasAnyRole(req, adminSafetyRoles) || hasAnyPermission(req, ['drivers.edit', 'drivers.manage']);
}

function canViewDqfDrivers(req) {
  const adminSafetyRoles = ['super_admin', 'admin', 'company_admin', 'safety_manager', 'safety'];
  return hasAnyRole(req, adminSafetyRoles) || hasAnyPermission(req, ['dqf.view', 'dqf.edit', 'dqf.manage']);
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

// Basic mapping of common CDL state inputs to 2‑letter codes.
// This keeps the API forgiving (e.g. 'Texas', 'texas', 'tx' → 'TX')
// while enforcing the underlying VARCHAR(2) constraint.
const CDL_STATE_MAP = {
  AL: 'AL', ALABAMA: 'AL',
  AK: 'AK', ALASKA: 'AK',
  AZ: 'AZ', ARIZONA: 'AZ',
  AR: 'AR', ARKANSAS: 'AR',
  CA: 'CA', CALIFORNIA: 'CA',
  CO: 'CO', COLORADO: 'CO',
  CT: 'CT', CONNECTICUT: 'CT',
  DE: 'DE', DELAWARE: 'DE',
  FL: 'FL', FLORIDA: 'FL',
  GA: 'GA', GEORGIA: 'GA',
  HI: 'HI', HAWAII: 'HI',
  ID: 'ID', IDAHO: 'ID',
  IL: 'IL', ILLINOIS: 'IL',
  IN: 'IN', INDIANA: 'IN',
  IA: 'IA', IOWA: 'IA',
  KS: 'KS', KANSAS: 'KS',
  KY: 'KY', KENTUCKY: 'KY',
  LA: 'LA', LOUISIANA: 'LA',
  ME: 'ME', MAINE: 'ME',
  MD: 'MD', MARYLAND: 'MD',
  MA: 'MA', MASSACHUSETTS: 'MA',
  MI: 'MI', MICHIGAN: 'MI',
  MN: 'MN', MINNESOTA: 'MN',
  MS: 'MS', MISSISSIPPI: 'MS',
  MO: 'MO', MISSOURI: 'MO',
  MT: 'MT', MONTANA: 'MT',
  NE: 'NE', NEBRASKA: 'NE',
  NV: 'NV', NEVADA: 'NV',
  NH: 'NH', NEW_HAMPSHIRE: 'NH', 'NEW HAMPSHIRE': 'NH',
  NJ: 'NJ', NEW_JERSEY: 'NJ', 'NEW JERSEY': 'NJ',
  NM: 'NM', NEW_MEXICO: 'NM', 'NEW MEXICO': 'NM',
  NY: 'NY', NEW_YORK: 'NY', 'NEW YORK': 'NY',
  NC: 'NC', NORTH_CAROLINA: 'NC', 'NORTH CAROLINA': 'NC',
  ND: 'ND', NORTH_DAKOTA: 'ND', 'NORTH DAKOTA': 'ND',
  OH: 'OH', OHIO: 'OH',
  OK: 'OK', OKLAHOMA: 'OK',
  OR: 'OR', OREGON: 'OR',
  PA: 'PA', PENNSYLVANIA: 'PA',
  RI: 'RI', RHODE_ISLAND: 'RI', 'RHODE ISLAND': 'RI',
  SC: 'SC', SOUTH_CAROLINA: 'SC', 'SOUTH CAROLINA': 'SC',
  SD: 'SD', SOUTH_DAKOTA: 'SD', 'SOUTH DAKOTA': 'SD',
  TN: 'TN', TENNESSEE: 'TN',
  TX: 'TX', TEXAS: 'TX',
  UT: 'UT', UTAH: 'UT',
  VT: 'VT', VERMONT: 'VT',
  VA: 'VA', VIRGINIA: 'VA',
  WA: 'WA', WASHINGTON: 'WA',
  WV: 'WV', WEST_VIRGINIA: 'WV', 'WEST VIRGINIA': 'WV',
  WI: 'WI', WISCONSIN: 'WI',
  WY: 'WY', WYOMING: 'WY',
  DC: 'DC', 'DISTRICT OF COLUMBIA': 'DC', DISTRICT_OF_COLUMBIA: 'DC'
};

function normalizeCdlState(raw) {
  if (!raw && raw !== 0) return null;
  const s = raw.toString().trim().toUpperCase();
  if (!s) return null;
  if (CDL_STATE_MAP[s]) return CDL_STATE_MAP[s];
  // Fallback: best‑effort 2‑letter code from first two characters
  return s.slice(0, 2);
}

function normalizeCdlNumber(raw) {
  if (!raw && raw !== 0) return null;
  const s = raw.toString().trim();
  if (!s) return null;
  // Remove internal spaces for comparison / storage
  return s.replace(/\s+/g, '');
}

async function findDriverByCdl(client, state, number) {
  if (!state || !number) return null;
  const result = await client.query(
    'SELECT driver_id FROM driver_licenses WHERE cdl_state = $1 AND cdl_number = $2',
    [state, number]
  );
  return result.rows[0] || null;
}

/**
 * @openapi
 * /api/drivers:
 *   get:
 *     summary: List drivers
 *     tags:
 *       - Drivers
 *     responses:
 *       200:
 *         description: Drivers returned
 *   post:
 *     summary: Create driver
 *     tags:
 *       - Drivers
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Driver payload
 *             additionalProperties: true
 *     responses:
 *       201:
 *         description: Driver created
 */
// GET all drivers (supports view=dispatch|dqf and optional status filter)
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const view = (req.query.view || '').toString().trim().toLowerCase();
    if (view === 'dqf' && !canViewDqfDrivers(req)) {
      return res.status(403).json({ message: 'Forbidden: insufficient permission' });
    }
    const status = (req.query.status || '').toString().trim().toLowerCase();
    const hasStatus = !!status;

    let result;

    if (view === 'dqf') {
      const params = [];
      let sql = `
        SELECT
          d.id,
          d.operating_entity_id,
          oe.name AS operating_entity_name,
          d.first_name,
          d.last_name,
          d.email,
          d.phone,
          d.status,
          d.hire_date,
          d.termination_date,
          d.date_of_birth,
          d.street_address,
          d.city,
          d.state,
          d.zip_code,
          dl.cdl_number,
          dl.cdl_state,
          dl.cdl_class,
          dl.cdl_expiry,
          dc.medical_cert_expiry,
          dc.clearinghouse_status,
          COALESCE(
            d.dqf_completeness,
            (
              (CASE WHEN dl.cdl_number IS NOT NULL THEN 25 ELSE 0 END) +
              (CASE WHEN dl.cdl_expiry IS NOT NULL THEN 25 ELSE 0 END) +
              (CASE WHEN dc.medical_cert_expiry IS NOT NULL THEN 25 ELSE 0 END) +
              (CASE WHEN dc.clearinghouse_status = 'eligible' THEN 25 ELSE 0 END)
            )
          ) AS dqf_completeness
        FROM drivers d
        LEFT JOIN driver_licenses dl ON dl.driver_id = d.id
        LEFT JOIN driver_compliance dc ON dc.driver_id = d.id
        LEFT JOIN operating_entities oe ON oe.id = d.operating_entity_id
      `;
      params.push(req.context?.tenantId || null);
      sql += ` WHERE d.tenant_id = $${params.length}`;
      if (req.context?.operatingEntityId) {
        params.push(req.context.operatingEntityId);
        sql += ` AND d.operating_entity_id = $${params.length}`;
      }
      if (hasStatus) {
        params.push(status);
        sql += ` AND LOWER(d.status) = $${params.length}`;
      }
      sql += ' ORDER BY d.created_at DESC';
      result = await query(sql, params);
    } else if (view === 'dispatch') {
      const params = [];
      const vehicleSource = await resolveVehicleSource();
      const hasVehicles = vehicleSource !== 'none';
      let sql = hasVehicles
        ? `
        SELECT
          d.*,
          oe.name AS operating_entity_name,
          concat_ws(' ', d.first_name, d.last_name) AS driver_name,
          t.unit_number AS truck_unit_number,
          t.license_plate AS truck_plate_number,
          tr.unit_number AS trailer_unit_number,
          tr.license_plate AS trailer_plate_number
        FROM drivers d
        LEFT JOIN operating_entities oe ON oe.id = d.operating_entity_id
        LEFT JOIN ${vehicleSource} t ON t.id = d.truck_id
        LEFT JOIN ${vehicleSource} tr ON tr.id = d.trailer_id
      `
        : `
        SELECT
          d.*,
          oe.name AS operating_entity_name,
          concat_ws(' ', d.first_name, d.last_name) AS driver_name,
          NULL AS truck_unit_number,
          NULL AS truck_plate_number,
          NULL AS trailer_unit_number,
          NULL AS trailer_plate_number
        FROM drivers d
        LEFT JOIN operating_entities oe ON oe.id = d.operating_entity_id
      `;
      params.push(req.context?.tenantId || null);
      sql += ` WHERE d.tenant_id = $${params.length}`;
      if (req.context?.operatingEntityId) {
        params.push(req.context.operatingEntityId);
        sql += ` AND d.operating_entity_id = $${params.length}`;
      }
      if (hasStatus) {
        params.push(status);
        sql += ` AND LOWER(d.status) = $${params.length}`;
      }
      sql += ' ORDER BY d.created_at DESC';
      result = await query(sql, params);
    } else {
      // Legacy/default view – keep existing behaviour for backward compatibility
      const vehicleSource = await resolveVehicleSource();
      const hasVehicles = vehicleSource !== 'none';
      const params = [];
      let sql = hasVehicles
        ? `
        SELECT
          d.*,
          oe.name AS operating_entity_name,
          concat_ws(' ', d.first_name, d.last_name) AS driver_name,
          t.unit_number AS truck_unit_number,
          t.license_plate AS truck_plate_number,
          tr.unit_number AS trailer_unit_number,
          tr.license_plate AS trailer_plate_number
        FROM drivers d
        LEFT JOIN operating_entities oe ON oe.id = d.operating_entity_id
        LEFT JOIN ${vehicleSource} t ON t.id = d.truck_id
        LEFT JOIN ${vehicleSource} tr ON tr.id = d.trailer_id
      `
        : `
        SELECT
          d.*,
          oe.name AS operating_entity_name,
          concat_ws(' ', d.first_name, d.last_name) AS driver_name,
          NULL AS truck_unit_number,
          NULL AS truck_plate_number,
          NULL AS trailer_unit_number,
          NULL AS trailer_plate_number
        FROM drivers d
        LEFT JOIN operating_entities oe ON oe.id = d.operating_entity_id
      `;
      if (hasStatus) {
        params.push(req.context?.tenantId || null);
        params.push(status);
        sql += ` WHERE d.tenant_id = $${params.length - 1} AND LOWER(d.status) = $${params.length}`;
      } else {
        params.push(req.context?.tenantId || null);
        sql += ` WHERE d.tenant_id = $${params.length}`;
      }
      if (req.context?.operatingEntityId) {
        params.push(req.context.operatingEntityId);
        sql += ` AND d.operating_entity_id = $${params.length}`;
      }
      sql += ' ORDER BY d.created_at DESC';
      result = await query(sql, params);
    }

    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'drivers', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/drivers', 200, duration, { count: result.rows.length });
    
    res.json(transformRows(result.rows));
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch drivers', error, { path: '/api/drivers' });
    dtLogger.trackRequest('GET', '/api/drivers', 500, duration);
    
    console.error('Error fetching drivers:', error);
    res.status(500).json({ message: 'Failed to fetch drivers' });
  }
});

// GET driver by ID (simple query only so the request never hangs on JOINs or missing tables)
router.get('/:id', async (req, res) => {
  const startTime = Date.now();
  const driverId = req.params.id;
  try {
    // Enforce operating_entity scoping for single-driver fetch
    const singleParams = [driverId, req.context?.tenantId || null];
    let singleSql = `
      SELECT d.*,
        oe.mc_number AS mc_number,
        oe.name AS operating_entity_name
      FROM drivers d
      LEFT JOIN operating_entities oe ON oe.id = d.operating_entity_id
      WHERE d.id = $1 AND d.tenant_id = $2`;
    if (req.context?.operatingEntityId) {
      singleParams.push(req.context.operatingEntityId);
      singleSql += ` AND d.operating_entity_id = $3`;
    }
    const result = await query(singleSql, singleParams);
    const duration = Date.now() - startTime;
    if (result.rows.length === 0) {
      dtLogger.warn('Driver not found', { driverId });
      dtLogger.trackRequest('GET', `/api/drivers/${driverId}`, 404, duration);
      return res.status(404).json({ message: 'Driver not found' });
    }

    const asOf = new Date().toISOString().slice(0, 10);

    const payeeAssignmentResult = await query(
      `SELECT dpa.*, 
              p1.name AS primary_payee_name,
              p2.name AS additional_payee_name
       FROM driver_payee_assignments dpa
       LEFT JOIN payees p1 ON p1.id = dpa.primary_payee_id
       LEFT JOIN payees p2 ON p2.id = dpa.additional_payee_id
       WHERE dpa.driver_id = $1
         AND dpa.effective_start_date <= $2
         AND (dpa.effective_end_date IS NULL OR dpa.effective_end_date >= $2)
       ORDER BY dpa.effective_start_date DESC
       LIMIT 1`,
      [driverId, asOf]
    );

    const expenseResponsibilityResult = await query(
      // FN-569: ORDER BY created_at DESC as tiebreaker — ensures most-recently saved
      // row is returned when multiple rows share the same effective_start_date.
      `SELECT *
       FROM expense_responsibility_profiles
       WHERE driver_id = $1
         AND effective_start_date <= $2
         AND (effective_end_date IS NULL OR effective_end_date >= $2)
       ORDER BY effective_start_date DESC, created_at DESC
       LIMIT 1`,
      [driverId, asOf]
    );

    // FN-566: Fetch active compensation profile to return equipment_owner_percentage.
    // The drivers table stores pay_basis/pay_rate/pay_percentage but NOT
    // equipment_owner_percentage — that lives only on driver_compensation_profiles.
    // Use status = 'active' with date-range guard (same pattern as settlement-service.js).
    const compensationProfileResult = await query(
      `SELECT percentage_rate, equipment_owner_percentage, profile_type, pay_model, status, effective_start_date, created_at
       FROM driver_compensation_profiles
       WHERE driver_id = $1
         AND effective_start_date <= $2
       ORDER BY
         CASE WHEN status = 'active' THEN 0 ELSE 1 END,
         effective_start_date DESC,
         created_at DESC`,
      [driverId, asOf]
    );

    const driver = transformRow(result.rows[0]);
    const assignment = payeeAssignmentResult.rows[0] || null;
    const expense = expenseResponsibilityResult.rows[0] || null;
    const equipmentOwnerPercentage = pickLatestEquipmentOwnerPercentage(compensationProfileResult.rows);

    const response = {
      ...driver,
      // FN-539: truck_id and trailer_id are already included via SELECT d.* + transformRow()
      // (snake_case → camelCase) as truckId / trailerId. Explicitly surfaced here so the
      // contract is obvious to callers (e.g. load edit modal auto-fill in FN-538).
      truckId: driver.truckId || null,
      trailerId: driver.trailerId || null,

      // Payee assignment details (for edit form population)
      primaryPayeeId: assignment?.primary_payee_id || null,
      primaryPayee: assignment?.primary_payee_name || null,
      additionalPayeeId: assignment?.additional_payee_id || null,
      additionalPayee: assignment?.additional_payee_name || null,
      payeeReason: assignment?.rule_type || null,
      effectiveStart: assignment?.effective_start_date || null,
      effectiveEnd: assignment?.effective_end_date || null,

      // Expense responsibility details (for edit form population)
      fuelResponsibility: expense?.fuel_responsibility || null,
      insuranceResponsibility: expense?.insurance_responsibility || null,
      eldResponsibility: expense?.eld_responsibility || null,
      trailerRentResponsibility: expense?.trailer_rent_responsibility || null,
      tollResponsibility: expense?.toll_responsibility || null,
      repairsResponsibility: expense?.repairs_responsibility || null,

      // FN-566: Compensation profile fields — equipment_owner_percentage is not on the
      // drivers table; it must be read from the active driver_compensation_profiles record.
      equipmentOwnerPercentage
    };

    dtLogger.trackDatabase('SELECT', 'drivers', duration, true, { driverId });
    dtLogger.trackRequest('GET', `/api/drivers/${driverId}`, 200, duration);
    res.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch driver', error, { driverId });
    dtLogger.trackRequest('GET', `/api/drivers/${driverId}`, 500, duration);
    console.error('Error fetching driver:', error);
    res.status(500).json({ message: 'Failed to fetch driver' });
  }
});

// GET zip code lookup (Zippopotam.us - free, no API key)
router.get('/zip-lookup/:zipCode', async (req, res) => {
  try {
    const { zipCode } = req.params;
    if (!/^\d{5}(-\d{4})?$/.test(zipCode)) {
      return res.status(400).json({ message: 'Invalid zip code format' });
    }
    const zip5 = zipCode.slice(0, 5);
    const response = await fetch(`https://api.zippopotam.us/us/${zip5}`);
    if (!response.ok) {
      return res.status(404).json({ message: 'Zip code not found' });
    }
    const data = await response.json();
    const place = data.places?.[0];
    if (!place) {
      return res.status(404).json({ message: 'Zip code not found' });
    }
    return res.json({
      zipCode: zip5,
      city: place['place name'],
      state: place['state abbreviation']
    });
  } catch (error) {
    dtLogger.error('zip_lookup_failed', error, { zipCode: req.params.zipCode });
    return res.status(500).json({ message: 'Zip code lookup failed' });
  }
});

// POST create new driver
router.post('/', async (req, res) => {
  if (!canWriteDrivers(req)) {
    return res.status(403).json({ message: 'Forbidden: insufficient permission' });
  }
  const startTime = Date.now();
  const client = await getClient();
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      cdlNumber,
      cdlState,
      cdlClass,
      endorsements,
      cdlExpiry,
      medicalCertExpiry,
      hireDate,
      streetAddress,
      address, // backward compat
      city,
      state: driverState,
      zipCode,
      dateOfBirth,
      clearinghouseStatus,
      driverType,
      payBasis,
      payRate,
      payPercentage,
      equipmentOwnerPercentage,
      terminationDate,
      truckId,
      trailerId,
      coDriverId
    } = req.body;

    const normState = normalizeCdlState(cdlState);
    const normNumber = normalizeCdlNumber(cdlNumber);

    if (!normState || !normNumber) {
      return res.status(400).json({ message: 'CDL state and CDL number are required' });
    }

    const tenantId = req.context?.tenantId || null;
    const operatingEntityId = req.context?.operatingEntityId || null;
    if (!tenantId || !operatingEntityId) {
      return res.status(403).json({ message: 'Operating entity context is required to create a driver' });
    }

    await client.query('BEGIN');

    const existing = await findDriverByCdl(client, normState, normNumber);
    if (existing) {
      await client.query('ROLLBACK');
      const duration = Date.now() - startTime;
      dtLogger.trackRequest('POST', '/api/drivers', 409, duration, {
        existingDriverId: existing.driver_id,
        cdlState: normState,
        cdlNumber: normNumber
      });
      return res.status(409).json({
        code: 'DRIVER_EXISTS',
        message: 'Driver already exists for this CDL number and state',
        existingDriverId: existing.driver_id,
        cdlState: normState,
        cdlNumber: normNumber
      });
    }

    const insertDriver = await client.query(
      `INSERT INTO drivers (
        tenant_id,
        operating_entity_id,
        first_name,
        last_name,
        email,
        phone,
        cdl_number,
        cdl_state,
        cdl_class,
        endorsements,
        cdl_expiry,
        medical_cert_expiry,
        hire_date,
        street_address,
        city,
        state,
        zip_code,
        date_of_birth,
        clearinghouse_status,
        dqf_completeness,
        status,
        driver_type,
        pay_basis,
        pay_rate,
        pay_percentage,
        termination_date,
        truck_id,
        trailer_id,
        co_driver_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, 0, 'active',
        COALESCE($20, 'company'),
        $21,
        $22,
        $23,
        $24,
        $25,
        $26,
        $27
      )
      RETURNING *`,
      [
        tenantId,
        operatingEntityId,
        firstName,
        lastName,
        email,
        phone,
        normNumber,
        normState,
        cdlClass,
        endorsements || [],
        cdlExpiry || null,
        medicalCertExpiry || null,
        hireDate || null,
        streetAddress || address || null,
        city || null,
        driverState || null,
        zipCode || null,
        dateOfBirth || null,
        clearinghouseStatus || 'eligible',
        driverType,
        payBasis || null,
        payRate || null,
        payPercentage || null,
        terminationDate || null,
        truckId || null,
        trailerId || null,
        coDriverId || null
      ]
    );

    const driverId = insertDriver.rows[0].id;

    // Upsert into driver_licenses
    await client.query(
      `
      INSERT INTO driver_licenses (
        driver_id,
        cdl_state,
        cdl_number,
        cdl_class,
        endorsements,
        cdl_expiry
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (driver_id) DO UPDATE SET
        cdl_state = EXCLUDED.cdl_state,
        cdl_number = EXCLUDED.cdl_number,
        cdl_class = EXCLUDED.cdl_class,
        endorsements = EXCLUDED.endorsements,
        cdl_expiry = EXCLUDED.cdl_expiry
      `,
      [
        driverId,
        normState,
        normNumber,
        cdlClass || null,
        (endorsements || []).join ? (endorsements || []).join(',') : endorsements || null,
        cdlExpiry || null
      ]
    );

    // Upsert into driver_compliance
    await client.query(
      `
      INSERT INTO driver_compliance (
        driver_id,
        medical_cert_expiry,
        last_mvr_check,
        clearinghouse_status
      )
      VALUES ($1, $2, NULL, $3)
      ON CONFLICT (driver_id) DO UPDATE SET
        medical_cert_expiry = EXCLUDED.medical_cert_expiry,
        clearinghouse_status = EXCLUDED.clearinghouse_status,
        updated_at = NOW()
      `,
      [
        driverId,
        medicalCertExpiry || null,
        clearinghouseStatus || 'eligible'
      ]
    );

    // Auto-create compensation profile when any compensation field is explicitly supplied.
    if (hasDriverCompensationUpdate(req.body)) {
      const payBasisLower = (payBasis || '').toString().toLowerCase();
      const profileType = (driverType || '').toString().toLowerCase() === 'owner_operator' ? 'owner_operator' : 'driver';
      let payModel = 'per_mile';
      let centsPerMile = null;
      let percentageRate = null;
      let flatWeeklyAmount = null;
      let flatPerLoadAmount = null;

      if (payBasisLower === 'per_mile') {
        payModel = 'per_mile';
        centsPerMile = payRate;
      } else if (payBasisLower === 'percentage') {
        payModel = 'percentage';
        percentageRate = payPercentage;
      } else if (payBasisLower === 'flatpay' || payBasisLower === 'flat_weekly') {
        payModel = 'flat_weekly';
        flatWeeklyAmount = payRate;
      } else if (payBasisLower === 'flat_per_load') {
        payModel = 'flat_per_load';
        flatPerLoadAmount = payRate;
      }

      // FN-555: Validate percentage_rate + equipment_owner_percentage <= 100
      const eoPct = equipmentOwnerPercentage != null ? Number(equipmentOwnerPercentage) : null;
      if (eoPct != null) {
        if (!Number.isFinite(eoPct) || eoPct < 0 || eoPct > 100) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'equipment_owner_percentage must be between 0 and 100' });
        }
        const pctRate = Number(percentageRate) || 0;
        if (pctRate + eoPct > 100) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'percentage_rate + equipment_owner_percentage cannot exceed 100' });
        }
      }

      const effectiveStart = resolveCompensationProfileEffectiveStartDate(
        'create',
        { hire_date: hireDate },
        new Date().toISOString().slice(0, 10)
      );
      await client.query(
        `INSERT INTO driver_compensation_profiles (
          driver_id,
          profile_type,
          pay_model,
          percentage_rate,
          cents_per_mile,
          flat_weekly_amount,
          flat_per_load_amount,
          equipment_owner_percentage,
          expense_sharing_enabled,
          effective_start_date,
          effective_end_date,
          status,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, NULL, 'active', 'Auto-created from driver save')`,
        [
          driverId,
          profileType,
          payModel,
          percentageRate,
          centsPerMile,
          flatWeeklyAmount,
          flatPerLoadAmount,
          eoPct,
          effectiveStart
        ]
      );
    }

    // FN-488: Sync toll device drivers when new driver is assigned to a truck
    if (truckId) {
      const tenantIdVal = req.context?.tenantId || null;
      if (tenantIdVal) {
        await syncTollDeviceDrivers({
          client,
          tenantId: tenantIdVal,
          truckId,
          newDriverId: driverId
        });
      }
    }

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    dtLogger.trackDatabase('INSERT', 'drivers', duration, true, { driverId });
    dtLogger.trackEvent('driver.created', { driverId, name: `${firstName} ${lastName}` });
    dtLogger.trackRequest('POST', '/api/drivers', 201, duration);
    dtLogger.info('Driver created successfully', { driverId, name: `${firstName} ${lastName}` });
    
    res.status(201).json(transformRow(insertDriver.rows[0]));
  } catch (error) {
    const duration = Date.now() - startTime;
    await client.query('ROLLBACK');

    // Handle unique CDL constraint gracefully
    if (error && error.code === '23505' && error.constraint && error.constraint.includes('driver_licenses')) {
      const normState = normalizeCdlState(req.body.cdlState);
      const normNumber = normalizeCdlNumber(req.body.cdlNumber);
      const existing = await findDriverByCdl(client, normState, normNumber);
      dtLogger.trackRequest('POST', '/api/drivers', 409, duration, {
        existingDriverId: existing?.driver_id,
        cdlState: normState,
        cdlNumber: normNumber
      });
      return res.status(409).json({
        code: 'DRIVER_EXISTS',
        message: 'Driver already exists for this CDL number and state',
        existingDriverId: existing?.driver_id || null,
        cdlState: normState,
        cdlNumber: normNumber
      });
    }

    dtLogger.error('Failed to create driver', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/drivers', 500, duration);
    
    console.error('Error creating driver:', error);
    res.status(500).json({ message: 'Failed to create driver' });
  } finally {
    client.release();
  }
});

// PUT update driver
router.put('/:id', async (req, res) => {
  if (!canWriteDrivers(req)) {
    return res.status(403).json({ message: 'Forbidden: insufficient permission' });
  }
  const client = await getClient();
  try {
    const body = req.body || {};
    const fields = [];
    const values = [];
    let paramCount = 1;

    // Skip system fields that shouldn't be updated directly
    const skipFields = ['id', 'createdAt', 'updatedAt', 'created_at', 'updated_at'];
    // Only allow updating known driver columns during this phase
    const allowedDriverFields = new Set([
      'firstName',
      'lastName',
      'email',
      'phone',
      'status',
      'hireDate',
      'streetAddress',
      'city',
      'state',
      'zipCode',
      'dateOfBirth',
      'driverType',
      'payBasis',
      'payRate',
      'payPercentage',
      'terminationDate',
      'truckId',
      'trailerId',
      'coDriverId',
      // legacy / dqf-related fields (dqfCompleteness excluded — server-calculated only)
      'clearinghouseStatus'
    ]);

    Object.keys(body).forEach((key) => {
      if (
        body[key] !== undefined &&
        !skipFields.includes(key) &&
        allowedDriverFields.has(key)
      ) {
        const snakeKey = toSnakeCase(key);
        const value = body[key] === '' ? null : body[key]; // Convert empty strings to null
        fields.push(`${snakeKey} = $${paramCount}`);
        values.push(value);
        paramCount += 1;
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    await client.query('BEGIN');

    // FN-488: Capture old truck_id before update for toll device driver sync
    let oldTruckId = null;
    const hasTruckUpdate = body.truckId !== undefined || body.truck_id !== undefined;
    if (hasTruckUpdate) {
      const oldRow = await client.query(
        'SELECT truck_id FROM drivers WHERE id = $1 AND tenant_id = $2',
        [req.params.id, req.context?.tenantId || null]
      );
      oldTruckId = oldRow.rows[0]?.truck_id || null;
    }

    // Handle CDL license updates (normalized)
    const rawCdlState = body.cdlState || body.cdl_state;
    const rawCdlNumber = body.cdlNumber || body.cdl_number;
    const rawCdlClass = body.cdlClass || body.cdl_class;
    const rawEndorsements = body.endorsements;
    const rawCdlExpiry = body.cdlExpiry || body.cdl_expiry;

    const normState = normalizeCdlState(rawCdlState);
    const normNumber = normalizeCdlNumber(rawCdlNumber);

    if (normState && normNumber) {
      // Check for duplicates in other drivers
      const existing = await client.query(
        `
        SELECT driver_id
        FROM driver_licenses
        WHERE cdl_state = $1
          AND cdl_number = $2
          AND driver_id <> $3
        `,
        [normState, normNumber, req.params.id]
      );

      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'DRIVER_EXISTS',
          message: 'Driver already exists for this CDL number and state',
          existingDriverId: existing.rows[0].driver_id,
          cdlState: normState,
          cdlNumber: normNumber
        });
      }

      await client.query(
        `
        INSERT INTO driver_licenses (
          driver_id,
          cdl_state,
          cdl_number,
          cdl_class,
          endorsements,
          cdl_expiry
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (driver_id) DO UPDATE SET
          cdl_state = EXCLUDED.cdl_state,
          cdl_number = EXCLUDED.cdl_number,
          cdl_class = EXCLUDED.cdl_class,
          endorsements = EXCLUDED.endorsements,
          cdl_expiry = EXCLUDED.cdl_expiry
        `,
        [
          req.params.id,
          normState,
          normNumber,
          rawCdlClass || null,
          (rawEndorsements || []).join ? (rawEndorsements || []).join(',') : rawEndorsements || null,
          rawCdlExpiry || null
        ]
      );
    }

    // Handle compliance updates
    const medicalCertExpiry = body.medicalCertExpiry || body.medical_cert_expiry;
    const lastMvrCheck = body.lastMvrCheck || body.last_mvr_check;
    const clearinghouseStatus =
      body.clearinghouseStatus || body.clearinghouse_status;

    if (medicalCertExpiry || lastMvrCheck || clearinghouseStatus) {
      await client.query(
        `
        INSERT INTO driver_compliance (
          driver_id,
          medical_cert_expiry,
          last_mvr_check,
          clearinghouse_status
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (driver_id) DO UPDATE SET
          medical_cert_expiry = COALESCE(EXCLUDED.medical_cert_expiry, driver_compliance.medical_cert_expiry),
          last_mvr_check = COALESCE(EXCLUDED.last_mvr_check, driver_compliance.last_mvr_check),
          clearinghouse_status = COALESCE(EXCLUDED.clearinghouse_status, driver_compliance.clearinghouse_status),
          updated_at = NOW()
        `,
        [
          req.params.id,
          medicalCertExpiry || null,
          lastMvrCheck || null,
          clearinghouseStatus || null
        ]
      );
    }

    // Keep legacy drivers table in sync (dual-write)
    values.push(req.params.id);
    values.push(req.context?.tenantId || null);
    const result = await client.query(
      `UPDATE drivers SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount} AND tenant_id = $${paramCount + 1} RETURNING *`,
      values
    );

    // Auto-sync compensation profile when any compensation field is explicitly updated.
    const hasPayUpdate = hasDriverCompensationUpdate(body);
    if (hasPayUpdate && result.rows.length > 0) {
      const updatedDriver = result.rows[0];
      const payBasisLower = (updatedDriver.pay_basis || '').toString().toLowerCase();
      const profileType = (updatedDriver.driver_type || '').toString().toLowerCase() === 'owner_operator' ? 'owner_operator' : 'driver';
      let payModel = 'per_mile';
      let centsPerMile = null;
      let percentageRate = null;
      let flatWeeklyAmount = null;
      let flatPerLoadAmount = null;

      if (payBasisLower === 'per_mile') {
        payModel = 'per_mile';
        centsPerMile = updatedDriver.pay_rate;
      } else if (payBasisLower === 'percentage') {
        payModel = 'percentage';
        percentageRate = updatedDriver.pay_percentage;
      } else if (payBasisLower === 'flatpay' || payBasisLower === 'flat_weekly') {
        payModel = 'flat_weekly';
        flatWeeklyAmount = updatedDriver.pay_rate;
      } else if (payBasisLower === 'flat_per_load') {
        payModel = 'flat_per_load';
        flatPerLoadAmount = updatedDriver.pay_rate;
      }

      // FN-555: Validate percentage_rate + equipment_owner_percentage <= 100
      // FN-566: Read existing active profile's EO% BEFORE superseding it, so we can
      // preserve the value if the frontend didn't explicitly send one (timing/null issue).
      const today = new Date().toISOString().slice(0, 10);
      const existingProfileResult = await client.query(
        `SELECT equipment_owner_percentage
         FROM driver_compensation_profiles
         WHERE driver_id = $1
           AND status = 'active'
           AND effective_start_date <= $2
           AND (effective_end_date IS NULL OR effective_end_date >= $2)
         ORDER BY effective_start_date DESC, created_at DESC
         LIMIT 1`,
        [req.params.id, today]
      );
      const existingEoPct = existingProfileResult.rows[0]?.equipment_owner_percentage != null
        ? Number(existingProfileResult.rows[0].equipment_owner_percentage)
        : null;

      const rawEoPct = body.equipmentOwnerPercentage ?? body.equipment_owner_percentage;
      // Use the explicitly-sent value; fall back to the existing profile value to avoid wiping it
      const eoPct = rawEoPct != null ? Number(rawEoPct) : existingEoPct;
      if (eoPct != null) {
        if (!Number.isFinite(eoPct) || eoPct < 0 || eoPct > 100) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'equipment_owner_percentage must be between 0 and 100' });
        }
        const pctRate = Number(percentageRate) || 0;
        if (pctRate + eoPct > 100) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'percentage_rate + equipment_owner_percentage cannot exceed 100' });
        }
      }

      // Close overlapping active profiles before creating the latest snapshot row.
      await client.query(
        `UPDATE driver_compensation_profiles
         SET effective_end_date = $1, status = 'superseded', updated_at = NOW()
         WHERE driver_id = $2
           AND status = 'active'
           AND effective_start_date <= $1
           AND (effective_end_date IS NULL OR effective_end_date >= $1)`,
        [today, req.params.id]
      );

      const effectiveStart = resolveCompensationProfileEffectiveStartDate(
        'update',
        updatedDriver,
        today
      );
      await client.query(
        `INSERT INTO driver_compensation_profiles (
          driver_id,
          profile_type,
          pay_model,
          percentage_rate,
          cents_per_mile,
          flat_weekly_amount,
          flat_per_load_amount,
          equipment_owner_percentage,
          expense_sharing_enabled,
          effective_start_date,
          effective_end_date,
          status,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, NULL, 'active', 'Auto-synced from driver update')`,
        [
          req.params.id,
          profileType,
          payModel,
          percentageRate,
          centsPerMile,
          flatWeeklyAmount,
          flatPerLoadAmount,
          eoPct,
          effectiveStart
        ]
      );
    }

    // FN-488: Sync toll device drivers when truck assignment changes
    if (hasTruckUpdate && result.rows.length > 0) {
      const newTruckId = result.rows[0].truck_id;
      const tenantIdVal = req.context?.tenantId || null;

      if (tenantIdVal) {
        // Clear old truck's auto-resolved devices (driver left)
        if (oldTruckId && oldTruckId !== newTruckId) {
          await syncTollDeviceDrivers({
            client,
            tenantId: tenantIdVal,
            truckId: oldTruckId,
            newDriverId: null
          });
        }

        // Set new truck's auto-resolved devices to this driver
        if (newTruckId) {
          await syncTollDeviceDrivers({
            client,
            tenantId: tenantIdVal,
            truckId: newTruckId,
            newDriverId: req.params.id
          });
        }
      }
    }

    await client.query('COMMIT');

    if (result.rows.length > 0) {
      res.json(transformRow(result.rows[0]));
    } else {
      res.status(404).json({ message: 'Driver not found' });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating driver:', error);
    res.status(500).json({ message: 'Failed to update driver' });
  } finally {
    client.release();
  }
});

// DELETE driver
router.delete('/:id', async (req, res) => {
  if (!canWriteDrivers(req)) {
    return res.status(403).json({ message: 'Forbidden: insufficient permission' });
  }
  try {
    const result = await query('DELETE FROM drivers WHERE id = $1 AND tenant_id = $2 RETURNING *', [req.params.id, req.context?.tenantId || null]);
    if (result.rows.length > 0) {
      res.json({ message: 'Driver deleted successfully' });
    } else {
      res.status(404).json({ message: 'Driver not found' });
    }
  } catch (error) {
    console.error('Error deleting driver:', error);
    res.status(500).json({ message: 'Failed to delete driver' });
  }
});

// GET drivers with compliance issues
router.get('/compliance/issues', (req, res) => {
  const issues = drivers.filter(d => {
    const medExpiry = new Date(d.medicalCertExpiry);
    const cdlExpiry = new Date(d.cdlExpiry);
    const now = new Date();
    const thirtyDaysFromNow = new Date(Date.now() + 30*24*60*60*1000);
    
    return medExpiry <= thirtyDaysFromNow || 
           cdlExpiry <= thirtyDaysFromNow || 
           d.dqfCompleteness < 90 ||
           d.clearinghouseStatus !== 'eligible';
  });
  res.json(issues);
});

module.exports = router;
