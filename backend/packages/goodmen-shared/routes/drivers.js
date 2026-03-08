const express = require('express');
const router = express.Router();
const { query, getClient } = require('../internal/db');
const { transformRows, transformRow, toSnakeCase } = require('../utils/case-converter');
const dtLogger = require('../utils/logger');

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
    const status = (req.query.status || '').toString().trim().toLowerCase();
    const hasStatus = !!status;

    let result;

    if (view === 'dqf') {
      const params = [];
      let sql = `
        SELECT
          d.id,
          d.first_name,
          d.last_name,
          d.email,
          d.phone,
          d.status,
          d.hire_date,
          d.termination_date,
          dl.cdl_number,
          dl.cdl_state,
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
      `;
      if (hasStatus) {
        params.push(status);
        sql += ` WHERE LOWER(d.status) = $${params.length}`;
      }
      sql += ' ORDER BY d.created_at DESC';
      result = await query(sql, params);
    } else if (view === 'dispatch') {
      const params = [];
      let sql = `
        SELECT
          d.*,
          t.unit_number AS truck_unit_number,
          tr.unit_number AS trailer_unit_number
        FROM drivers d
        LEFT JOIN all_vehicles t ON t.id = d.truck_id
        LEFT JOIN all_vehicles tr ON tr.id = d.trailer_id
      `;
      if (hasStatus) {
        params.push(status);
        sql += ` WHERE LOWER(d.status) = $${params.length}`;
      }
      sql += ' ORDER BY d.created_at DESC';
      result = await query(sql, params);
    } else {
      // Legacy/default view – keep existing behaviour for backward compatibility
      const params = [];
      let sql = 'SELECT * FROM drivers';
      if (hasStatus) {
        params.push(status);
        sql += ` WHERE LOWER(status) = $${params.length}`;
      }
      sql += ' ORDER BY created_at DESC';
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
    const result = await query('SELECT * FROM drivers WHERE id = $1', [driverId]);
    const duration = Date.now() - startTime;
    if (result.rows.length === 0) {
      dtLogger.warn('Driver not found', { driverId });
      dtLogger.trackRequest('GET', `/api/drivers/${driverId}`, 404, duration);
      return res.status(404).json({ message: 'Driver not found' });
    }
    dtLogger.trackDatabase('SELECT', 'drivers', duration, true, { driverId });
    dtLogger.trackRequest('GET', `/api/drivers/${driverId}`, 200, duration);
    res.json(transformRow(result.rows[0]));
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch driver', error, { driverId });
    dtLogger.trackRequest('GET', `/api/drivers/${driverId}`, 500, duration);
    console.error('Error fetching driver:', error);
    res.status(500).json({ message: 'Failed to fetch driver' });
  }
});

// POST create new driver
router.post('/', async (req, res) => {
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
      address,
      dateOfBirth,
      clearinghouseStatus,
      driverType,
      payBasis,
      payRate,
      payPercentage,
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
        address,
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
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, 0, 'active',
        COALESCE($15, 'company'),
        $16,
        $17,
        $18,
        $19,
        $20,
        $21,
        $22
      )
      RETURNING *`,
      [
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
        address,
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
      'address',
      'dateOfBirth',
      'driverType',
      'payBasis',
      'payRate',
      'payPercentage',
      'terminationDate',
      'truckId',
      'trailerId',
      'coDriverId',
      // legacy / dqf-related fields
      'dqfCompleteness',
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
    const result = await client.query(
      `UPDATE drivers SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount} RETURNING *`,
      values
    );

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
  try {
    const result = await query('DELETE FROM drivers WHERE id = $1 RETURNING *', [req.params.id]);
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
