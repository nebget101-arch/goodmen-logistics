const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/logger');
const { query, getClient } = require('../internal/db');
const { extractLoadFromPdf } = require('../services/load-ai-extractor');
const { uploadBuffer, getSignedDownloadUrl, deleteObject } = require('../storage/r2-storage');

const LOAD_STATUSES = ['DRAFT', 'NEW', 'CANCELLED', 'CANCELED', 'TONU', 'DISPATCHED', 'EN_ROUTE', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];
const BILLING_STATUSES = ['PENDING', 'CANCELLED', 'CANCELED', 'BOL_RECEIVED', 'INVOICED', 'SENT_TO_FACTORING', 'FUNDED', 'PAID'];
const STOP_TYPES = ['PICKUP', 'DELIVERY'];
const ATTACHMENT_TYPES = [
  'RATE_CONFIRMATION',
  'BOL',
  'LUMPER',
  'OTHER',
  'CONFIRMATION',
  'PROOF_OF_DELIVERY',
  'ROADSIDE_MAINTENANCE_RECEIPT'
];

async function lookupZipLatLon(zip) {
  const trimmed = (zip || '').toString().trim();
  if (!trimmed) return null;
  try {
    const response = await axios.get(`https://api.zippopotam.us/us/${encodeURIComponent(trimmed)}`);
    const place = response.data?.places?.[0];
    if (!place) return null;
    const lat = parseFloat(place.latitude);
    const lon = parseFloat(place.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    return { lat, lon };
  } catch (err) {
    // Treat lookup failures as "no data" so the rest of the load still returns
    console.error('lookupZipLatLon failed for', trimmed, err.message || err);
    return null;
  }
}

async function getDrivingDistanceMiles(fromZip, toZip) {
  const from = await lookupZipLatLon(fromZip);
  const to = await lookupZipLatLon(toZip);
  if (!from || !to) return 0;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const response = await axios.get(url);
    const meters = response.data?.routes?.[0]?.distance;
    if (typeof meters !== 'number' || meters <= 0) return 0;
    const miles = meters / 1609.34;
    return Math.round(miles);
  } catch (err) {
    console.error('getDrivingDistanceMiles failed for', { fromZip, toZip }, err.message || err);
    return 0;
  }
}

async function computeTripMetrics(exec, loadId, loadRow, stops) {
  const stopList = stops || [];
  const pickups = stopList.filter((s) => (s.stop_type || s.stopType || '').toString().trim().toUpperCase() === 'PICKUP');
  const deliveries = stopList.filter((s) => (s.stop_type || s.stopType || '').toString().trim().toUpperCase() === 'DELIVERY');
  const firstPickup = pickups[0];
  const lastDelivery = deliveries.length ? deliveries[deliveries.length - 1] : null;

  const pickupZip = (firstPickup?.zip || '').toString().trim() || null;
  const deliveryZip = (lastDelivery?.zip || '').toString().trim() || null;

  let prevZip = null;
  let prevCity = null;
  let prevState = null;
  if (loadRow?.driver_id) {
    try {
      const prevResult = await exec(
        `SELECT s.zip, s.city, s.state
         FROM loads l
         JOIN load_stops s ON s.load_id = l.id
         WHERE l.driver_id = $1
           AND l.id <> $2
           AND s.stop_type = 'DELIVERY'
         ORDER BY COALESCE(s.stop_date, l.completed_date, l.created_at) DESC
         LIMIT 1`,
        [loadRow.driver_id, loadId]
      );
      prevZip = (prevResult.rows[0]?.zip || '').toString().trim() || null;
      prevCity = (prevResult.rows[0]?.city || '').toString().trim() || null;
      prevState = (prevResult.rows[0]?.state || '').toString().trim() || null;
    } catch (err) {
      console.error('computeTripMetrics prevZip lookup failed', err.message || err);
      prevZip = null;
    }
  }

  let emptyMiles = 0;
  let loadedMiles = 0;

  if (pickupZip && deliveryZip) {
    loadedMiles = await getDrivingDistanceMiles(pickupZip, deliveryZip);
  }
  if (prevZip && pickupZip && prevZip !== pickupZip) {
    emptyMiles = await getDrivingDistanceMiles(prevZip, pickupZip);
  }

  const totalMiles = (emptyMiles || 0) + (loadedMiles || 0);
  const rateValue = loadRow && loadRow.rate != null ? Number(loadRow.rate) : null;
  const ratePerMile = totalMiles > 0 && rateValue != null ? Number(rateValue) / totalMiles : null;

  return {
    prev_zip: prevZip,
    prev_delivery_city: prevCity,
    prev_delivery_state: prevState,
    pickup_zip: pickupZip,
    delivery_zip: deliveryZip,
    empty_miles: emptyMiles,
    loaded_miles: loadedMiles,
    total_miles: totalMiles,
    rate_per_mile: ratePerMile
  };
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const role = (req.user?.role || '').toString().trim().toLowerCase();
    const allowed = allowedRoles.map(r => r.toString().trim().toLowerCase());
    if (!allowed.includes(role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

/** For driver role: ensure load belongs to req.user.driver_id. Call after load is fetched. */
function assertDriverCanAccessLoad(load, req) {
  const role = (req.user?.role || '').toString().trim().toLowerCase();
  if (role !== 'driver') return true;
  const driverId = (req.user?.driver_id || '').toString().trim();
  const loadDriverId = (load?.driver_id || '').toString().trim();
  return driverId && loadDriverId && driverId === loadDriverId;
}

// Protect all loads routes: admin, dispatch, or driver (driver scoped to own loads)
router.use(authMiddleware);
router.use((req, res, next) => {
  const role = (req.user?.role || '').toString().trim().toLowerCase();
  const allowed = ['admin', 'dispatch', 'driver'];
  if (!allowed.includes(role)) {
    return res.status(403).json({ success: false, error: 'Forbidden: insufficient role' });
  }
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /pdf|jpg|jpeg|png/;
    const extname = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowed.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Only PDF and image files are allowed'));
  }
});

function normalizeEnum(value) {
  return (value || '').toString().trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function normalizeNullable(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
}

async function generateLoadNumber(client) {
  for (let i = 0; i < 10; i += 1) {
    const candidate = Math.floor(100000 + Math.random() * 900000).toString();
    const exists = await client.query('SELECT 1 FROM loads WHERE load_number = $1', [candidate]);
    if (exists.rows.length === 0) return candidate;
  }
  return `${Date.now()}`.slice(-8);
}

function buildStopsFromBody(body) {
  if (Array.isArray(body.stops) && body.stops.length > 0) {
    return body.stops;
  }
  const pickup = body.pickup || {
    date: body.pickupDate,
    city: body.pickupCity,
    state: body.pickupState,
    zip: body.pickupZip,
    address1: body.pickupAddress1,
    address2: body.pickupAddress2
  };
  const delivery = body.delivery || {
    date: body.deliveryDate,
    city: body.deliveryCity,
    state: body.deliveryState,
    zip: body.deliveryZip,
    address1: body.deliveryAddress1,
    address2: body.deliveryAddress2
  };
  return [
    { stopType: 'PICKUP', sequence: 1, ...pickup },
    { stopType: 'DELIVERY', sequence: 2, ...delivery }
  ];
}

function validateStops(stops, requireBoth) {
  const errors = [];
  if (!Array.isArray(stops) || stops.length === 0) {
    errors.push('At least one stop is required');
    return errors;
  }
  const types = new Set();
  stops.forEach((stop, idx) => {
    const type = normalizeEnum(stop.stopType || stop.stop_type);
    if (!STOP_TYPES.includes(type)) {
      errors.push(`Stop ${idx + 1} has invalid stop_type`);
    }
    types.add(type);
  });
  if (requireBoth) {
    if (!types.has('PICKUP') || !types.has('DELIVERY')) {
      errors.push('Both PICKUP and DELIVERY stops are required');
    }
  }
  return errors;
}

function applyLoadScope(where, params, context) {
  if (context?.tenantId) {
    params.push(context.tenantId);
    where.push(`l.tenant_id = $${params.length}`);
  }
  if (context?.operatingEntityId) {
    params.push(context.operatingEntityId);
    where.push(`l.operating_entity_id = $${params.length}`);
  }
}

async function getLoadDetail(clientOrQuery, loadId, context = null) {
  const exec = clientOrQuery.query ? clientOrQuery.query.bind(clientOrQuery) : query;
  const detailParams = [loadId];
  let whereSql = 'WHERE l.id = $1';
  if (context?.tenantId) {
    detailParams.push(context.tenantId);
    whereSql += ` AND l.tenant_id = $${detailParams.length}`;
  }
  if (context?.operatingEntityId) {
    detailParams.push(context.operatingEntityId);
    whereSql += ` AND l.operating_entity_id = $${detailParams.length}`;
  }

  const loadResult = await exec(
    `SELECT l.*,
            concat_ws(' ', d.first_name, d.last_name) as driver_name,
            COALESCE(b.legal_name, b.name, l.broker_name) as broker_display_name
     FROM loads l
     LEFT JOIN drivers d ON l.driver_id = d.id
     LEFT JOIN brokers b ON l.broker_id = b.id
     ${whereSql}`,
    detailParams
  );
  if (loadResult.rows.length === 0) return null;
  const stopsResult = await exec(
    `SELECT * FROM load_stops WHERE load_id = $1 ORDER BY sequence, created_at`,
    [loadId]
  );
  const attachmentsResult = await exec(
    `SELECT * FROM load_attachments WHERE load_id = $1 ORDER BY created_at DESC`,
    [loadId]
  );
  const loadRow = loadResult.rows[0];
  if (loadRow?.status) {
    loadRow.status = normalizeEnum(loadRow.status);
  }
  if (loadRow?.billing_status) {
    loadRow.billing_status = normalizeEnum(loadRow.billing_status);
  }
  const attachments = await Promise.all(
    (attachmentsResult.rows || []).map(async (row) => ({
      ...row,
      file_url: row.storage_key ? await getSignedDownloadUrl(row.storage_key) : null
    }))
  );
  const tripMetrics = await computeTripMetrics(exec, loadId, loadRow, stopsResult.rows || []);
  const stopsRows = stopsResult.rows || [];
  const pickups = stopsRows.filter((s) => (s.stop_type || s.stopType || '').toString().trim().toUpperCase() === 'PICKUP');
  const deliveries = stopsRows.filter((s) => (s.stop_type || s.stopType || '').toString().trim().toUpperCase() === 'DELIVERY');
  const firstPickup = pickups[0];
  const lastDelivery = deliveries.length ? deliveries[deliveries.length - 1] : null;
  const pickupDate = firstPickup?.stop_date ?? null;
  const deliveryDate = lastDelivery?.stop_date ?? null;
  return {
    ...loadRow,
    ...tripMetrics,
    pickup_date: pickupDate,
    delivery_date: deliveryDate,
    stops: stopsResult.rows,
    attachments
  };
}

/**
 * @openapi
 * /api/loads:
 *   get:
 *     summary: List loads
 *     tags:
 *       - Loads
 *     responses:
 *       200:
 *         description: Loads list returned
 *   post:
 *     summary: Create load
 *     tags:
 *       - Loads
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Load payload
 *             additionalProperties: true
 *     responses:
 *       201:
 *         description: Load created
 */
// GET /api/loads
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const role = (req.user?.role || '').toString().trim().toLowerCase();
    const isDriver = role === 'driver';
    if (isDriver && !req.user?.driver_id) {
      return res.status(403).json({ success: false, error: 'Driver account not linked to a driver record' });
    }
    const status = normalizeEnum(req.query.status);
    const billingStatus = normalizeEnum(req.query.billingStatus);
    let driverId = (req.query.driverId || '').toString().trim();
    if (isDriver) driverId = (req.user.driver_id || '').toString().trim();
    const brokerId = (req.query.brokerId || '').toString().trim();
    const q = (req.query.q || '').toString().trim();
    const dateFrom = (req.query.dateFrom || '').toString().trim();
    const dateTo = (req.query.dateTo || '').toString().trim();

    if (status && !LOAD_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status filter' });
    }
    if (billingStatus && !BILLING_STATUSES.includes(billingStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid billing status filter' });
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '25', 10), 1), 200);
    const sortBy = (req.query.sortBy || '').toString().trim().toLowerCase();
    // Default pickup_date to asc so nearest (earliest) date appears first
    const defaultSortDir = sortBy === 'pickup_date' ? 'asc' : 'desc';
    const sortDirRaw = (req.query.sortDir || defaultSortDir).toString().trim().toLowerCase();
    const sortDir = sortDirRaw === 'asc' ? 'asc' : 'desc';
    const offset = (page - 1) * pageSize;

    const where = [];
    const params = [];

    applyLoadScope(where, params, req.context || null);

    if (status) {
      params.push(status);
      where.push(`UPPER(l.status::text) = $${params.length}`);
    }
    if (billingStatus) {
      params.push(billingStatus);
      where.push(`UPPER(l.billing_status::text) = $${params.length}`);
    }
    if (driverId) {
      params.push(driverId);
      where.push(`l.driver_id = $${params.length}`);
    }
    if (brokerId) {
      params.push(brokerId);
      where.push(`l.broker_id = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(
        l.load_number ILIKE $${params.length}
        OR COALESCE(b.legal_name, b.name, l.broker_name, '') ILIKE $${params.length}
        OR concat_ws(' ', d.first_name, d.last_name) ILIKE $${params.length}
      )`);
    }
    if (dateFrom && dateTo) {
      params.push(dateFrom);
      const idxFrom = params.length;
      params.push(dateTo);
      const idxTo = params.length;
      where.push(`(
        (pickup.stop_date::date >= $${idxFrom} AND pickup.stop_date::date <= $${idxTo})
        OR (COALESCE(delivery.stop_date, l.completed_date, l.created_at)::date >= $${idxFrom} AND COALESCE(delivery.stop_date, l.completed_date, l.created_at)::date <= $${idxTo})
      )`);
    } else if (dateFrom) {
      params.push(dateFrom);
      where.push(`(pickup.stop_date::date >= $${params.length} OR COALESCE(delivery.stop_date, l.completed_date, l.created_at)::date >= $${params.length})`);
    } else if (dateTo) {
      params.push(dateTo);
      where.push(`(pickup.stop_date::date <= $${params.length} OR COALESCE(delivery.stop_date, l.completed_date, l.created_at)::date <= $${params.length})`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const baseSql = `
      FROM loads l
      LEFT JOIN drivers d ON l.driver_id = d.id AND d.tenant_id = l.tenant_id AND (l.operating_entity_id IS NULL OR d.operating_entity_id = l.operating_entity_id)
      LEFT JOIN brokers b ON l.broker_id = b.id
      LEFT JOIN operating_entities oe ON oe.id = l.operating_entity_id
      LEFT JOIN LATERAL (
        SELECT city, state, zip, stop_date
        FROM load_stops
        WHERE load_id = l.id AND stop_type = 'PICKUP'
        ORDER BY sequence ASC
        LIMIT 1
      ) pickup ON true
      LEFT JOIN LATERAL (
        SELECT city, state, zip, stop_date
        FROM load_stops
        WHERE load_id = l.id AND stop_type = 'DELIVERY'
        ORDER BY sequence DESC
        LIMIT 1
      ) delivery ON true
      LEFT JOIN (
        SELECT load_id,
               COUNT(*) as attachment_count,
               array_agg(DISTINCT type) as attachment_types
        FROM load_attachments
        GROUP BY load_id
      ) att ON att.load_id = l.id
      ${whereClause}
    `;

    const countResult = await query(`SELECT COUNT(*) as total ${baseSql}`, params);
    const total = parseInt(countResult.rows[0].total, 10) || 0;

    params.push(pageSize);
    params.push(offset);
    const sortMap = {
      load_number: 'l.load_number',
      pickup_date: 'pickup.stop_date',
      rate: 'l.rate',
      // Sort "Completed" by delivery date when present, then completed_date, then created_at
      completed_date: 'COALESCE(delivery.stop_date, l.completed_date, l.created_at)',
      created_at: 'l.created_at'
    };
    const orderBy = sortMap[sortBy] || 'l.created_at';
    // Put DRAFT loads first when viewing all statuses
    const draftFirst = !status ? 'CASE WHEN UPPER(l.status::text) = \'DRAFT\' THEN 0 ELSE 1 END, ' : '';

    const dataSql = `
      SELECT
        l.id,
        l.driver_id,
        l.load_number,
        UPPER(l.status::text) as status,
        UPPER(l.billing_status::text) as billing_status,
        l.rate,
        l.completed_date,
        pickup.stop_date as pickup_date,
        delivery.stop_date as delivery_date,
        pickup.city as pickup_city,
        pickup.state as pickup_state,
        pickup.zip as pickup_zip,
        delivery.city as delivery_city,
        delivery.state as delivery_state,
        delivery.zip as delivery_zip,
        concat_ws(' ', d.first_name, d.last_name) as driver_name,
        COALESCE(b.legal_name, b.name, l.broker_name) as broker_name,
        l.po_number,
        l.notes,
        l.operating_entity_id,
        oe.name as operating_entity_name,
        COALESCE(att.attachment_count, 0) as attachment_count,
        COALESCE(att.attachment_types, ARRAY[]::text[]) as attachment_types
      ${baseSql}
      ORDER BY ${draftFirst}${orderBy} ${sortDir}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const result = await query(dataSql, params);

    const duration = Date.now() - startTime;
    dtLogger.trackRequest('GET', '/api/loads', 200, duration, { count: result.rows.length });
    res.json({
      success: true,
      data: result.rows || [],
      meta: { page, pageSize, total }
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = (error && error.message) ? String(error.message) : '';
    const code = error && error.code ? String(error.code) : '';
    // If loads tables/views are missing (not yet migrated), treat as "no data" instead of failing
    if (code === '42P01' || message.includes('relation') || message.includes('does not exist')) {
      dtLogger.trackRequest('GET', '/api/loads', 200, duration, { count: 0 });
      return res.json({
        success: true,
        data: [],
        meta: { page: 1, pageSize: parseInt(req.query.pageSize || '25', 10) || 25, total: 0 }
      });
    }
    dtLogger.error('loads_list_failed', error);
    dtLogger.trackRequest('GET', '/api/loads', 500, duration);
    res.status(500).json({ success: false, error: 'Failed to fetch loads' });
  }
});

// POST /api/loads (admin, dispatch only; driver cannot create)
router.post('/', requireRole(['admin', 'dispatch']), async (req, res) => {
  const startTime = Date.now();
  const client = await getClient();
  try {
    const body = req.body || {};
    const tenantId = req.context?.tenantId || null;
    const operatingEntityId = req.context?.operatingEntityId || null;
    const status = normalizeEnum(body.status) || 'NEW';
    const billingStatus = normalizeEnum(body.billingStatus) || 'PENDING';

    if (!tenantId || !operatingEntityId) {
      return res.status(403).json({ success: false, error: 'Operating entity context is required to create a load' });
    }

    if (!LOAD_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    if (!BILLING_STATUSES.includes(billingStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid billing status' });
    }

    const stops = buildStopsFromBody(body);
    const stopErrors = validateStops(stops, true);
    if (stopErrors.length > 0) {
      return res.status(400).json({ success: false, error: 'Invalid stops', details: stopErrors });
    }

    const pickupStop = stops.find((s) => normalizeEnum(s.stopType || s.stop_type) === 'PICKUP');
    const deliveryStop = stops.find((s) => normalizeEnum(s.stopType || s.stop_type) === 'DELIVERY');

    function buildLocation(stop) {
      if (!stop) return 'UNKNOWN';
      const city = (stop.city || '').toString().trim();
      const state = (stop.state || '').toString().trim();
      const zip = (stop.zip || '').toString().trim();
      const parts = [];
      if (city) parts.push(city);
      if (state) parts.push(state);
      let loc = parts.join(', ');
      if (zip) {
        loc = loc ? `${loc} ${zip}` : zip;
      }
      return loc || 'UNKNOWN';
    }

    const pickupLocation = buildLocation(pickupStop);
    const deliveryLocation = buildLocation(deliveryStop);
    const pickupDate = pickupStop ? (pickupStop.date || pickupStop.stopDate || pickupStop.stop_date || null) : null;
    const deliveryDate = deliveryStop ? (deliveryStop.date || deliveryStop.stopDate || deliveryStop.stop_date || null) : null;

    await client.query('BEGIN');
    let loadNumber = normalizeNullable(body.loadNumber);
    const poValue = normalizeNullable(body.poNumber);
    if (!loadNumber && poValue) {
      // Use PO number as load number when provided, truncated to fit column
      loadNumber = poValue.toString().slice(0, 50);
    }
    if (!loadNumber) {
      loadNumber = await generateLoadNumber(client);
    }
    const dispatcherUserId = normalizeNullable(body.dispatcherUserId) || req.user?.id || null;

    const insertResult = await client.query(
      `INSERT INTO loads (
        tenant_id, operating_entity_id,
        load_number, status, billing_status, dispatcher_user_id,
        driver_id, truck_id, trailer_id, broker_id, broker_name,
        po_number, rate, notes, completed_date
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        tenantId,
        operatingEntityId,
        loadNumber,
        status,
        billingStatus,
        dispatcherUserId,
        normalizeNullable(body.driverId),
        normalizeNullable(body.truckId),
        normalizeNullable(body.trailerId),
        normalizeNullable(body.brokerId),
        normalizeNullable(body.brokerName),
        normalizeNullable(body.poNumber),
        normalizeNullable(body.rate) || 0,
        normalizeNullable(body.notes),
        normalizeNullable(body.completedDate)
      ]
    );

    const loadId = insertResult.rows[0].id;
    for (const stop of stops) {
      const stopType = normalizeEnum(stop.stopType || stop.stop_type);
      await client.query(
        `INSERT INTO load_stops (
          load_id, stop_type, stop_date, city, state, zip, address1, address2, sequence
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          loadId,
          stopType,
          normalizeNullable(stop.date || stop.stopDate || stop.stop_date),
          normalizeNullable(stop.city),
          normalizeNullable(stop.state),
          normalizeNullable(stop.zip),
          normalizeNullable(stop.address1),
          normalizeNullable(stop.address2),
          normalizeNullable(stop.sequence) || 1
        ]
      );
    }

    await client.query('COMMIT');
    const created = await getLoadDetail(client, loadId);
    const duration = Date.now() - startTime;
    dtLogger.trackRequest('POST', '/api/loads', 201, duration);
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    await client.query('ROLLBACK');
    const duration = Date.now() - startTime;
    dtLogger.error('loads_create_failed', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/loads', 500, duration);
    res.status(500).json({ success: false, error: 'Failed to create load' });
  } finally {
    client.release();
  }
});

const BULK_MAX_FILES = 10;

/** Find broker by name (ILIKE match on legal_name or name); return { id, name } or null. */
async function findBrokerByName(clientOrQuery, brokerName) {
  const bn = (brokerName || '').toString().trim();
  if (!bn) return null;
  const exec = clientOrQuery.query ? clientOrQuery.query.bind(clientOrQuery) : query;
  const result = await exec(
    `SELECT id, COALESCE(legal_name, name) as name FROM brokers
     WHERE COALESCE(legal_name, name) ILIKE $1 OR dba_name ILIKE $1
     LIMIT 1`,
    [`%${bn}%`]
  );
  return result.rows.length ? result.rows[0] : null;
}

function buildLoc(obj) {
  const parts = [(obj.city || '').trim(), (obj.state || '').trim()].filter(Boolean);
  const loc = parts.join(', ');
  const zip = (obj.zip || '').toString().trim();
  return zip ? (loc ? `${loc} ${zip}` : zip) : (loc || 'UNKNOWN');
}

/**
 * Process a single rate confirmation PDF: extract via AI, persist to DB, upload to R2.
 * Each call acquires and releases its own DB client so files can run in parallel.
 */
async function processSingleRateConfirmation(file, req, dispatcherUserId) {
  // Step 1: AI extraction — no DB client needed yet
  const data = await extractLoadFromPdf(file.buffer, file.originalname || 'upload.pdf');
  const pickup = data.pickup || {};
  const delivery = data.delivery || {};
  const brokerName = (data.brokerName || '').toString().trim() || null;
  const extractedStops = Array.isArray(data.stops) && data.stops.length > 0 ? data.stops : null;

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  let pickupLocation, deliveryLocation, pickupDate, deliveryDate, stopsToInsert;

  if (extractedStops && extractedStops.length > 0) {
    const pickups = extractedStops.filter((s) => (s.type || '').toString().toUpperCase() === 'PICKUP');
    const deliveries = extractedStops.filter((s) => (s.type || '').toString().toUpperCase() === 'DELIVERY');
    const firstPickup = pickups[0];
    const lastDelivery = deliveries[deliveries.length - 1];
    pickupLocation = firstPickup ? buildLoc(firstPickup) : buildLoc(pickup);
    deliveryLocation = lastDelivery ? buildLoc(lastDelivery) : buildLoc(delivery);
    pickupDate = firstPickup?.date && String(firstPickup.date).trim() ? String(firstPickup.date).trim().slice(0, 10) : (pickup.date && String(pickup.date).trim() ? String(pickup.date).trim().slice(0, 10) : today);
    deliveryDate = lastDelivery?.date && String(lastDelivery.date).trim() ? String(lastDelivery.date).trim().slice(0, 10) : (delivery.date && String(delivery.date).trim() ? String(delivery.date).trim().slice(0, 10) : tomorrow);
    stopsToInsert = extractedStops.map((s, idx) => {
      const isDelivery = (s.type || '').toString().toUpperCase() === 'DELIVERY';
      return {
        stopType: isDelivery ? 'DELIVERY' : 'PICKUP',
        date: s.date && String(s.date).trim() ? String(s.date).trim().slice(0, 10) : (isDelivery ? deliveryDate : pickupDate),
        city: s.city,
        state: s.state,
        zip: s.zip,
        address1: s.address1,
        sequence: typeof s.sequence === 'number' ? s.sequence : idx + 1
      };
    });
  } else {
    pickupLocation = buildLoc(pickup);
    deliveryLocation = buildLoc(delivery);
    pickupDate = pickup.date && String(pickup.date).trim() ? String(pickup.date).trim().slice(0, 10) : today;
    deliveryDate = delivery.date && String(delivery.date).trim() ? String(delivery.date).trim().slice(0, 10) : tomorrow;
    stopsToInsert = [
      { stopType: 'PICKUP', date: pickupDate, city: pickup.city, state: pickup.state, zip: pickup.zip, address1: null, sequence: 1 },
      { stopType: 'DELIVERY', date: deliveryDate, city: delivery.city, state: delivery.state, zip: delivery.zip, address1: null, sequence: 2 }
    ];
  }

  const refValue = (data.loadId || data.orderId || data.proNumber || data.poNumber || '').toString().trim();
  // Use loadId/orderId/proNumber as PO when poNumber not found in document
  const poValue = (data.poNumber && data.poNumber.toString().trim()) || (data.loadId || data.orderId || data.proNumber || '').toString().trim() || null;

  // Step 2: Short-lived DB transaction — acquire client, insert, commit, release immediately
  // (does not include the R2 upload so the connection isn't held during the network call)
  const client = await getClient();
  let loadId;
  try {
    let brokerId = null;
    let finalBrokerName = brokerName;
    if (brokerName) {
      const broker = await findBrokerByName(client, brokerName);
      if (broker) {
        brokerId = broker.id;
        finalBrokerName = broker.name || brokerName;
      }
      if (!broker) finalBrokerName = null;
    }

    const loadNumber = refValue ? refValue.slice(0, 50) : await generateLoadNumber(client);

    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO loads (
        tenant_id, operating_entity_id,
        load_number, status, billing_status, dispatcher_user_id,
        driver_id, truck_id, trailer_id, broker_id, broker_name,
        po_number, rate, notes, completed_date
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        req.context?.tenantId || null,
        req.context?.operatingEntityId || null,
        loadNumber, 'DRAFT', 'PENDING', dispatcherUserId,
        null, null, null, brokerId, finalBrokerName,
        poValue, data.rate || 0, null, null
      ]
    );
    loadId = insertResult.rows[0].id;

    for (const stop of stopsToInsert) {
      await client.query(
        `INSERT INTO load_stops (load_id, stop_type, stop_date, city, state, zip, address1, sequence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [loadId, stop.stopType, normalizeNullable(stop.date), normalizeNullable(stop.city), normalizeNullable(stop.state), normalizeNullable(stop.zip), normalizeNullable(stop.address1 || null), stop.sequence]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    // Always release the client back to the pool before the R2 upload
    try { client.release(); } catch (_) {}
  }

  // Step 3: Upload PDF to R2 — DB connection already returned to pool
  const fileExt = path.extname(file.originalname || '').toLowerCase() || '.pdf';
  const safeName = `load-${loadId}-${Date.now()}${fileExt}`;
  const { key: storageKey } = await uploadBuffer({
    buffer: file.buffer,
    contentType: file.mimetype,
    prefix: `loads/${loadId}`,
    fileName: safeName
  });

  // Step 4: Record the attachment — single query, no transaction needed
  await query(
    `INSERT INTO load_attachments (load_id, type, file_name, storage_key, mime_type, size_bytes, uploaded_by_user_id)
     VALUES ($1,'RATE_CONFIRMATION',$2,$3,$4,$5,$6)`,
    [loadId, file.originalname || safeName, storageKey, file.mimetype, file.size, dispatcherUserId]
  );

  const created = await getLoadDetail(query, loadId, req.context);
  return { success: true, data: created, filename: file.originalname };
}

// POST /api/loads/bulk-rate-confirmations (admin, dispatch only; max 10 PDFs)
router.post('/bulk-rate-confirmations', requireRole(['admin', 'dispatch']), upload.array('files', BULK_MAX_FILES), async (req, res) => {
  const startTime = Date.now();
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded. Upload up to 10 PDF rate confirmations.' });
    }
    if (files.length > BULK_MAX_FILES) {
      return res.status(400).json({ success: false, error: `Maximum ${BULK_MAX_FILES} rate confirmations per upload.` });
    }

    const pdfFiles = files.filter(f => f.mimetype === 'application/pdf' || (f.originalname || '').toLowerCase().endsWith('.pdf'));
    if (pdfFiles.length !== files.length) {
      return res.status(400).json({ success: false, error: 'Only PDF files are supported for bulk rate confirmation upload.' });
    }

    const dispatcherUserId = req.user?.id || null;

    // Process all files concurrently — each gets its own DB client so they don't block each other.
    // With a sequential for-loop, 10 files × ~10 s/file = ~100 s (past any proxy timeout).
    // In parallel, total time ≈ slowest single file (~10–15 s).
    const settled = await Promise.allSettled(
      pdfFiles.map(file => processSingleRateConfirmation(file, req, dispatcherUserId))
    );

    const results = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      dtLogger.error('loads_bulk_single_failed', r.reason, { filename: pdfFiles[i].originalname });
      return { success: false, error: r.reason?.message || 'Extraction or insert failed', filename: pdfFiles[i].originalname };
    });

    const duration = Date.now() - startTime;
    dtLogger.trackRequest('POST', '/api/loads/bulk-rate-confirmations', 200, duration, { count: results.length });
    res.json({ success: true, results });
  } catch (error) {
    dtLogger.error('loads_bulk_rate_confirmations_failed', error);
    res.status(500).json({ success: false, error: 'Bulk upload failed', details: error.message });
  }
});

// PATCH /api/loads/:id/approve-draft (admin, dispatch only; DRAFT -> DISPATCHED)
router.patch('/:id/approve-draft', requireRole(['admin', 'dispatch']), async (req, res) => {
  try {
    const result = await query('SELECT id, status FROM loads WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Load not found' });
    if (normalizeEnum(result.rows[0].status) !== 'DRAFT') {
      return res.status(400).json({ success: false, error: 'Only draft loads can be approved' });
    }
    await query(
      `UPDATE loads SET status = 'DISPATCHED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [req.params.id]
    );
    const data = await getLoadDetail(query, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    dtLogger.error('loads_approve_draft_failed', error, { loadId: req.params.id });
    res.status(500).json({ success: false, error: 'Failed to approve draft' });
  }
});

// DELETE /api/loads/:id (admin, dispatch only; only NEW or DRAFT loads)
router.delete('/:id', requireRole(['admin', 'dispatch']), async (req, res) => {
  try {
    const result = await query(
      'SELECT id, status FROM loads WHERE id = $1 AND tenant_id = $2 AND operating_entity_id = $3',
      [req.params.id, req.context?.tenantId || null, req.context?.operatingEntityId || null]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Load not found' });
    const status = normalizeEnum(result.rows[0].status);
    if (status !== 'DRAFT' && status !== 'NEW') {
      return res.status(400).json({ success: false, error: 'Only New or Draft loads can be deleted' });
    }
    await query('DELETE FROM loads WHERE id = $1 AND tenant_id = $2 AND operating_entity_id = $3', [req.params.id, req.context?.tenantId || null, req.context?.operatingEntityId || null]);
    res.json({ success: true });
  } catch (error) {
    dtLogger.error('loads_delete_failed', error, { loadId: req.params.id });
    res.status(500).json({ success: false, error: 'Failed to delete load' });
  }
});

// GET /api/loads/:id
router.get('/:id', async (req, res) => {
  try {
    const data = await getLoadDetail(query, req.params.id, req.context || null);
    if (!data) return res.status(404).json({ success: false, error: 'Load not found' });
    if (!assertDriverCanAccessLoad(data, req)) {
      return res.status(404).json({ success: false, error: 'Load not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    dtLogger.error('loads_get_failed', error, { loadId: req.params.id });
    res.status(500).json({ success: false, error: 'Failed to fetch load' });
  }
});

// PUT /api/loads/:id (admin, dispatch only; driver cannot update load)
router.put('/:id', requireRole(['admin', 'dispatch']), async (req, res) => {
  const client = await getClient();
  try {
    const body = req.body || {};
    const updates = [];
    const values = [];
    let idx = 1;
    const status = body.status ? normalizeEnum(body.status) : null;
    const billingStatus = body.billingStatus ? normalizeEnum(body.billingStatus) : null;
    if (status && !LOAD_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    if (billingStatus && !BILLING_STATUSES.includes(billingStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid billing status' });
    }

    const fieldMap = {
      loadNumber: 'load_number',
      status: 'status',
      billingStatus: 'billing_status',
      dispatcherUserId: 'dispatcher_user_id',
      driverId: 'driver_id',
      truckId: 'truck_id',
      trailerId: 'trailer_id',
      brokerId: 'broker_id',
      brokerName: 'broker_name',
      poNumber: 'po_number',
      rate: 'rate',
      notes: 'notes',
      completedDate: 'completed_date'
    };

    Object.keys(fieldMap).forEach(key => {
      if (body[key] !== undefined) {
        const dbField = fieldMap[key];
        const value = key === 'status' ? status : key === 'billingStatus' ? billingStatus : normalizeNullable(body[key]);
        updates.push(`${dbField} = $${idx}`);
        values.push(value);
        idx += 1;
      }
    });

    await client.query('BEGIN');
    if (updates.length > 0) {
      values.push(req.params.id);
      await client.query(
        `UPDATE loads SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} AND tenant_id = $${idx + 1} AND operating_entity_id = $${idx + 2}`,
        [...values, req.context?.tenantId || null, req.context?.operatingEntityId || null]
      );
    }

    const stopsInput = Array.isArray(body.stops) ? body.stops : (body.pickup || body.delivery ? buildStopsFromBody(body) : null);
    let loadPickupDate = null;
    let loadDeliveryDate = null;
    if (stopsInput) {
      const stopErrors = validateStops(stopsInput, true);
      if (stopErrors.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Invalid stops', details: stopErrors });
      }
      const pickups = stopsInput.filter((s) => normalizeEnum(s.stopType || s.stop_type) === 'PICKUP');
      const deliveries = stopsInput.filter((s) => normalizeEnum(s.stopType || s.stop_type) === 'DELIVERY');
      const firstPickup = pickups[0];
      const lastDelivery = deliveries.length ? deliveries[deliveries.length - 1] : null;
      loadPickupDate = firstPickup ? (firstPickup.date || firstPickup.stopDate || firstPickup.stop_date || null) : null;
      loadDeliveryDate = lastDelivery ? (lastDelivery.date || lastDelivery.stopDate || lastDelivery.stop_date || null) : null;

      await client.query('DELETE FROM load_stops WHERE load_id = $1', [req.params.id]);
      for (const stop of stopsInput) {
        const stopType = normalizeEnum(stop.stopType || stop.stop_type);
        const stopDate = stop.date || stop.stopDate || stop.stop_date;
        await client.query(
          `INSERT INTO load_stops (
            load_id, stop_type, stop_date, city, state, zip, address1, address2, sequence
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            req.params.id,
            stopType,
            normalizeNullable(stopDate),
            normalizeNullable(stop.city),
            normalizeNullable(stop.state),
            normalizeNullable(stop.zip),
            normalizeNullable(stop.address1),
            normalizeNullable(stop.address2),
            normalizeNullable(stop.sequence) || 1
          ]
        );
      }
      // Pickup/delivery dates are stored in load_stops — no denormalized columns on loads table
    }

    await client.query('COMMIT');
    const updated = await getLoadDetail(client, req.params.id, req.context || null);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Load not found' });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    await client.query('ROLLBACK');
    dtLogger.error('loads_update_failed', error, { loadId: req.params.id, body: req.body });
    res.status(500).json({ success: false, error: 'Failed to update load' });
  } finally {
    client.release();
  }
});

async function ensureCanAccessLoad(loadId, req, res) {
  const loadResult = await query(
    'SELECT id, driver_id FROM loads WHERE id = $1 AND tenant_id = $2 AND operating_entity_id = $3',
    [loadId, req.context?.tenantId || null, req.context?.operatingEntityId || null]
  );
  if (!loadResult.rows.length) {
    res.status(404).json({ success: false, error: 'Load not found' });
    return null;
  }
  if (!assertDriverCanAccessLoad(loadResult.rows[0], req)) {
    res.status(404).json({ success: false, error: 'Load not found' });
    return null;
  }
  return loadResult.rows[0];
}

// POST /api/loads/:id/attachments
router.post('/:id/attachments', upload.single('file'), async (req, res) => {
  try {
    const load = await ensureCanAccessLoad(req.params.id, req, res);
    if (!load) return;
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const type = normalizeEnum(req.body.type);
    if (!ATTACHMENT_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid attachment type' });
    }
    const notes = normalizeNullable(req.body.notes);
    const fileExt = path.extname(req.file.originalname || '').toLowerCase();
    const safeName = `load-${req.params.id}-${Date.now()}${fileExt || ''}`;
    const { key: storageKey } = await uploadBuffer({
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      prefix: `loads/${req.params.id}`,
      fileName: safeName
    });

    const result = await query(
      `INSERT INTO load_attachments (
        load_id, type, file_name, storage_key, mime_type, size_bytes, notes, uploaded_by_user_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
      [
        req.params.id,
        type,
        req.file.originalname || safeName,
        storageKey,
        req.file.mimetype,
        req.file.size,
        notes,
        req.user?.id || null
      ]
    );

    const downloadUrl = await getSignedDownloadUrl(storageKey);
    res.status(201).json({
      success: true,
      data: {
        ...result.rows[0],
        file_url: downloadUrl
      }
    });
  } catch (error) {
    dtLogger.error('load_attachment_upload_failed', error, { loadId: req.params.id });
    res.status(500).json({ success: false, error: 'Failed to upload attachment' });
  }
});

// GET /api/loads/:id/attachments
router.get('/:id/attachments', async (req, res) => {
  try {
    const load = await ensureCanAccessLoad(req.params.id, req, res);
    if (!load) return;
    const result = await query(
      `SELECT * FROM load_attachments WHERE load_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    const data = await Promise.all(
      result.rows.map(async row => ({
        ...row,
        file_url: row.storage_key ? await getSignedDownloadUrl(row.storage_key) : null
      }))
    );
    res.json({ success: true, data });
  } catch (error) {
    dtLogger.error('load_attachment_list_failed', error, { loadId: req.params.id });
    res.status(500).json({ success: false, error: 'Failed to fetch attachments' });
  }
});

// DELETE /api/loads/:id/attachments/:attachmentId
router.delete('/:id/attachments/:attachmentId', async (req, res) => {
  const { id: loadId, attachmentId } = req.params;
  try {
    const load = await ensureCanAccessLoad(loadId, req, res);
    if (!load) return;
    const existing = await query(
      'SELECT id, storage_key FROM load_attachments WHERE id = $1 AND load_id = $2',
      [attachmentId, loadId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, error: 'Attachment not found' });
    }
    const row = existing.rows[0];
    const storageKey = row.storage_key;

    // Delete DB row first so the document is always removed from the app even if R2 cleanup fails
    await query('DELETE FROM load_attachments WHERE id = $1 AND load_id = $2', [attachmentId, loadId]);

    if (storageKey) {
      try {
        await deleteObject(storageKey);
      } catch (r2Err) {
        dtLogger.error('load_attachment_r2_delete_failed', r2Err, { loadId, attachmentId, storageKey });
        // Still return success; the DB row is already gone
      }
    }

    res.json({ success: true, message: 'Attachment deleted' });
  } catch (error) {
    dtLogger.error('load_attachment_delete_failed', error, { loadId, attachmentId });
    res.status(500).json({ success: false, error: 'Failed to delete attachment' });
  }
});

// PUT /api/loads/:id/attachments/:attachmentId (replace file and/or metadata on R2)
router.put('/:id/attachments/:attachmentId', upload.single('file'), async (req, res) => {
  const { id: loadId, attachmentId } = req.params;
  try {
    const load = await ensureCanAccessLoad(loadId, req, res);
    if (!load) return;
    const existing = await query(
      'SELECT * FROM load_attachments WHERE id = $1 AND load_id = $2',
      [attachmentId, loadId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, error: 'Attachment not found' });
    }
    const oldRow = existing.rows[0];
    const type = req.body.type ? normalizeEnum(req.body.type) : oldRow.type;
    if (!ATTACHMENT_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid attachment type' });
    }
    const notes = req.body.notes !== undefined ? normalizeNullable(req.body.notes) : oldRow.notes;

    let file_name = oldRow.file_name;
    let storage_key = oldRow.storage_key;
    let mime_type = oldRow.mime_type;
    let size_bytes = oldRow.size_bytes;

    if (req.file) {
      const fileExt = path.extname(req.file.originalname || '').toLowerCase();
      const safeName = `load-${loadId}-${Date.now()}${fileExt || ''}`;
      const { key: newKey } = await uploadBuffer({
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
        prefix: `loads/${loadId}`,
        fileName: safeName
      });
      file_name = req.file.originalname || safeName;
      storage_key = newKey;
      mime_type = req.file.mimetype;
      size_bytes = req.file.size;
      if (oldRow.storage_key && oldRow.storage_key !== newKey) {
        await deleteObject(oldRow.storage_key);
      }
    }

    await query(
      `UPDATE load_attachments SET
        type = $1, file_name = $2, storage_key = $3, mime_type = $4, size_bytes = $5, notes = $6
       WHERE id = $7 AND load_id = $8`,
      [type, file_name, storage_key, mime_type, size_bytes, notes, attachmentId, loadId]
    );

    const updated = await query(
      'SELECT * FROM load_attachments WHERE id = $1 AND load_id = $2',
      [attachmentId, loadId]
    );
    const row = updated.rows[0];
    const downloadUrl = row.storage_key ? await getSignedDownloadUrl(row.storage_key) : null;
    res.json({
      success: true,
      data: { ...row, file_url: downloadUrl }
    });
  } catch (error) {
    dtLogger.error('load_attachment_update_failed', error, { loadId, attachmentId });
    res.status(500).json({ success: false, error: 'Failed to update attachment' });
  }
});

// POST /api/loads/ai-extract
router.post('/ai-extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    if (req.file.mimetype !== 'application/pdf' && !req.file.originalname.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ success: false, error: 'Only PDF files are supported for AI extraction' });
    }

    dtLogger.info('loads_ai_extract_request', { filename: req.file.originalname, size: req.file.size });
    const data = await extractLoadFromPdf(req.file.buffer, req.file.originalname || 'upload.pdf');

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    // Log detailed rate-limit information if available
    const status = error?.response?.status;
    const data = error?.response?.data;
    const headers = error?.response?.headers || {};

    const rateInfo = {
      status,
      errorBody: data,
      retryAfter: headers['retry-after'] || headers['Retry-After'] || null,
      rateLimits: {
        limitRequests: headers['x-ratelimit-limit-requests'],
        remainingRequests: headers['x-ratelimit-remaining-requests'],
        resetRequests: headers['x-ratelimit-reset-requests'],
        limitTokens: headers['x-ratelimit-limit-tokens'],
        remainingTokens: headers['x-ratelimit-remaining-tokens'],
        resetTokens: headers['x-ratelimit-reset-tokens']
      }
    };

    // Also log to console so it's visible even if dtLogger omits context
    console.error('loads_ai_extract_failed rateInfo:', JSON.stringify(rateInfo, null, 2));
    dtLogger.error('loads_ai_extract_failed', error, { rateInfo });

    const message = error && error.message ? String(error.message) : 'Unknown error';
    return res.status(500).json({
      success: false,
      error: 'Failed to extract load details from PDF',
      details: message
    });
  }
});

module.exports = router;
