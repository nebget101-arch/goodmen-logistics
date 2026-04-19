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
      // Find the effective date of the current load (earliest pickup stop or load created_at)
      const currentLoadDate = firstPickup?.stop_date || loadRow.pickup_date || loadRow.created_at || null;

      const prevResult = await exec(
        `SELECT s.zip, s.city, s.state
         FROM loads l
         JOIN load_stops s ON s.load_id = l.id
         WHERE l.driver_id = $1
           AND l.id <> $2
           AND s.stop_type = 'DELIVERY'
           AND COALESCE(s.stop_date, l.completed_date, l.created_at) <=
               COALESCE($3::date, l.created_at)
         ORDER BY COALESCE(s.stop_date, l.completed_date, l.created_at) DESC,
                  l.created_at DESC
         LIMIT 1`,
        [loadRow.driver_id, loadId, currentLoadDate]
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
 *     summary: List loads with filtering, sorting, and pagination
 *     description: >
 *       Returns a paginated list of loads. Supports filtering by load status, billing status,
 *       driver, broker, date range, and free-text search. Drivers are scoped to their own loads.
 *       Load statuses: DRAFT, NEW, CANCELLED, CANCELED, TONU, DISPATCHED, EN_ROUTE, PICKED_UP,
 *       IN_TRANSIT, DELIVERED, COMPLETED. Billing statuses: PENDING, CANCELLED, CANCELED,
 *       BOL_RECEIVED, INVOICED, SENT_TO_FACTORING, FUNDED, PAID. DRAFT loads appear first
 *       when no status filter is applied.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, NEW, CANCELLED, CANCELED, TONU, DISPATCHED, EN_ROUTE, PICKED_UP, IN_TRANSIT, DELIVERED, COMPLETED]
 *         description: Filter by load status
 *       - in: query
 *         name: billingStatus
 *         schema:
 *           type: string
 *           enum: [PENDING, CANCELLED, CANCELED, BOL_RECEIVED, INVOICED, SENT_TO_FACTORING, FUNDED, PAID]
 *         description: Filter by billing status
 *       - in: query
 *         name: driverId
 *         schema:
 *           type: string
 *         description: Filter by driver ID (ignored for driver role; auto-scoped)
 *       - in: query
 *         name: brokerId
 *         schema:
 *           type: string
 *         description: Filter by broker ID
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Free-text search on load number, broker name, or driver name
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter loads with pickup or delivery date on or after this date
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter loads with pickup or delivery date on or before this date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number (1-based)
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 25
 *           maximum: 200
 *         description: Number of loads per page (max 200)
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [load_number, pickup_date, rate, completed_date, created_at]
 *         description: Column to sort by (default created_at)
 *       - in: query
 *         name: sortDir
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort direction (default desc; pickup_date defaults to asc)
 *     responses:
 *       200:
 *         description: Paginated list of loads
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 meta:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     pageSize:
 *                       type: integer
 *                     total:
 *                       type: integer
 *       400:
 *         description: Invalid status or billing status filter
 *       403:
 *         description: Forbidden - insufficient role or driver not linked
 *       500:
 *         description: Server error
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
    // FN-746: needs_review filter — true string activates filter
    const needsReview = req.query.needsReview === 'true';

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
    // FN-746: filter to loads flagged for review
    if (needsReview) {
      where.push('l.needs_review = true');
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
        COALESCE(att.attachment_types, ARRAY[]::text[]) as attachment_types,
        COALESCE(l.needs_review, false) as needs_review
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

/**
 * @openapi
 * /api/loads:
 *   post:
 *     summary: Create a new load
 *     description: >
 *       Creates a new load with stops, driver/truck/trailer assignments, and broker info.
 *       Requires admin or dispatch role. The load is created with the given status (default NEW)
 *       and billing status (default PENDING). Both PICKUP and DELIVERY stops are required.
 *       A load number is auto-generated if not provided (PO number is used as load number when
 *       available). Load status workflow: DRAFT -> NEW -> DISPATCHED -> EN_ROUTE -> PICKED_UP ->
 *       IN_TRANSIT -> DELIVERED -> COMPLETED. Loads can also be CANCELLED or TONU at any point.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [DRAFT, NEW, CANCELLED, CANCELED, TONU, DISPATCHED, EN_ROUTE, PICKED_UP, IN_TRANSIT, DELIVERED, COMPLETED]
 *                 default: NEW
 *               billingStatus:
 *                 type: string
 *                 enum: [PENDING, CANCELLED, CANCELED, BOL_RECEIVED, INVOICED, SENT_TO_FACTORING, FUNDED, PAID]
 *                 default: PENDING
 *               loadNumber:
 *                 type: string
 *               poNumber:
 *                 type: string
 *               driverId:
 *                 type: string
 *               truckId:
 *                 type: string
 *               trailerId:
 *                 type: string
 *               brokerId:
 *                 type: string
 *               brokerName:
 *                 type: string
 *               dispatcherUserId:
 *                 type: string
 *               rate:
 *                 type: number
 *               notes:
 *                 type: string
 *               completedDate:
 *                 type: string
 *                 format: date
 *               stops:
 *                 type: array
 *                 description: Array of stop objects (PICKUP and DELIVERY required)
 *                 items:
 *                   type: object
 *                   properties:
 *                     stopType:
 *                       type: string
 *                       enum: [PICKUP, DELIVERY]
 *                     date:
 *                       type: string
 *                       format: date
 *                     city:
 *                       type: string
 *                     state:
 *                       type: string
 *                     zip:
 *                       type: string
 *                     address1:
 *                       type: string
 *                     address2:
 *                       type: string
 *                     sequence:
 *                       type: integer
 *     responses:
 *       201:
 *         description: Load created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Full load detail with stops, attachments, and trip metrics
 *       400:
 *         description: Invalid status, billing status, or stops
 *       403:
 *         description: Forbidden - insufficient role or missing operating entity context
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/loads/bulk-rate-confirmations:
 *   post:
 *     summary: Bulk upload rate confirmation PDFs to create draft loads
 *     description: >
 *       Accepts up to 10 PDF rate confirmation files. Each PDF is processed via AI extraction
 *       to create a new load in DRAFT status with PENDING billing status. The extracted data
 *       includes broker, rate, pickup/delivery stops, and PO/load numbers. Each file is uploaded
 *       to R2 storage and linked as a RATE_CONFIRMATION attachment. Files are processed
 *       concurrently for performance. Requires admin or dispatch role.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - files
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: PDF files (max 10, max 15 MB each)
 *     responses:
 *       200:
 *         description: Bulk upload results (each file reports success or failure individually)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       success:
 *                         type: boolean
 *                       data:
 *                         type: object
 *                       filename:
 *                         type: string
 *                       error:
 *                         type: string
 *       400:
 *         description: No files uploaded, too many files, or non-PDF files
 *       403:
 *         description: Forbidden - insufficient role
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/loads/{id}/approve-draft:
 *   patch:
 *     summary: Approve a draft load and transition to DISPATCHED
 *     description: >
 *       Transitions a DRAFT load to DISPATCHED status. Optionally accepts load field updates
 *       (rate, broker, driver, stops, notes, etc.) to persist form changes and transition
 *       status in a single transaction. Only DRAFT loads can be approved. This is a key
 *       status workflow step: DRAFT -> DISPATCHED. Requires admin or dispatch role.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               loadNumber:
 *                 type: string
 *               billingStatus:
 *                 type: string
 *                 enum: [PENDING, CANCELLED, CANCELED, BOL_RECEIVED, INVOICED, SENT_TO_FACTORING, FUNDED, PAID]
 *               dispatcherUserId:
 *                 type: string
 *               driverId:
 *                 type: string
 *               truckId:
 *                 type: string
 *               trailerId:
 *                 type: string
 *               brokerId:
 *                 type: string
 *               brokerName:
 *                 type: string
 *               poNumber:
 *                 type: string
 *               rate:
 *                 type: number
 *               notes:
 *                 type: string
 *               completedDate:
 *                 type: string
 *                 format: date
 *               stops:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     stopType:
 *                       type: string
 *                       enum: [PICKUP, DELIVERY]
 *                     date:
 *                       type: string
 *                       format: date
 *                     city:
 *                       type: string
 *                     state:
 *                       type: string
 *                     zip:
 *                       type: string
 *                     address1:
 *                       type: string
 *                     address2:
 *                       type: string
 *                     sequence:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Load approved and transitioned to DISPATCHED
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Full load detail with stops, attachments, and trip metrics
 *       400:
 *         description: Load is not in DRAFT status, or invalid billing status / stops
 *       403:
 *         description: Forbidden - insufficient role
 *       404:
 *         description: Load not found
 *       500:
 *         description: Server error
 */
// PATCH /api/loads/:id/approve-draft (admin, dispatch only; DRAFT -> DISPATCHED)
// Accepts optional body with load fields (rate, broker, stops, driver, notes, etc.)
// to persist form changes AND transition status in a single transaction.
router.patch('/:id/approve-draft', requireRole(['admin', 'dispatch']), async (req, res) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const result = await client.query('SELECT id, status FROM loads WHERE id = $1', [req.params.id]);
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Load not found' });
    }
    if (normalizeEnum(result.rows[0].status) !== 'DRAFT') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Only draft loads can be approved' });
    }

    const body = req.body || {};
    const hasBody = Object.keys(body).length > 0;

    // If body contains load fields, apply them before transitioning status
    if (hasBody) {
      const updates = [];
      const values = [];
      let idx = 1;
      const billingStatus = body.billingStatus ? normalizeEnum(body.billingStatus) : null;
      if (billingStatus && !BILLING_STATUSES.includes(billingStatus)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Invalid billing status' });
      }

      const fieldMap = {
        loadNumber: 'load_number',
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
          const value = key === 'billingStatus' ? billingStatus : normalizeNullable(body[key]);
          updates.push(`${fieldMap[key]} = $${idx}`);
          values.push(value);
          idx += 1;
        }
      });

      if (updates.length > 0) {
        values.push(req.params.id);
        await client.query(
          `UPDATE loads SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx}`,
          values
        );
      }

      // Handle stops update
      const stopsInput = Array.isArray(body.stops) ? body.stops : (body.pickup || body.delivery ? buildStopsFromBody(body) : null);
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
        const loadPickupDate = firstPickup ? (firstPickup.date || firstPickup.stopDate || firstPickup.stop_date || null) : null;
        const loadDeliveryDate = lastDelivery ? (lastDelivery.date || lastDelivery.stopDate || lastDelivery.stop_date || null) : null;

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

        if (loadPickupDate != null || loadDeliveryDate != null) {
          const loadDateUpdates = [];
          const loadDateValues = [];
          let loadDateIdx = 1;
          if (loadPickupDate != null) {
            loadDateUpdates.push(`pickup_date = $${loadDateIdx}`);
            loadDateValues.push(normalizeNullable(loadPickupDate));
            loadDateIdx += 1;
          }
          if (loadDeliveryDate != null) {
            loadDateUpdates.push(`delivery_date = $${loadDateIdx}`);
            loadDateValues.push(normalizeNullable(loadDeliveryDate));
            loadDateIdx += 1;
          }
          if (loadDateUpdates.length > 0) {
            loadDateValues.push(req.params.id);
            await client.query(
              `UPDATE loads SET ${loadDateUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${loadDateIdx}`,
              loadDateValues
            );
          }
        }
      }
    }

    // Transition status to DISPATCHED
    await client.query(
      `UPDATE loads SET status = 'DISPATCHED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [req.params.id]
    );

    await client.query('COMMIT');
    const data = await getLoadDetail(client, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    await client.query('ROLLBACK');
    dtLogger.error('loads_approve_draft_failed', error, { loadId: req.params.id, body: req.body });
    res.status(500).json({ success: false, error: 'Failed to approve draft' });
  } finally {
    client.release();
  }
});

/**
 * @openapi
 * /api/loads/{id}:
 *   delete:
 *     summary: Delete a load
 *     description: >
 *       Permanently deletes a load. Only loads in DRAFT or NEW status can be deleted.
 *       Loads that have progressed beyond NEW (e.g., DISPATCHED, IN_TRANSIT, DELIVERED)
 *       cannot be deleted and should be CANCELLED instead. Requires admin or dispatch role.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *     responses:
 *       200:
 *         description: Load deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Load is not in DRAFT or NEW status
 *       403:
 *         description: Forbidden - insufficient role
 *       404:
 *         description: Load not found
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/loads/{id}:
 *   get:
 *     summary: Get load details by ID
 *     description: >
 *       Returns the full load detail including stops, attachments (with signed download URLs),
 *       trip metrics (empty miles, loaded miles, total miles, rate per mile), driver name,
 *       and broker name. Drivers are scoped to their own loads only.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *     responses:
 *       200:
 *         description: Load detail returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Full load detail with stops, attachments, and trip metrics
 *       404:
 *         description: Load not found (or driver does not have access)
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/loads/{id}:
 *   put:
 *     summary: Update a load
 *     description: >
 *       Updates load fields, status, billing status, and/or stops. Only provided fields are
 *       updated. When stops are provided, existing stops are replaced entirely. When status
 *       transitions to DELIVERED or COMPLETED, the completed_date is auto-set if not already
 *       present. Requires admin or dispatch role. Load status workflow: DRAFT -> NEW ->
 *       DISPATCHED -> EN_ROUTE -> PICKED_UP -> IN_TRANSIT -> DELIVERED -> COMPLETED.
 *       Loads can also be set to CANCELLED or TONU.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               loadNumber:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [DRAFT, NEW, CANCELLED, CANCELED, TONU, DISPATCHED, EN_ROUTE, PICKED_UP, IN_TRANSIT, DELIVERED, COMPLETED]
 *               billingStatus:
 *                 type: string
 *                 enum: [PENDING, CANCELLED, CANCELED, BOL_RECEIVED, INVOICED, SENT_TO_FACTORING, FUNDED, PAID]
 *               dispatcherUserId:
 *                 type: string
 *               driverId:
 *                 type: string
 *               truckId:
 *                 type: string
 *               trailerId:
 *                 type: string
 *               brokerId:
 *                 type: string
 *               brokerName:
 *                 type: string
 *               poNumber:
 *                 type: string
 *               rate:
 *                 type: number
 *               notes:
 *                 type: string
 *               completedDate:
 *                 type: string
 *                 format: date
 *               stops:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     stopType:
 *                       type: string
 *                       enum: [PICKUP, DELIVERY]
 *                     date:
 *                       type: string
 *                       format: date
 *                     city:
 *                       type: string
 *                     state:
 *                       type: string
 *                     zip:
 *                       type: string
 *                     address1:
 *                       type: string
 *                     address2:
 *                       type: string
 *                     sequence:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Load updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Full load detail with stops, attachments, and trip metrics
 *       400:
 *         description: Invalid status, billing status, or stops
 *       403:
 *         description: Forbidden - insufficient role
 *       404:
 *         description: Load not found
 *       500:
 *         description: Server error
 */
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

    // Auto-set completed_date when status transitions to DELIVERED or COMPLETED (if not already set)
    if (status && ['DELIVERED', 'COMPLETED'].includes(status)) {
      await client.query(
        `UPDATE loads SET completed_date = COALESCE(completed_date, delivery_date, CURRENT_DATE), updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND completed_date IS NULL`,
        [req.params.id]
      );
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

/**
 * @openapi
 * /api/loads/{id}/attachments:
 *   post:
 *     summary: Upload an attachment to a load
 *     description: >
 *       Uploads a file (PDF or image) to R2 storage and links it as an attachment to the
 *       specified load. Requires a valid attachment type. Drivers can only upload to their
 *       own loads. Max file size is 15 MB.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - type
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: PDF or image file (max 15 MB)
 *               type:
 *                 type: string
 *                 enum: [RATE_CONFIRMATION, BOL, LUMPER, OTHER, CONFIRMATION, PROOF_OF_DELIVERY, ROADSIDE_MAINTENANCE_RECEIPT]
 *                 description: Attachment type
 *               notes:
 *                 type: string
 *                 description: Optional notes for the attachment
 *     responses:
 *       201:
 *         description: Attachment uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     load_id:
 *                       type: string
 *                     type:
 *                       type: string
 *                     file_name:
 *                       type: string
 *                     mime_type:
 *                       type: string
 *                     size_bytes:
 *                       type: integer
 *                     file_url:
 *                       type: string
 *                       description: Signed download URL
 *       400:
 *         description: No file uploaded or invalid attachment type
 *       404:
 *         description: Load not found
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/loads/{id}/attachments:
 *   get:
 *     summary: List attachments for a load
 *     description: >
 *       Returns all attachments for the specified load, ordered by creation date descending.
 *       Each attachment includes a signed download URL for the file. Drivers can only access
 *       attachments on their own loads.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *     responses:
 *       200:
 *         description: List of attachments
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       load_id:
 *                         type: string
 *                       type:
 *                         type: string
 *                       file_name:
 *                         type: string
 *                       mime_type:
 *                         type: string
 *                       size_bytes:
 *                         type: integer
 *                       file_url:
 *                         type: string
 *                         description: Signed download URL
 *       404:
 *         description: Load not found
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/loads/{id}/attachments/{attachmentId}:
 *   delete:
 *     summary: Delete an attachment from a load
 *     description: >
 *       Deletes an attachment record from the database and removes the file from R2 storage.
 *       The DB row is deleted first so the document is removed from the app even if R2
 *       cleanup fails. Drivers can only delete attachments on their own loads.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *       - in: path
 *         name: attachmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Attachment ID
 *     responses:
 *       200:
 *         description: Attachment deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       404:
 *         description: Load or attachment not found
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/loads/{id}/attachments/{attachmentId}:
 *   put:
 *     summary: Replace or update an attachment on a load
 *     description: >
 *       Updates an existing attachment's metadata (type, notes) and optionally replaces
 *       the file. When a new file is uploaded, the old file is deleted from R2 storage.
 *       If no new file is provided, only metadata fields are updated. Drivers can only
 *       update attachments on their own loads.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *       - in: path
 *         name: attachmentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Attachment ID
 *     requestBody:
 *       required: false
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Replacement file (PDF or image, max 15 MB)
 *               type:
 *                 type: string
 *                 enum: [RATE_CONFIRMATION, BOL, LUMPER, OTHER, CONFIRMATION, PROOF_OF_DELIVERY, ROADSIDE_MAINTENANCE_RECEIPT]
 *                 description: Attachment type (defaults to existing type if not provided)
 *               notes:
 *                 type: string
 *                 description: Attachment notes (defaults to existing notes if not provided)
 *     responses:
 *       200:
 *         description: Attachment updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     load_id:
 *                       type: string
 *                     type:
 *                       type: string
 *                     file_name:
 *                       type: string
 *                     mime_type:
 *                       type: string
 *                     size_bytes:
 *                       type: integer
 *                     file_url:
 *                       type: string
 *                       description: Signed download URL
 *       400:
 *         description: Invalid attachment type
 *       404:
 *         description: Load or attachment not found
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/loads/ai-extract:
 *   post:
 *     summary: Extract load details from a rate confirmation PDF using AI
 *     description: >
 *       Accepts a PDF file and uses AI extraction to parse rate confirmation data including
 *       broker name, rate, PO/load number, and pickup/delivery stop details. Returns the
 *       extracted data without creating a load (use POST /api/loads or bulk-rate-confirmations
 *       to persist). Only PDF files are supported.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: PDF rate confirmation file (max 15 MB)
 *     responses:
 *       200:
 *         description: Extracted load data from the PDF
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: AI-extracted load fields (brokerName, rate, pickup, delivery, stops, poNumber, loadId, etc.)
 *       400:
 *         description: No file uploaded or file is not a PDF
 *       500:
 *         description: AI extraction failed (may include rate-limit details)
 */
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

// ─── Granular Stop Endpoints (FN-748) ────────────────────────────────────────

/**
 * @openapi
 * /api/loads/{id}/stops:
 *   post:
 *     summary: Add a stop to an existing load
 *     description: >
 *       Appends a new stop to the load. The stop sequence is auto-assigned as
 *       max(existing sequences) + 1. Trip metrics are recalculated and returned
 *       in the full load response. Requires admin or dispatch role.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stop_type]
 *             properties:
 *               stop_type:
 *                 type: string
 *                 enum: [PICKUP, DELIVERY]
 *               stop_date:
 *                 type: string
 *                 format: date
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               zip:
 *                 type: string
 *               address1:
 *                 type: string
 *               address2:
 *                 type: string
 *     responses:
 *       200:
 *         description: Full updated load with stops and recalculated trip metrics
 *       400:
 *         description: Invalid stop_type
 *       404:
 *         description: Load not found
 *       500:
 *         description: Server error
 */
router.post('/:id/stops', requireRole(['admin', 'dispatch']), async (req, res) => {
  const loadId = req.params.id;
  const body = req.body || {};
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const loadCheck = await client.query(
      'SELECT id FROM loads WHERE id = $1',
      [loadId]
    );
    if (loadCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Load not found' });
    }
    const stopType = normalizeEnum(body.stop_type || body.stopType);
    if (!STOP_TYPES.includes(stopType)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: `Invalid stop_type: ${stopType}` });
    }
    const seqResult = await client.query(
      'SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM load_stops WHERE load_id = $1',
      [loadId]
    );
    const nextSeq = (parseInt(seqResult.rows[0]?.max_seq ?? 0, 10)) + 1;
    await client.query(
      `INSERT INTO load_stops (load_id, stop_type, stop_date, city, state, zip, address1, address2, sequence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        loadId,
        stopType,
        body.stop_date || body.stopDate || null,
        body.city || null,
        body.state || null,
        body.zip || null,
        body.address1 || null,
        body.address2 || null,
        nextSeq
      ]
    );
    await client.query('COMMIT');
    const detail = await getLoadDetail(client, loadId, req.context || null);
    res.json({ success: true, data: detail });
  } catch (error) {
    await client.query('ROLLBACK');
    dtLogger.error('loads_add_stop_failed', error, { loadId });
    res.status(500).json({ success: false, error: 'Failed to add stop' });
  } finally {
    client.release();
  }
});

/**
 * @openapi
 * /api/loads/{id}/stops/reorder:
 *   patch:
 *     summary: Reorder stops on a load
 *     description: >
 *       Accepts an array of {stopId, newSequence} pairs and persists the new
 *       ordering. Trip metrics are recalculated in the response. This route is
 *       registered BEFORE /:id/stops/:stopId to avoid the literal string
 *       "reorder" being captured as a stopId parameter. Requires admin or
 *       dispatch role.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               required: [stopId, newSequence]
 *               properties:
 *                 stopId:
 *                   type: string
 *                 newSequence:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Full updated load with stops in new order
 *       400:
 *         description: Body must be a non-empty array
 *       404:
 *         description: Load not found
 *       500:
 *         description: Server error
 */
router.patch('/:id/stops/reorder', requireRole(['admin', 'dispatch']), async (req, res) => {
  const loadId = req.params.id;
  const body = req.body;
  if (!Array.isArray(body) || body.length === 0) {
    return res.status(400).json({ success: false, error: 'Body must be a non-empty array of {stopId, newSequence}' });
  }
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const loadCheck = await client.query(
      'SELECT id FROM loads WHERE id = $1',
      [loadId]
    );
    if (loadCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Load not found' });
    }
    for (const item of body) {
      if (!item.stopId || item.newSequence == null) continue;
      await client.query(
        'UPDATE load_stops SET sequence = $1 WHERE id = $2 AND load_id = $3',
        [item.newSequence, item.stopId, loadId]
      );
    }
    await client.query('COMMIT');
    const detail = await getLoadDetail(client, loadId, req.context || null);
    res.json({ success: true, data: detail });
  } catch (error) {
    await client.query('ROLLBACK');
    dtLogger.error('loads_reorder_stops_failed', error, { loadId });
    res.status(500).json({ success: false, error: 'Failed to reorder stops' });
  } finally {
    client.release();
  }
});

/**
 * @openapi
 * /api/loads/{id}/stops/{stopId}:
 *   patch:
 *     summary: Update a single stop on a load
 *     description: >
 *       Performs a partial update on one stop. Only the fields provided in the
 *       request body are changed. Trip metrics are recalculated and returned in
 *       the full load response. Requires admin or dispatch role.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *       - in: path
 *         name: stopId
 *         required: true
 *         schema:
 *           type: string
 *         description: Stop ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stop_type:
 *                 type: string
 *                 enum: [PICKUP, DELIVERY]
 *               stop_date:
 *                 type: string
 *                 format: date
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               zip:
 *                 type: string
 *               address1:
 *                 type: string
 *               address2:
 *                 type: string
 *               sequence:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Full updated load with recalculated trip metrics
 *       400:
 *         description: No updatable fields provided, or invalid stop_type
 *       404:
 *         description: Stop not found on this load
 *       500:
 *         description: Server error
 */
router.patch('/:id/stops/:stopId', requireRole(['admin', 'dispatch']), async (req, res) => {
  const { id: loadId, stopId } = req.params;
  const body = req.body || {};
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const stopCheck = await client.query(
      'SELECT id FROM load_stops WHERE id = $1 AND load_id = $2',
      [stopId, loadId]
    );
    if (stopCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Stop not found on this load' });
    }
    const sets = [];
    const params = [];
    const addField = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (body.stop_type !== undefined || body.stopType !== undefined) {
      const stopType = normalizeEnum(body.stop_type || body.stopType);
      if (!STOP_TYPES.includes(stopType)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: `Invalid stop_type: ${stopType}` });
      }
      addField('stop_type', stopType);
    }
    if (body.stop_date !== undefined || body.stopDate !== undefined) {
      addField('stop_date', body.stop_date ?? body.stopDate ?? null);
    }
    if (body.city !== undefined) addField('city', body.city || null);
    if (body.state !== undefined) addField('state', body.state || null);
    if (body.zip !== undefined) addField('zip', body.zip || null);
    if (body.address1 !== undefined) addField('address1', body.address1 || null);
    if (body.address2 !== undefined) addField('address2', body.address2 || null);
    if (body.sequence !== undefined) addField('sequence', body.sequence);
    if (sets.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }
    params.push(stopId);
    await client.query(
      `UPDATE load_stops SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );
    await client.query('COMMIT');
    const detail = await getLoadDetail(client, loadId, req.context || null);
    res.json({ success: true, data: detail });
  } catch (error) {
    await client.query('ROLLBACK');
    dtLogger.error('loads_update_stop_failed', error, { loadId, stopId });
    res.status(500).json({ success: false, error: 'Failed to update stop' });
  } finally {
    client.release();
  }
});

/**
 * @openapi
 * /api/loads/{id}/stops/{stopId}:
 *   delete:
 *     summary: Remove a stop from a load
 *     description: >
 *       Deletes the specified stop and renumbers all remaining stops 1-based
 *       in their current order (by sequence, then created_at). Trip metrics
 *       are recalculated and returned in the full load response. Requires
 *       admin or dispatch role.
 *     tags:
 *       - Loads
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Load ID
 *       - in: path
 *         name: stopId
 *         required: true
 *         schema:
 *           type: string
 *         description: Stop ID to delete
 *     responses:
 *       200:
 *         description: Full updated load with remaining stops renumbered
 *       404:
 *         description: Stop not found on this load
 *       500:
 *         description: Server error
 */
router.delete('/:id/stops/:stopId', requireRole(['admin', 'dispatch']), async (req, res) => {
  const { id: loadId, stopId } = req.params;
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const stopCheck = await client.query(
      'SELECT id FROM load_stops WHERE id = $1 AND load_id = $2',
      [stopId, loadId]
    );
    if (stopCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Stop not found on this load' });
    }
    await client.query('DELETE FROM load_stops WHERE id = $1', [stopId]);
    // Renumber remaining stops 1-based in their existing order
    const remaining = await client.query(
      'SELECT id FROM load_stops WHERE load_id = $1 ORDER BY sequence, created_at',
      [loadId]
    );
    for (let i = 0; i < remaining.rows.length; i++) {
      await client.query(
        'UPDATE load_stops SET sequence = $1 WHERE id = $2',
        [i + 1, remaining.rows[i].id]
      );
    }
    await client.query('COMMIT');
    const detail = await getLoadDetail(client, loadId, req.context || null);
    res.json({ success: true, data: detail });
  } catch (error) {
    await client.query('ROLLBACK');
    dtLogger.error('loads_delete_stop_failed', error, { loadId, stopId });
    res.status(500).json({ success: false, error: 'Failed to delete stop' });
  } finally {
    client.release();
  }
});

module.exports = router;
