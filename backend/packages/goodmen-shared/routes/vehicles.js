
const express = require('express');
const router = express.Router();
const auth = require('./auth-middleware');
const axios = require('axios');
const dtLogger = require('../utils/logger');
const { query } = require('../internal/db');
const { getSignedDownloadUrl, deleteObject } = require('../storage/r2-storage');

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

async function relationExists(name) {
  try {
    const safe = String(name || '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!safe) return false;
    const result = await query(`SELECT to_regclass('public.${safe}') AS rel`);
    return !!result?.rows?.[0]?.rel;
  } catch {
    return false;
  }
}

async function getRelationColumns(name) {
  try {
    const safe = String(name || '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!safe) return new Set();
    const result = await query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1`,
      [safe]
    );
    return new Set((result.rows || []).map((row) => row.column_name));
  } catch {
    return new Set();
  }
}

let vehiclesColumnSetCache = null;

async function getVehiclesColumnSet() {
  if (vehiclesColumnSetCache) return vehiclesColumnSetCache;
  const result = await query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'vehicles'`
  );
  vehiclesColumnSetCache = new Set((result.rows || []).map((row) => row.column_name));
  return vehiclesColumnSetCache;
}

// Protect vehicles routes. Safety / safety_manager may create/edit trucks & trailers and unit
// documents (assign units, new equipment) — same JWT write list as fleet + admin + shop.
const VEHICLE_SHOP_ROLES = [
  'shop_manager', 'service_writer', 'service_advisor',
  'shop_clerk', 'mechanic', 'technician',
];
const VEHICLE_ADMIN_ROLES = ['admin', 'company_admin', 'super_admin'];
const VEHICLE_FLEET_ROLES = ['dispatch', 'dispatcher', 'fleet'];
const VEHICLE_SAFETY_ROLES = ['safety', 'safety_manager'];

const VEHICLE_READ_ROLES = [
  ...VEHICLE_ADMIN_ROLES,
  ...VEHICLE_SAFETY_ROLES,
  ...VEHICLE_FLEET_ROLES,
  ...VEHICLE_SHOP_ROLES,
];

const VEHICLE_WRITE_ROLES = [
  ...VEHICLE_ADMIN_ROLES,
  ...VEHICLE_SAFETY_ROLES,
  ...VEHICLE_FLEET_ROLES,
  ...VEHICLE_SHOP_ROLES,
];

function isVehicleReadHttpMethod(method) {
  const m = (method || 'GET').toString().toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

function vehiclesRoleGate(req, res, next) {
  const allowed = isVehicleReadHttpMethod(req.method) ? VEHICLE_READ_ROLES : VEHICLE_WRITE_ROLES;
  return auth(allowed)(req, res, next);
}

router.use(vehiclesRoleGate);

/**
 * @openapi
 * /api/vehicles/decode-vin/{vin}:
 *   get:
 *     summary: Decode a VIN using NHTSA vPIC
 *     description: >-
 *       Calls the NHTSA Vehicle Product Information Catalog API to decode a VIN
 *       and returns make, model, and year information.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vin
 *         required: true
 *         schema:
 *           type: string
 *         description: Vehicle Identification Number to decode
 *     responses:
 *       200:
 *         description: Decoded VIN data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 vin:
 *                   type: string
 *                 make:
 *                   type: string
 *                 model:
 *                   type: string
 *                 year:
 *                   type: string
 *       400:
 *         description: VIN is required
 *       500:
 *         description: Failed to decode VIN
 */
// GET decode VIN using NHTSA vPIC
router.get('/decode-vin/:vin', async (req, res) => {
  const startTime = Date.now();
  const vin = (req.params.vin || '').trim();
  if (!vin) {
    return res.status(400).json({ message: 'VIN is required' });
  }
  try {
    const response = await axios.get(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`
    );
    const result = response.data?.Results?.[0] || {};
    const decoded = {
      vin,
      make: result.Make || '',
      model: result.Model || '',
      year: result.ModelYear || ''
    };
    const duration = Date.now() - startTime;
    dtLogger.trackRequest('GET', `/api/vehicles/decode-vin/${vin}`, 200, duration);
    res.json(decoded);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.trackRequest('GET', `/api/vehicles/decode-vin/${vin}`, 500, duration);
    console.error('Error decoding VIN:', error);
    res.status(500).json({ message: 'Failed to decode VIN' });
  }
});

/**
 * @openapi
 * /api/vehicles/customer:
 *   post:
 *     summary: Create a customer vehicle
 *     description: >-
 *       Creates a new vehicle in the customer_vehicles table. Requires tenant context.
 *       Used for shop client vehicles that are not part of the fleet.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               unit_number:
 *                 type: string
 *               vin:
 *                 type: string
 *               make:
 *                 type: string
 *               model:
 *                 type: string
 *               year:
 *                 type: string
 *               license_plate:
 *                 type: string
 *               state:
 *                 type: string
 *               mileage:
 *                 type: integer
 *               inspection_expiry:
 *                 type: string
 *                 format: date
 *               next_pm_due:
 *                 type: string
 *                 format: date
 *               next_pm_mileage:
 *                 type: integer
 *               customer_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Customer vehicle created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       403:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
// POST create new customer vehicle
router.post('/customer', async (req, res) => {
  const startTime = Date.now();
  try {
    const tenantId = req.context?.tenantId || null;
    const {
      unit_number,
      vin,
      make,
      model,
      year,
      license_plate,
      state,
      mileage,
      inspection_expiry,
      next_pm_due,
      next_pm_mileage,
      customer_id
    } = req.body;

    if (!tenantId) {
      return res.status(403).json({ message: 'Tenant context is required to create a customer vehicle' });
    }

    // Convert empty strings to null and set VIN/unit number fallbacks
    const finalVin = (vin && vin.trim()) ? vin.trim() : (unit_number ? unit_number.slice(-4) : null);
    const finalUnitNumber = (unit_number && unit_number.trim()) ? unit_number.trim() : (finalVin ? finalVin.slice(-4) : null);
    const finalMake = (make && make.trim()) ? make.trim() : null;
    const finalModel = (model && model.trim()) ? model.trim() : null;
    const finalYear = (year && year.trim()) ? year.trim() : null;
    const finalLicensePlate = (license_plate && license_plate.trim()) ? license_plate.trim() : null;
    const finalState = (state && state.trim()) ? state.trim() : null;
    const finalMileage = mileage ? parseInt(mileage) : null;
    const finalInspectionExpiry = (inspection_expiry && inspection_expiry.trim()) ? inspection_expiry : null;
    const finalNextPmDue = (next_pm_due && next_pm_due.trim()) ? next_pm_due : null;
    const finalNextPmMileage = next_pm_mileage ? parseInt(next_pm_mileage) : null;
    const finalCustomerId = (customer_id && customer_id.trim()) ? customer_id.trim() : null;

    const result = await query(
      `INSERT INTO customer_vehicles (
        unit_number, vin, make, model, year, license_plate, state, mileage,
        inspection_expiry, next_pm_due, next_pm_mileage, customer_id, tenant_id
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING vehicle_uuid`,
      [
        finalUnitNumber, finalVin, finalMake, finalModel, finalYear, finalLicensePlate, finalState, finalMileage,
        finalInspectionExpiry, finalNextPmDue, finalNextPmMileage, finalCustomerId, tenantId
      ]
    );
    const vehicleSource = await resolveVehicleSource();
    const readBackSql = vehicleSource === 'all_vehicles'
      ? 'SELECT * FROM all_vehicles WHERE id = $1'
      : 'SELECT * FROM customer_vehicles WHERE vehicle_uuid = $1';
    const created = await query(readBackSql, [result.rows[0].vehicle_uuid]);
    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('INSERT', 'customer_vehicles', duration, true, { vehicleId: result.rows[0].vehicle_uuid });
    dtLogger.trackEvent('customer_vehicle.created', { vehicleId: result.rows[0].vehicle_uuid, unit_number, vin });
    dtLogger.trackRequest('POST', '/api/vehicles/customer', 201, duration);
    dtLogger.info('Customer vehicle created successfully', { vehicleId: result.rows[0].vehicle_uuid, unit_number });
    res.status(201).json(created.rows[0]);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to create customer vehicle', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/vehicles/customer', 500, duration);
    console.error('Error creating customer vehicle:', error);
    res.status(500).json({ message: 'Failed to create customer vehicle', error: error.message });
  }
});



// Protect all vehicles routes (duplicate guard — extended with shop roles for consistency).
router.use(auth([
  'admin', 'safety', 'dispatch',
  'shop_manager', 'service_writer', 'service_advisor',
  'shop_clerk', 'mechanic', 'technician',
]));



/**
 * @openapi
 * /api/vehicles/search:
 *   get:
 *     summary: Search vehicles by VIN
 *     description: >-
 *       Returns vehicles whose VIN contains the provided substring (case-insensitive).
 *       Results include signed download URLs for any attached file.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: vin
 *         required: true
 *         schema:
 *           type: string
 *         description: Partial or full VIN to search for
 *     responses:
 *       200:
 *         description: Matching vehicles
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       400:
 *         description: VIN query parameter is required
 *       500:
 *         description: Server error
 */
// GET vehicles by (partial) VIN
router.get('/search', async (req, res) => {
  const vin = req.query.vin;
  if (!vin || vin.length < 1) {
    return res.status(400).json({ message: 'VIN query parameter is required' });
  }
  try {
    const vehicleSource = await resolveVehicleSource();
    if (vehicleSource === 'none') return res.json([]);
    const result = await query(
      `SELECT * FROM ${vehicleSource} WHERE LOWER(vin) LIKE LOWER($1) ORDER BY unit_number`,
      [`%${vin}%`]
    );
    const data = await Promise.all(
      result.rows.map(async row => ({
        ...row,
        downloadUrl: row.file_path ? await getSignedDownloadUrl(row.file_path) : null
      }))
    );
    res.json(data);
  } catch (error) {
    console.error('Error searching vehicles by VIN:', error);
    res.status(500).json({ message: 'Failed to search vehicles by VIN' });
  }
});


/**
 * @openapi
 * /api/vehicles:
 *   get:
 *     summary: List vehicles
 *     tags:
 *       - Vehicles
 *     responses:
 *       200:
 *         description: Vehicles returned
 *   post:
 *     summary: Create vehicle
 *     tags:
 *       - Vehicles
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Vehicle payload
 *             additionalProperties: true
 *     responses:
 *       201:
 *         description: Vehicle created
 */
// GET all vehicles
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const vehicleSource = await resolveVehicleSource();
    if (vehicleSource === 'none') return res.json([]);
    const vehicleColumns = await getRelationColumns(vehicleSource);
    const hasOperatingEntityId = vehicleColumns.has('operating_entity_id');
    const hasVehicleType = vehicleColumns.has('vehicle_type');
    const hasOperatingEntitiesTable = await relationExists('operating_entities');

    const params = [];
    let sql = hasOperatingEntitiesTable && hasOperatingEntityId
      ? `
      SELECT
        av.*,
        COALESCE(av.vin, '') AS vin,
        COALESCE(av.make, '') AS make,
        COALESCE(av.model, '') AS model,
        COALESCE(av.license_plate, '') AS license_plate,
        COALESCE(av.state, '') AS state,
        COALESCE(av.unit_number, '') AS unit_number,
        oe.name AS operating_entity_name
      FROM ${vehicleSource} av
      LEFT JOIN operating_entities oe ON oe.id = av.operating_entity_id
      WHERE 1=1
    `
      : `
      SELECT
        av.*,
        COALESCE(av.vin, '') AS vin,
        COALESCE(av.make, '') AS make,
        COALESCE(av.model, '') AS model,
        COALESCE(av.license_plate, '') AS license_plate,
        COALESCE(av.state, '') AS state,
        COALESCE(av.unit_number, '') AS unit_number,
        NULL::text AS operating_entity_name
      FROM ${vehicleSource} av
      WHERE 1=1
    `;

    if (req.context?.tenantId && vehicleColumns.has('tenant_id')) {
      params.push(req.context.tenantId);
      sql += ` AND av.tenant_id = $${params.length}`;
    }

    if (req.context?.operatingEntityId && hasOperatingEntityId) {
      params.push(req.context.operatingEntityId);
      const oeParam = params.length;
      // Include vehicles tagged to this OE, tenant-wide trailers (existing behavior), and any
      // truck/trailer currently assigned to a driver in this OE (fixes empty dropdowns when
      // equipment rows have null or stale operating_entity_id but drivers still show units).
      if (hasVehicleType) {
        sql += ` AND (
      av.operating_entity_id = $${oeParam}
      OR LOWER(COALESCE(av.vehicle_type, '')) = 'trailer'
      OR EXISTS (
        SELECT 1 FROM drivers d
        WHERE d.tenant_id = av.tenant_id
          AND d.operating_entity_id = $${oeParam}
          AND d.truck_id = av.id
      )
    )`;
      } else {
        sql += ` AND (
      av.operating_entity_id = $${oeParam}
      OR EXISTS (
        SELECT 1 FROM drivers d
        WHERE d.tenant_id = av.tenant_id
          AND d.operating_entity_id = $${oeParam}
          AND (d.truck_id = av.id OR d.trailer_id = av.id)
      )
    )`;
      }
    }

    // FN-496: filter by equipment owner
    const equipmentOwnerId = req.query.equipment_owner_id;
    if (equipmentOwnerId && vehicleColumns.has('equipment_owner_id')) {
      params.push(equipmentOwnerId);
      sql += ` AND av.equipment_owner_id = $${params.length}`;
    }

    sql += vehicleColumns.has('unit_number') ? ' ORDER BY av.unit_number' : ' ORDER BY 1';
    const result = await query(sql, params);
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'all_vehicles', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/vehicles', 200, duration, { count: result.rows.length });
    
    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch vehicles', error, { path: '/api/vehicles' });
    dtLogger.trackRequest('GET', '/api/vehicles', 500, duration);
    
    console.error('Error fetching vehicles:', error);
    res.status(500).json({ message: 'Failed to fetch vehicles' });
  }
});

/**
 * @openapi
 * /api/vehicles/{id}:
 *   get:
 *     summary: Get vehicle by ID
 *     description: Returns a single vehicle by its UUID from the all_vehicles view.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Vehicle ID
 *     responses:
 *       200:
 *         description: Vehicle details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: Vehicle not found
 *       500:
 *         description: Server error
 */
// GET vehicle by ID
router.get('/:id', async (req, res) => {
  try {
    const vehicleSource = await resolveVehicleSource();
    if (vehicleSource === 'none') return res.status(404).json({ message: 'Vehicle not found' });
    const result = await query(`SELECT * FROM ${vehicleSource} WHERE id = $1`, [req.params.id]);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    console.error('Error fetching vehicle:', error);
    res.status(500).json({ message: 'Failed to fetch vehicle' });
  }
});

// POST create new vehicle
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const tenantId = req.context?.tenantId || null;
    const operatingEntityId = req.context?.operatingEntityId || null;
    const { 
      unit_number, 
      vin, 
      make, 
      model, 
      year, 
      license_plate, 
      state, 
      mileage, 
      inspection_expiry,
      next_pm_due,
      next_pm_mileage,
      insurance_expiry, 
      registration_expiry,
      oos_reason,
      vehicle_type,
      trailer_details
    } = req.body;

    if (!tenantId || !operatingEntityId) {
      return res.status(403).json({ message: 'Operating entity context is required to create a vehicle' });
    }

    const finalVin = (vin && vin.trim()) ? vin.trim() : (unit_number ? unit_number.slice(-4) : '');
    const finalUnitNumber = (unit_number && unit_number.trim()) ? unit_number.trim() : (finalVin ? finalVin.slice(-4) : '');
    const finalMake = (make && make.trim()) ? make.trim() : '';
    const finalModel = (model && model.trim()) ? model.trim() : '';
    const finalLicensePlate = (license_plate && license_plate.trim()) ? license_plate.trim() : '';
    const finalState = (state && state.trim()) ? state.trim() : '';

    const finalVehicleType = (vehicle_type && vehicle_type.trim()) ? vehicle_type.trim() : 'truck';

    const result = await query(
      `INSERT INTO vehicles (
        unit_number, vin, make, model, year, license_plate, state, mileage,
        inspection_expiry, next_pm_due, next_pm_mileage,
        insurance_expiry, registration_expiry, oos_reason, status, vehicle_type, tenant_id, operating_entity_id
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'in-service', $15, $16, $17)
       RETURNING *`,
      [
        finalUnitNumber, finalVin, finalMake, finalModel, year, finalLicensePlate, finalState, mileage || 0,
        inspection_expiry, next_pm_due, next_pm_mileage,
        insurance_expiry, registration_expiry, oos_reason, finalVehicleType, tenantId, operatingEntityId
      ]
    );

    try {
      const vehicleColumns = await getVehiclesColumnSet();
      if (vehicleColumns.has('trailer_details') && trailer_details !== undefined) {
        await query('UPDATE vehicles SET trailer_details = $1 WHERE id = $2', [trailer_details, result.rows[0].id]);
      }
    } catch (metaErr) {
      console.warn('[vehicles] trailer_details persist skipped:', metaErr?.message || metaErr);
    }

    await query('UPDATE vehicles SET company_owned = true WHERE id = $1', [result.rows[0].id]);
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('INSERT', 'vehicles', duration, true, { vehicleId: result.rows[0].id });
    dtLogger.trackEvent('vehicle.created', { vehicleId: result.rows[0].id, unit_number, vin });
    dtLogger.trackRequest('POST', '/api/vehicles', 201, duration);
    dtLogger.info('Vehicle created successfully', { vehicleId: result.rows[0].id, unit_number });
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to create vehicle', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/vehicles', 500, duration);
    
    console.error('Error creating vehicle:', error);
    res.status(500).json({ message: 'Failed to create vehicle', error: error.message });
  }
});

/**
 * @openapi
 * /api/vehicles/{id}:
 *   put:
 *     summary: Update a vehicle
 *     description: >-
 *       Updates vehicle fields dynamically. Falls back to customer_vehicles table
 *       if the vehicle is not found in the internal vehicles table.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Vehicle ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Any vehicle column as a key-value pair
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Vehicle updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: No fields to update
 *       404:
 *         description: Vehicle not found
 *       500:
 *         description: Server error
 */
// PUT update vehicle
router.put('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const vehicleColumns = await getVehiclesColumnSet();
    // Fields that should not be updated
    const excludedFields = ['id', 'created_at', 'updated_at', 'customer_id', 'source'];
    
    // String fields that must never be null in the database
    const nullSafeStringFields = new Set(['vin', 'make', 'model', 'license_plate', 'state', 'unit_number']);

    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined && !excludedFields.includes(key) && vehicleColumns.has(key)) {
        fields.push(`${key} = $${paramCount}`);
        let val = req.body[key];
        if (nullSafeStringFields.has(key) && (val === null || val === undefined)) {
          val = '';
        }
        values.push(val);
        paramCount++;
      }
    });
    
    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }
    
    values.push(req.params.id);
    
    const result = await query(
      `UPDATE vehicles SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $${paramCount} 
       RETURNING *`, 
      values
    );
    
    const duration = Date.now() - startTime;
    
    if (result.rows.length > 0) {
      dtLogger.trackDatabase('UPDATE', 'vehicles', duration, true, { vehicleId: req.params.id });
      dtLogger.trackEvent('vehicle.updated', { vehicleId: req.params.id, fieldsUpdated: fields.length });
      dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 200, duration);
      
      res.json(result.rows[0]);
    } else {
      const customerAllowed = new Set([
        'unit_number',
        'vin',
        'make',
        'model',
        'year',
        'license_plate',
        'state',
        'mileage',
        'inspection_expiry',
        'next_pm_due',
        'next_pm_mileage',
        'insurance_expiry',
        'customer_id'
      ]);
      const customerFields = [];
      const customerValues = [];
      let customerParamCount = 1;
      Object.keys(req.body).forEach(key => {
        if (req.body[key] !== undefined && customerAllowed.has(key)) {
          customerFields.push(`${key} = $${customerParamCount}`);
          customerValues.push(req.body[key]);
          customerParamCount++;
        }
      });
      if (customerFields.length === 0) {
        dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 404, duration);
        return res.status(404).json({ message: 'Vehicle not found' });
      }
      customerValues.push(req.params.id);
      const customerUpdate = await query(
        `UPDATE customer_vehicles SET ${customerFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE vehicle_uuid = $${customerFields.length + 1}
         RETURNING *`,
        customerValues
      );
      if (customerUpdate.rows.length > 0) {
        dtLogger.trackDatabase('UPDATE', 'customer_vehicles', duration, true, { vehicleId: req.params.id });
        dtLogger.trackEvent('customer_vehicle.updated', { vehicleId: req.params.id, fieldsUpdated: customerFields.length });
        dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 200, duration);
        return res.json(customerUpdate.rows[0]);
      }
      dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to update vehicle', error, { vehicleId: req.params.id, body: req.body });
    dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 500, duration);
    
    console.error('Error updating vehicle:', error);
    res.status(500).json({ message: 'Failed to update vehicle', error: error.message });
  }
});

/**
 * @openapi
 * /api/vehicles/{id}:
 *   delete:
 *     summary: Delete a vehicle
 *     description: >-
 *       Deletes a vehicle from the internal vehicles table or the customer_vehicles table.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Vehicle ID
 *     responses:
 *       200:
 *         description: Vehicle deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       404:
 *         description: Vehicle not found
 *       500:
 *         description: Server error
 */
// DELETE vehicle
router.delete('/:id', async (req, res) => {
  try {
    const internal = await query('DELETE FROM vehicles WHERE id = $1 RETURNING *', [req.params.id]);
    if (internal.rows.length > 0) {
      return res.json({ message: 'Vehicle deleted successfully' });
    }
    const customer = await query('DELETE FROM customer_vehicles WHERE vehicle_uuid = $1 RETURNING *', [req.params.id]);
    if (customer.rows.length > 0) {
      return res.json({ message: 'Vehicle deleted successfully' });
    }
    res.status(404).json({ message: 'Vehicle not found' });
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    res.status(500).json({ message: 'Failed to delete vehicle' });
  }
});

/**
 * @openapi
 * /api/vehicles/maintenance/needed:
 *   get:
 *     summary: List vehicles needing maintenance
 *     description: >-
 *       Returns vehicles whose next PM due date is within 30 days or whose
 *       status is out-of-service.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Vehicles needing maintenance
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
// GET vehicles needing maintenance
router.get('/maintenance/needed', async (req, res) => {
  try {
    const vehicleSource = await resolveVehicleSource();
    if (vehicleSource === 'none') return res.json([]);
    const result = await query(`
      SELECT * FROM ${vehicleSource} 
      WHERE next_pm_due <= CURRENT_DATE + INTERVAL '30 days' 
         OR status = 'out-of-service'
      ORDER BY next_pm_due
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vehicles needing maintenance:', error);
    res.status(500).json({ message: 'Failed to fetch vehicles needing maintenance' });
  }
});

/**
 * @openapi
 * /api/vehicles/{id}/documents:
 *   get:
 *     summary: List vehicle documents
 *     description: Returns all documents attached to the specified vehicle, ordered by creation date descending.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Vehicle ID
 *     responses:
 *       200:
 *         description: List of vehicle documents
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
// GET vehicle documents
router.get('/:id/documents', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM vehicle_documents WHERE vehicle_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vehicle documents:', error);
    res.status(500).json({ message: 'Failed to fetch vehicle documents' });
  }
});

/**
 * @openapi
 * /api/vehicles/{id}/documents:
 *   post:
 *     summary: Upload a vehicle document
 *     description: >-
 *       Creates a vehicle document record with an R2 storage key. The file must
 *       already be uploaded to R2; this endpoint records the metadata. Returns
 *       the document with a signed download URL.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Vehicle ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - file_path
 *             properties:
 *               document_type:
 *                 type: string
 *               file_name:
 *                 type: string
 *               file_path:
 *                 type: string
 *                 description: R2 object key
 *               file_size:
 *                 type: integer
 *               mime_type:
 *                 type: string
 *               expiry_date:
 *                 type: string
 *                 format: date
 *               uploaded_by:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Document record created with download URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: file_path is required
 *       500:
 *         description: Server error
 */
// POST upload vehicle document
router.post('/:id/documents', async (req, res) => {
  const startTime = Date.now();
  try {
    const { document_type, file_name, file_path, file_size, mime_type, expiry_date, uploaded_by, notes } = req.body;
    if (!file_path) {
      return res.status(400).json({ message: 'file_path (R2 object key) is required' });
    }
    
    const result = await query(
      `INSERT INTO vehicle_documents (
        vehicle_id, document_type, file_name, file_path, file_size, 
        mime_type, expiry_date, uploaded_by, notes
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [req.params.id, document_type, file_name, file_path, file_size, mime_type, expiry_date, uploaded_by, notes]
    );
    
    const duration = Date.now() - startTime;
    dtLogger.trackEvent('vehicle.document.uploaded', { 
      vehicleId: req.params.id, 
      documentType: document_type,
      fileName: file_name 
    });
    dtLogger.trackRequest('POST', `/api/vehicles/${req.params.id}/documents`, 201, duration);
    
    const doc = result.rows[0];
    const downloadUrl = await getSignedDownloadUrl(doc.file_path);
    res.status(201).json({ ...doc, downloadUrl });
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to upload vehicle document', error, { vehicleId: req.params.id });
    dtLogger.trackRequest('POST', `/api/vehicles/${req.params.id}/documents`, 500, duration);
    
    console.error('Error uploading vehicle document:', error);
    res.status(500).json({ message: 'Failed to upload vehicle document', error: error.message });
  }
});

/**
 * @openapi
 * /api/vehicles/{id}/documents/{documentId}:
 *   delete:
 *     summary: Delete a vehicle document
 *     description: >-
 *       Deletes the document record and removes the file from R2 storage.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Vehicle ID
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
// DELETE vehicle document
router.delete('/:id/documents/:documentId', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM vehicle_documents WHERE id = $1 AND vehicle_id = $2 RETURNING *',
      [req.params.documentId, req.params.id]
    );
    
    if (result.rows.length > 0) {
      const deletedDoc = result.rows[0];
      if (deletedDoc?.file_path) {
        await deleteObject(deletedDoc.file_path);
      }
      dtLogger.trackEvent('vehicle.document.deleted', { 
        vehicleId: req.params.id, 
        documentId: req.params.documentId 
      });
      res.json({ message: 'Document deleted successfully' });
    } else {
      res.status(404).json({ message: 'Document not found' });
    }
  } catch (error) {
    console.error('Error deleting vehicle document:', error);
    res.status(500).json({ message: 'Failed to delete vehicle document' });
  }
});

// Expose for unit tests (FN-133 regression)
router.VEHICLE_READ_ROLES = VEHICLE_READ_ROLES;
router.VEHICLE_WRITE_ROLES = VEHICLE_WRITE_ROLES;
router.isVehicleReadHttpMethod = isVehicleReadHttpMethod;

module.exports = router;
