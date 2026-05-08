
const express = require('express');
const router = express.Router();
const auth = require('./auth-middleware');
const axios = require('axios');
const dtLogger = require('../utils/logger');
const { query } = require('../internal/db');
const { getSignedDownloadUrl, deleteObject } = require('../storage/r2-storage');
const { loadUserRbac, requirePermission } = require('../middleware/rbac-middleware');
const { getVehicleMaintenanceHistory } = require('../services/vehicles-maintenance-history.service');
const {
  clampWindowDays,
  getRepairHistorySummary
} = require('../services/vehicle-repair-history.service');

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

// FN-1386: ownership classification — `vehicles.ownership_type` enum
// (added by FN-1385). Settlements still rely on `company_owned`, so we
// keep both in sync on save.
const OWNERSHIP_TYPES = ['company', 'oo', 'leased'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate ownership_type and the conditional fields it requires.
 * Returns null if valid, or an error string describing the first problem.
 * Only enforced when `ownership_type` is supplied (PUT may patch other fields
 * without touching ownership).
 */
function validateOwnership(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.ownership_type === undefined || body.ownership_type === null || body.ownership_type === '') {
    return null;
  }
  const ownershipType = String(body.ownership_type);
  if (!OWNERSHIP_TYPES.includes(ownershipType)) {
    return `Invalid ownership_type '${ownershipType}'. Expected one of: ${OWNERSHIP_TYPES.join(', ')}`;
  }
  if (ownershipType === 'oo') {
    if (!isNonEmptyString(body.equipment_owner_name)) {
      return 'equipment_owner_name is required when ownership_type is "oo"';
    }
  }
  if (ownershipType === 'leased') {
    const topLevel = isNonEmptyString(body.lessor_name);
    const trailerNested = body.trailer_details
      && typeof body.trailer_details === 'object'
      && isNonEmptyString(body.trailer_details.lessor_name);
    if (!topLevel && !trailerNested) {
      return 'lessor_name (top-level for trucks) or trailer_details.lessor_name (trailers) is required when ownership_type is "leased"';
    }
  }
  return null;
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
 *               shop_client_id:
 *                 type: string
 *                 format: uuid
 *                 description: Canonical FK to shop_clients. `customer_id` is accepted as a transitional alias.
 *               customer_id:
 *                 type: string
 *                 format: uuid
 *                 deprecated: true
 *                 description: Legacy alias for `shop_client_id`. Mapped to `shop_client_id` server-side.
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
      shop_client_id,
      customer_id
    } = req.body;
    const shopClientIdInput = shop_client_id ?? customer_id;

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
    const finalShopClientId = (shopClientIdInput && String(shopClientIdInput).trim())
      ? String(shopClientIdInput).trim()
      : null;

    const result = await query(
      `INSERT INTO customer_vehicles (
        unit_number, vin, make, model, year, license_plate, state, mileage,
        inspection_expiry, next_pm_due, next_pm_mileage, shop_client_id, tenant_id
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING vehicle_uuid`,
      [
        finalUnitNumber, finalVin, finalMake, finalModel, finalYear, finalLicensePlate, finalState, finalMileage,
        finalInspectionExpiry, finalNextPmDue, finalNextPmMileage, finalShopClientId, tenantId
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
 *     parameters:
 *       - in: query
 *         name: equipment_owner_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: ownership_type
 *         schema:
 *           type: string
 *           enum: [company, oo, leased]
 *         description: FN-1386 — filter by ownership classification
 *     responses:
 *       200:
 *         description: Vehicles returned
 *       400:
 *         description: Invalid filter value
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
 *             properties:
 *               ownership_type:
 *                 type: string
 *                 enum: [company, oo, leased]
 *                 description: FN-1386 — required when caller wants OO/Leased classification
 *               equipment_owner_name:
 *                 type: string
 *                 description: Required when ownership_type is "oo"
 *               lessor_name:
 *                 type: string
 *                 description: Required when ownership_type is "leased" (truck path)
 *     responses:
 *       201:
 *         description: Vehicle created
 *       400:
 *         description: Validation failed (ownership_type/equipment_owner_name/lessor_name)
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
        oe.name AS operating_entity_name,
        oe.dot_number AS operating_entity_dot_number
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
        NULL::text AS operating_entity_name,
        NULL::text AS operating_entity_dot_number
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

    // FN-1386: filter by ownership classification (company | oo | leased)
    const ownershipFilter = req.query.ownership_type;
    if (ownershipFilter !== undefined && ownershipFilter !== '') {
      if (!OWNERSHIP_TYPES.includes(String(ownershipFilter))) {
        return res.status(400).json({
          message: `Invalid ownership_type '${ownershipFilter}'. Expected one of: ${OWNERSHIP_TYPES.join(', ')}`
        });
      }
      if (vehicleColumns.has('ownership_type')) {
        params.push(ownershipFilter);
        sql += ` AND av.ownership_type = $${params.length}`;
      }
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

// FN-1303: parse `?limit=N` for the briefing risk-top route. Default 1,
// clamp to [1, 25], reject anything non-numeric so callers get 400.
function parseRiskTopLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return 1;
  const trimmed = String(raw).trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(1, Math.min(25, n));
}

/**
 * @openapi
 * /api/vehicles/risk/top:
 *   get:
 *     summary: Top-N vehicles by composite maintenance risk (FN-1303)
 *     description: >
 *       Composite "risk" score derived from pending maintenance, overdue
 *       service intervals, and recent high-priority work. Used by the Daily
 *       AI Briefing aggregator. Tenant-scoped via `req.context.tenantId`
 *       when the underlying `vehicles` table has the column.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 25
 *         description: Number of vehicles to return (default 1, max 25)
 *     responses:
 *       200:
 *         description: Top-risk vehicle list
 *       400:
 *         description: Invalid limit
 *       500:
 *         description: Server error
 */
router.get('/risk/top', async (req, res) => {
  const limit = parseRiskTopLimit(req.query.limit);
  if (limit === null) {
    return res.status(400).json({ success: false, error: 'Invalid limit; expected positive integer' });
  }

  try {
    const vehicleSource = await resolveVehicleSource();
    if (vehicleSource === 'none') return res.json({ success: true, data: [] });
    const hasMaintenance = await relationExists('maintenance_records');
    if (!hasMaintenance) return res.json({ success: true, data: [] });

    const vehicleColumns = await getRelationColumns(vehicleSource);
    const hasTenantCol = vehicleColumns.has('tenant_id');
    const hasUnitNumber = vehicleColumns.has('unit_number');

    const params = [];
    params.push(req.context?.tenantId || null);
    const tenantIdx = params.length;
    params.push(limit);
    const limitIdx = params.length;

    const tenantPredicate = hasTenantCol
      ? `(v.tenant_id = $${tenantIdx} OR $${tenantIdx}::uuid IS NULL)`
      : '$' + tenantIdx + '::uuid IS NULL OR TRUE'; // no-op when vehicles has no tenant scoping yet

    const sql = `
      WITH maint AS (
        SELECT
          mr.vehicle_id,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(mr.status, '')) = 'pending')::int AS pending_count,
          COUNT(*) FILTER (
            WHERE mr.next_service_due IS NOT NULL
              AND mr.next_service_due < NOW()::date
              AND LOWER(COALESCE(mr.status, '')) <> 'completed'
          )::int AS overdue_count,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(mr.priority, '')) IN ('high', 'critical', 'urgent')
              AND mr.created_at >= NOW() - INTERVAL '30 days'
          )::int AS breakdown_count
        FROM maintenance_records mr
        GROUP BY mr.vehicle_id
      )
      SELECT
        v.id AS vehicle_id,
        ${hasUnitNumber ? 'v.unit_number' : "''::text AS unit_number"}${hasUnitNumber ? '' : ''},
        COALESCE(m.pending_count, 0) AS pending_count,
        COALESCE(m.overdue_count, 0) AS overdue_count,
        COALESCE(m.breakdown_count, 0) AS breakdown_count
      FROM ${vehicleSource} v
      LEFT JOIN maint m ON m.vehicle_id = v.id
      WHERE ${tenantPredicate}
        AND (
          COALESCE(m.pending_count, 0) > 0
          OR COALESCE(m.overdue_count, 0) > 0
          OR COALESCE(m.breakdown_count, 0) > 0
        )
      ORDER BY (
        LEAST(60, COALESCE(m.pending_count, 0) * 15)
        + LEAST(60, COALESCE(m.overdue_count, 0) * 20)
        + LEAST(50, COALESCE(m.breakdown_count, 0) * 25)
      ) DESC
      LIMIT $${limitIdx}
    `;

    const result = await query(sql, params);
    const data = result.rows.map((row) => {
      const factors = {
        overdue_maintenance: Math.min(60, (Number(row.overdue_count) || 0) * 20),
        pending_maintenance: Math.min(60, (Number(row.pending_count) || 0) * 15),
        recent_breakdowns: Math.min(50, (Number(row.breakdown_count) || 0) * 25)
      };
      const composite = Math.min(
        100,
        factors.overdue_maintenance + factors.pending_maintenance + factors.recent_breakdowns
      );
      let topFactor = null;
      let bestVal = -Infinity;
      for (const [k, v] of Object.entries(factors)) {
        if (v > bestVal) { bestVal = v; topFactor = k; }
      }
      if (bestVal <= 0) topFactor = null;
      return {
        vehicleId: row.vehicle_id,
        unitNumber: row.unit_number || '',
        riskScore: composite,
        topFactor
      };
    });
    return res.json({ success: true, data });
  } catch (error) {
    const code = error?.code ? String(error.code) : '';
    const message = error?.message ? String(error.message) : '';
    if (code === '42P01' || message.includes('does not exist')) {
      dtLogger.warn?.('vehicles_risk_top_table_missing', { message });
      return res.json({ success: true, data: [] });
    }
    dtLogger.error('vehicles_risk_top_failed', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch top vehicle risk' });
  }
});

// FN-1309: parse `?limit=N` for the Smart Alerts upstream routes. Default 20,
// clamp to [1, 100], reject anything non-numeric so callers get 400.
function parseAlertsTopLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return 20;
  const trimmed = String(raw).trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(1, Math.min(100, n));
}

/**
 * @openapi
 * /api/vehicles/inspections/overdue:
 *   get:
 *     summary: Vehicles with an overdue annual/DOT inspection (FN-1309)
 *     description: >
 *       Returns vehicles whose `inspection_expiry` date is in the past.
 *       Used by the Smart Alerts aggregator (FN-1161). Tenant-scoped via
 *       `req.context.tenantId` when the underlying `vehicles` table has
 *       the column.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Number of vehicles to return (default 20, max 100)
 *     responses:
 *       200:
 *         description: Overdue-inspection vehicle list
 *       400:
 *         description: Invalid limit
 *       500:
 *         description: Server error
 */
router.get('/inspections/overdue', async (req, res) => {
  const limit = parseAlertsTopLimit(req.query.limit);
  if (limit === null) {
    return res.status(400).json({ message: 'Invalid limit; expected positive integer' });
  }

  try {
    const vehicleSource = await resolveVehicleSource();
    if (vehicleSource === 'none') return res.json([]);

    const vehicleColumns = await getRelationColumns(vehicleSource);
    if (!vehicleColumns.has('inspection_expiry')) return res.json([]);
    const hasTenantCol = vehicleColumns.has('tenant_id');
    const hasUnitNumber = vehicleColumns.has('unit_number');

    const params = [];
    params.push(req.context?.tenantId || null);
    const tenantIdx = params.length;
    params.push(limit);
    const limitIdx = params.length;

    // When the vehicle source has no tenant_id column we still need a
    // bound positional placeholder for $1 — match the FN-1303 risk-top
    // pattern: emit a no-op predicate so $1 stays referenced.
    const tenantPredicate = hasTenantCol
      ? `(v.tenant_id = $${tenantIdx} OR $${tenantIdx}::uuid IS NULL)`
      : `($${tenantIdx}::uuid IS NULL OR TRUE)`;

    const sql = `
      SELECT
        v.id AS vehicle_id,
        ${hasUnitNumber ? 'v.unit_number' : "''::text AS unit_number"},
        v.inspection_expiry,
        (NOW()::date - v.inspection_expiry)::int AS days_overdue
      FROM ${vehicleSource} v
      WHERE ${tenantPredicate}
        AND v.inspection_expiry IS NOT NULL
        AND v.inspection_expiry < NOW()::date
      ORDER BY v.inspection_expiry ASC
      LIMIT $${limitIdx}
    `;

    const result = await query(sql, params);
    const data = result.rows.map((row) => ({
      vehicleId: row.vehicle_id,
      unit: row.unit_number || '',
      daysOverdue: Number(row.days_overdue) || 0,
      // The schema only tracks a single `inspection_expiry`, which on most
      // fleets is the annual DOT inspection (49 CFR 396.17). Until the model
      // splits annual vs. periodic vs. roadside, label all of them 'annual'.
      inspectionType: 'annual'
    }));
    return res.json(data);
  } catch (error) {
    const code = error?.code ? String(error.code) : '';
    const message = error?.message ? String(error.message) : '';
    if (code === '42P01' || message.includes('does not exist')) {
      dtLogger.warn?.('vehicles_inspections_overdue_table_missing', { message });
      return res.json([]);
    }
    dtLogger.error('vehicles_inspections_overdue_failed', error);
    return res.status(500).json({ message: 'Failed to fetch overdue vehicle inspections' });
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
      trailer_details,
      ownership_type,
      equipment_owner_name,
      equipment_owner_id,
      lessor_name,
      lease_date,
      lease_payment_amount
    } = req.body;

    if (!tenantId || !operatingEntityId) {
      return res.status(403).json({ message: 'Operating entity context is required to create a vehicle' });
    }

    // FN-1386: validate ownership classification before any DB write.
    const ownershipError = validateOwnership(req.body);
    if (ownershipError) {
      return res.status(400).json({ message: ownershipError });
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

    // FN-1386: persist ownership classification + dependent fields. Keep
    // `company_owned` derived from ownership_type so settlements (which still
    // read company_owned) stay consistent. Default to 'company' when the
    // caller omits ownership_type, matching the column's DB default.
    const finalOwnershipType = OWNERSHIP_TYPES.includes(ownership_type) ? ownership_type : 'company';
    const finalCompanyOwned = finalOwnershipType === 'company';
    try {
      const vehicleColumns = await getVehiclesColumnSet();
      const setClauses = [];
      const setParams = [];
      let p = 1;

      if (vehicleColumns.has('ownership_type')) {
        setClauses.push(`ownership_type = $${p++}`);
        setParams.push(finalOwnershipType);
      }
      if (vehicleColumns.has('company_owned')) {
        setClauses.push(`company_owned = $${p++}`);
        setParams.push(finalCompanyOwned);
      }
      if (vehicleColumns.has('equipment_owner_name') && equipment_owner_name !== undefined) {
        setClauses.push(`equipment_owner_name = $${p++}`);
        setParams.push(isNonEmptyString(equipment_owner_name) ? equipment_owner_name.trim() : null);
      }
      if (vehicleColumns.has('equipment_owner_id') && equipment_owner_id !== undefined) {
        setClauses.push(`equipment_owner_id = $${p++}`);
        setParams.push(equipment_owner_id || null);
      }
      // Only persist top-level lease fields if the column exists; trailer
      // lease info already lives inside trailer_details JSONB above.
      if (vehicleColumns.has('lessor_name') && lessor_name !== undefined) {
        setClauses.push(`lessor_name = $${p++}`);
        setParams.push(isNonEmptyString(lessor_name) ? lessor_name.trim() : null);
      }
      if (vehicleColumns.has('lease_date') && lease_date !== undefined) {
        setClauses.push(`lease_date = $${p++}`);
        setParams.push(lease_date || null);
      }
      if (vehicleColumns.has('lease_payment_amount') && lease_payment_amount !== undefined) {
        setClauses.push(`lease_payment_amount = $${p++}`);
        setParams.push(lease_payment_amount === '' || lease_payment_amount === null ? null : lease_payment_amount);
      }

      if (setClauses.length > 0) {
        setParams.push(result.rows[0].id);
        await query(
          `UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = $${p}`,
          setParams
        );
      }
    } catch (ownErr) {
      console.warn('[vehicles] ownership persist skipped:', ownErr?.message || ownErr);
    }
    const duration = Date.now() - startTime;

    dtLogger.trackDatabase('INSERT', 'vehicles', duration, true, { vehicleId: result.rows[0].id });
    dtLogger.trackEvent('vehicle.created', { vehicleId: result.rows[0].id, unit_number, vin });
    dtLogger.trackRequest('POST', '/api/vehicles', 201, duration);
    dtLogger.info('Vehicle created successfully', { vehicleId: result.rows[0].id, unit_number });

    // Re-read so the response reflects the persisted ownership + trailer_details.
    const finalRead = await query('SELECT * FROM vehicles WHERE id = $1', [result.rows[0].id]);
    res.status(201).json(finalRead.rows[0] || result.rows[0]);
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
    // FN-1386: validate ownership classification before any DB write.
    const ownershipError = validateOwnership(req.body);
    if (ownershipError) {
      return res.status(400).json({ message: ownershipError });
    }

    // FN-1467: customer_vehicles.customer_id was renamed to shop_client_id.
    // Accept either inbound shape so the frontend can migrate independently.
    if (req.body && req.body.shop_client_id === undefined && req.body.customer_id !== undefined) {
      req.body.shop_client_id = req.body.customer_id;
      delete req.body.customer_id;
    }

    const vehicleColumns = await getVehiclesColumnSet();
    // Fields that should not be updated
    const excludedFields = ['id', 'created_at', 'updated_at', 'shop_client_id', 'source'];

    // String fields that must never be null in the database
    const nullSafeStringFields = new Set(['vin', 'make', 'model', 'license_plate', 'state', 'unit_number']);

    // FN-1386: when ownership_type is explicitly set, derive company_owned
    // from it so settlements stay consistent with the new enum. The caller's
    // company_owned is overridden to avoid an inconsistent pair.
    const updateBody = { ...req.body };
    if (
      updateBody.ownership_type !== undefined
      && OWNERSHIP_TYPES.includes(String(updateBody.ownership_type))
      && vehicleColumns.has('company_owned')
    ) {
      updateBody.company_owned = String(updateBody.ownership_type) === 'company';
    }

    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(updateBody).forEach(key => {
      if (updateBody[key] !== undefined && !excludedFields.includes(key) && vehicleColumns.has(key)) {
        fields.push(`${key} = $${paramCount}`);
        let val = updateBody[key];
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
        'shop_client_id'
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

/**
 * @openapi
 * /api/vehicles/{id}/maintenance-history:
 *   get:
 *     summary: List a vehicle's shop work orders + invoices
 *     description: >-
 *       Returns the paginated maintenance history (work orders LEFT JOIN invoices)
 *       for a fleet or customer-owned vehicle, joined by VIN through the
 *       customer_vehicles mirror table. Includes a meta.lifetime_spend aggregate
 *       across all non-canceled work orders. Requires `work_orders.view`; the
 *       per-row `invoice` field is omitted when the caller lacks `invoices.view`.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *     responses:
 *       200:
 *         description: Paginated work order + invoice rows
 *       403:
 *         description: Tenant context missing or insufficient permission
 *       404:
 *         description: Vehicle not found in this tenant
 *       500:
 *         description: Server error
 */
router.get(
  '/:id/maintenance-history',
  loadUserRbac,
  requirePermission('work_orders.view'),
  async (req, res) => {
    try {
      const tenantId = req.context?.tenantId || null;
      if (!tenantId) {
        return res.status(403).json({ message: 'Tenant context required' });
      }

      const rbac = req.user?.rbac;
      const permCodes = rbac?.permissionCodes || [];
      const isSuperAdmin = (rbac?.roles || []).some((r) => r.code === 'super_admin');
      const includeInvoices = isSuperAdmin || permCodes.includes('invoices.view');

      const result = await getVehicleMaintenanceHistory(req.params.id, {
        tenantId,
        page: req.query.page,
        pageSize: req.query.pageSize,
        includeInvoices
      });

      if (!result) {
        return res.status(404).json({ message: 'Vehicle not found' });
      }

      res.json(result);
    } catch (error) {
      dtLogger.error('vehicle_maintenance_history_failed', error, { vehicleId: req.params.id });
      console.error('Error fetching vehicle maintenance history:', error);
      res.status(500).json({ message: 'Failed to fetch maintenance history' });
    }
  }
);

/**
 * @openapi
 * /api/vehicles/{id}/repair-history-summary:
 *   get:
 *     summary: AI summary of a vehicle's repair history with comeback risk
 *     description: >-
 *       FN-1433: Pulls work-order history for the vehicle within the windowDays
 *       window (default 365, clamped to [30, 1825]), caps at 50 rows by created_at
 *       desc, and forwards to the ai-service handler at
 *       POST /api/ai/vehicles/repair-history-summary. The route response is
 *       short-cached in process for 5 minutes per (tenant, vehicle, windowDays).
 *       The ai-service short-circuits when fewer than 2 work orders are sent —
 *       this route passes that response through unchanged. Requires
 *       `work_orders.view`.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: windowDays
 *         schema: { type: integer, minimum: 30, maximum: 1825, default: 365 }
 *     responses:
 *       200:
 *         description: AI summary, recurring patterns, and comeback risk grade
 *       403:
 *         description: Tenant context missing or insufficient permission
 *       404:
 *         description: Vehicle not found in this tenant
 *       502:
 *         description: AI service unavailable
 *       500:
 *         description: Server error
 */
router.get(
  '/:id/repair-history-summary',
  loadUserRbac,
  requirePermission('work_orders.view'),
  async (req, res) => {
    const vehicleId = req.params.id;
    const tenantId = req.context?.tenantId || null;
    let windowDays;
    try {
      if (!tenantId) {
        return res.status(403).json({ message: 'Tenant context required' });
      }

      windowDays = clampWindowDays(req.query.windowDays);
      const result = await getRepairHistorySummary(vehicleId, {
        tenantId,
        windowDays,
        req
      });

      if (result === null) {
        return res.status(404).json({ message: 'Vehicle not found' });
      }
      if (!result.ok) {
        // FN-1527: tell the widget when to safely retry so the spinner timer
        // is meaningful instead of a tight client-side loop.
        res.set('Retry-After', '5');
        return res.status(502).json({ message: 'AI summary service unavailable' });
      }

      res.json({ ...result.body, windowDays, cached: result.fromCache === true });
    } catch (error) {
      dtLogger.error('vehicle_repair_history_summary_failed_unhandled', {
        error: error.message,
        stack: error.stack,
        vehicleId,
        tenantId,
        windowDays
      });
      res.status(500).json({ message: 'Failed to fetch repair history summary' });
    }
  }
);

// Expose for unit tests (FN-133 regression)
router.VEHICLE_READ_ROLES = VEHICLE_READ_ROLES;
router.VEHICLE_WRITE_ROLES = VEHICLE_WRITE_ROLES;
router.isVehicleReadHttpMethod = isVehicleReadHttpMethod;
// Expose for FN-1386 ownership-validation tests.
router.OWNERSHIP_TYPES = OWNERSHIP_TYPES;
router.validateOwnership = validateOwnership;

module.exports = router;
