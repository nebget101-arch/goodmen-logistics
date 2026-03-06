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

const LOAD_STATUSES = ['NEW', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
const BILLING_STATUSES = ['PENDING', 'FUNDED', 'INVOICED', 'PAID'];
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
  const pickupStop = (stops || []).find(
    (s) => (s.stop_type || s.stopType || '').toString().trim().toUpperCase() === 'PICKUP'
  );
  const deliveryStop = (stops || []).find(
    (s) => (s.stop_type || s.stopType || '').toString().trim().toUpperCase() === 'DELIVERY'
  );

  const pickupZip = (pickupStop?.zip || '').toString().trim() || null;
  const deliveryZip = (deliveryStop?.zip || '').toString().trim() || null;

  let prevZip = null;
  if (loadRow?.driver_id) {
    try {
      const prevResult = await exec(
        `SELECT s.zip
         FROM loads l
         JOIN load_stops s ON s.load_id = l.id
         WHERE l.driver_id = $1
           AND l.id <> $2
           AND s.stop_type = 'DELIVERY'
         ORDER BY COALESCE(s.stop_date, l.delivery_date, l.completed_date, l.created_at) DESC
         LIMIT 1`,
        [loadRow.driver_id, loadId]
      );
      prevZip = (prevResult.rows[0]?.zip || '').toString().trim() || null;
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

async function getLoadDetail(clientOrQuery, loadId) {
  const exec = clientOrQuery.query ? clientOrQuery.query.bind(clientOrQuery) : query;
  const loadResult = await exec(
    `SELECT l.*,
            concat_ws(' ', d.first_name, d.last_name) as driver_name,
            COALESCE(b.name, l.broker_name) as broker_display_name
     FROM loads l
     LEFT JOIN drivers d ON l.driver_id = d.id
     LEFT JOIN brokers b ON l.broker_id = b.id
     WHERE l.id = $1`,
    [loadId]
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
  const pickupStop = (stopsResult.rows || []).find(
    (s) => (s.stop_type || s.stopType || '').toString().trim().toUpperCase() === 'PICKUP'
  );
  const deliveryStop = (stopsResult.rows || []).find(
    (s) => (s.stop_type || s.stopType || '').toString().trim().toUpperCase() === 'DELIVERY'
  );
  const pickupDate = pickupStop?.stop_date ?? loadRow.pickup_date ?? null;
  const deliveryDate = deliveryStop?.stop_date ?? loadRow.delivery_date ?? null;
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
    const sortDirRaw = (req.query.sortDir || 'desc').toString().trim().toLowerCase();
    const sortDir = sortDirRaw === 'asc' ? 'asc' : 'desc';
    const offset = (page - 1) * pageSize;

    const where = [];
    const params = [];

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
        OR COALESCE(b.name, l.broker_name, '') ILIKE $${params.length}
        OR concat_ws(' ', d.first_name, d.last_name) ILIKE $${params.length}
      )`);
    }
    if (dateFrom) {
      params.push(dateFrom);
      where.push(`COALESCE(delivery.stop_date, pickup.stop_date, l.completed_date, l.created_at)::date >= $${params.length}`);
    }
    if (dateTo) {
      params.push(dateTo);
      where.push(`COALESCE(delivery.stop_date, pickup.stop_date, l.completed_date, l.created_at)::date <= $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const baseSql = `
      FROM loads l
      LEFT JOIN drivers d ON l.driver_id = d.id
      LEFT JOIN brokers b ON l.broker_id = b.id
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
        ORDER BY sequence ASC
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
      pickup_date: 'COALESCE(pickup.stop_date, l.pickup_date)',
      rate: 'l.rate',
      // Sort "Completed" by delivery date when present, then completed_date, then created_at
      completed_date: 'COALESCE(delivery.stop_date, l.delivery_date, l.completed_date, l.created_at)',
      created_at: 'l.created_at'
    };
    const orderBy = sortMap[sortBy] || 'l.created_at';

    const dataSql = `
      SELECT
        l.id,
        l.load_number,
        UPPER(l.status::text) as status,
        UPPER(l.billing_status::text) as billing_status,
        l.rate,
        l.completed_date,
        COALESCE(pickup.stop_date, l.pickup_date) as pickup_date,
        COALESCE(delivery.stop_date, l.delivery_date) as delivery_date,
        pickup.city as pickup_city,
        pickup.state as pickup_state,
        delivery.city as delivery_city,
        delivery.state as delivery_state,
        concat_ws(' ', d.first_name, d.last_name) as driver_name,
        COALESCE(b.name, l.broker_name) as broker_name,
        l.po_number,
        l.notes,
        COALESCE(att.attachment_count, 0) as attachment_count,
        COALESCE(att.attachment_types, ARRAY[]::text[]) as attachment_types
      ${baseSql}
      ORDER BY ${orderBy} ${sortDir}
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
    const status = normalizeEnum(body.status) || 'NEW';
    const billingStatus = normalizeEnum(body.billingStatus) || 'PENDING';

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
        load_number, status, billing_status, dispatcher_user_id,
        driver_id, truck_id, trailer_id, broker_id, broker_name,
        po_number, rate, notes, completed_date,
        pickup_location, delivery_location, pickup_date, delivery_date
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *`,
      [
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
        normalizeNullable(body.completedDate),
        pickupLocation,
        deliveryLocation,
        normalizeNullable(pickupDate),
        normalizeNullable(deliveryDate)
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
          normalizeNullable(stop.date || stop.stopDate),
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

// GET /api/loads/:id
router.get('/:id', async (req, res) => {
  try {
    const data = await getLoadDetail(query, req.params.id);
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
        `UPDATE loads SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx}`,
        values
      );
    }

    const stopsInput = Array.isArray(body.stops) ? body.stops : (body.pickup || body.delivery ? buildStopsFromBody(body) : null);
    if (stopsInput) {
      const stopErrors = validateStops(stopsInput, true);
      if (stopErrors.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Invalid stops', details: stopErrors });
      }
      await client.query('DELETE FROM load_stops WHERE load_id = $1', [req.params.id]);
      for (const stop of stopsInput) {
        const stopType = normalizeEnum(stop.stopType || stop.stop_type);
        await client.query(
          `INSERT INTO load_stops (
            load_id, stop_type, stop_date, city, state, zip, address1, address2, sequence
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            req.params.id,
            stopType,
            normalizeNullable(stop.date || stop.stopDate),
            normalizeNullable(stop.city),
            normalizeNullable(stop.state),
            normalizeNullable(stop.zip),
            normalizeNullable(stop.address1),
            normalizeNullable(stop.address2),
            normalizeNullable(stop.sequence) || 1
          ]
        );
      }
    }

    await client.query('COMMIT');
    const updated = await getLoadDetail(client, req.params.id);
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
  const loadResult = await query('SELECT id, driver_id FROM loads WHERE id = $1', [loadId]);
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
