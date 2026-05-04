const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');
const auth = require('./auth-middleware');
// FN-479: Fire-and-forget risk score recalculation after HOS violations
const { triggerRecalculation: triggerRiskRecalc } = require('./safety-risk-engine');

// Protect all hos routes: admin, safety
router.use(auth(['admin', 'safety']));

/**
 * @openapi
 * /api/hos:
 *   get:
 *     summary: List all HOS records
 *     description: Retrieves all Hours of Service records joined with driver names. Per 49 CFR Part 395 — Hours of Service of Drivers.
 *     tags:
 *       - HOS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of HOS records with driver names
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   driver_id:
 *                     type: integer
 *                   record_date:
 *                     type: string
 *                     format: date
 *                   on_duty_hours:
 *                     type: number
 *                   driving_hours:
 *                     type: number
 *                   violations:
 *                     type: string
 *                   driverName:
 *                     type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// GET all HOS records
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const params = [];
    let whereClause = '';
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      whereClause = `WHERE d.operating_entity_id = $${params.length}`;
    }
    
    const result = await query(`
      SELECT hr.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM hos_records hr
      JOIN drivers d ON hr.driver_id = d.id
      ${whereClause}
      ORDER BY hr.record_date DESC
    `, params);
    
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'hos_records', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/hos', 200, duration, { count: result.rows.length });
    
    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch HOS records', error, { path: '/api/hos' });
    dtLogger.trackRequest('GET', '/api/hos', 500, duration);
    
    console.error('Error fetching HOS records:', error);
    res.status(500).json({ message: 'Failed to fetch HOS records' });
  }
});

/**
 * @openapi
 * /api/hos/driver/{driverId}:
 *   get:
 *     summary: Get HOS records by driver
 *     description: Retrieves all HOS records for a specific driver. Per 49 CFR Part 395 — Hours of Service of Drivers.
 *     tags:
 *       - HOS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: driverId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Driver ID
 *     responses:
 *       200:
 *         description: Array of HOS records for the driver
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       404:
 *         description: Driver not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// GET HOS records by driver ID
router.get('/driver/:driverId', async (req, res) => {
  const startTime = Date.now();
  try {
    if (req.context?.operatingEntityId) {
      const driverRes = await query('SELECT operating_entity_id FROM drivers WHERE id = $1', [req.params.driverId]);
      if (driverRes.rows.length === 0 || driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
        return res.status(404).json({ message: 'Driver not found' });
      }
    }

    const result = await query(`
      SELECT hr.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM hos_records hr
      JOIN drivers d ON hr.driver_id = d.id
      WHERE hr.driver_id = $1
      ORDER BY hr.record_date DESC
    `, [req.params.driverId]);
    
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'hos_records', duration, true, { driverId: req.params.driverId, count: result.rows.length });
    dtLogger.trackRequest('GET', `/api/hos/driver/${req.params.driverId}`, 200, duration);
    
    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch driver HOS records', error, { driverId: req.params.driverId });
    dtLogger.trackRequest('GET', `/api/hos/driver/${req.params.driverId}`, 500, duration);
    
    console.error('Error fetching driver HOS records:', error);
    res.status(500).json({ message: 'Failed to fetch HOS records for driver' });
  }
});

/**
 * @openapi
 * /api/hos/date/{date}:
 *   get:
 *     summary: Get HOS records by date
 *     description: Retrieves all HOS records for a specific date. Per 49 CFR Part 395 — Hours of Service of Drivers.
 *     tags:
 *       - HOS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Date in YYYY-MM-DD format
 *     responses:
 *       200:
 *         description: Array of HOS records for the date
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// GET HOS records by date
router.get('/date/:date', async (req, res) => {
  const startTime = Date.now();
  try {
    const params = [req.params.date];
    let whereClause = 'WHERE DATE(hr.record_date) = $1';
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      whereClause += ` AND d.operating_entity_id = $${params.length}`;
    }
    
    const result = await query(`
      SELECT hr.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM hos_records hr
      JOIN drivers d ON hr.driver_id = d.id
      ${whereClause}
      ORDER BY hr.record_date DESC
    `, params);
    
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'hos_records', duration, true, { date: req.params.date, count: result.rows.length });
    dtLogger.trackRequest('GET', `/api/hos/date/${req.params.date}`, 200, duration);
    
    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch HOS records by date', error, { date: req.params.date });
    dtLogger.trackRequest('GET', `/api/hos/date/${req.params.date}`, 500, duration);
    
    console.error('Error fetching HOS records by date:', error);
    res.status(500).json({ message: 'Failed to fetch HOS records for date' });
  }
});

/**
 * @openapi
 * /api/hos/violations:
 *   get:
 *     summary: Get HOS violations
 *     description: Retrieves all HOS records that contain violations. Per 49 CFR Part 395 — Hours of Service violations tracking.
 *     tags:
 *       - HOS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of HOS records with violations (returns empty array on graceful degradation)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 */
// GET HOS violations
router.get('/violations', async (req, res) => {
  const startTime = Date.now();
  try {
    const params = [];
    let whereClause = 'WHERE hr.violations IS NOT NULL AND hr.violations != \'[]\'';
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      whereClause += ` AND d.operating_entity_id = $${params.length}`;
    }
    
    const result = await query(`
      SELECT hr.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM hos_records hr
      JOIN drivers d ON hr.driver_id = d.id
      ${whereClause}
      ORDER BY hr.record_date DESC
    `, params);
    
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'hos_records', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/hos/violations', 200, duration);
    
    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch HOS violations', error, { path: '/api/hos/violations' });
    console.error('Error fetching HOS violations:', error);
    // Graceful degradation for partial dev schemas.
    dtLogger.trackRequest('GET', '/api/hos/violations', 200, duration, { degraded: true });
    res.json([]);
  }
});

// FN-1309: parse `?limit=N` for the Smart Alerts upstream routes. Default 20,
// clamp to [1, 100], reject anything non-numeric so callers get 400, not a
// silent fallback that masks a coding bug in the aggregator.
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
 * /api/hos/violations/imminent:
 *   get:
 *     summary: Drivers near an HOS window violation (FN-1309)
 *     description: >
 *       Surfaces drivers whose most recent HOS record is within 60 minutes
 *       of the 11-hour driving limit or the 14-hour duty limit (49 CFR 395).
 *       Used by the Smart Alerts aggregator (FN-1161). Operating-entity
 *       scoped via `req.context.operatingEntityId` to match the sibling
 *       `/api/hos/violations` route.
 *     tags:
 *       - HOS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Number of drivers to return (default 20, max 100)
 *     responses:
 *       200:
 *         description: Imminent-violation driver list
 *       400:
 *         description: Invalid limit
 *       500:
 *         description: Server error
 */
// FN-1309: "imminent" = the driver's most recent HOS record puts them within
// IMMINENT_THRESHOLD_MIN of the 11-hour driving cap or 14-hour on-duty cap.
// We don't have running window-start timestamps in `hos_records`, so the
// alert anchors to the latest record_date and the aggregator's
// `windowEndsAt` is approximated as `now + minutesRemaining`. That keeps the
// route synchronous and tenant-cheap; the panel only needs a ranked list.
const IMMINENT_THRESHOLD_MIN = 60;
const HOS_DRIVE_CAP_HOURS = 11;
const HOS_DUTY_CAP_HOURS = 14;

router.get('/violations/imminent', async (req, res) => {
  const limit = parseAlertsTopLimit(req.query.limit);
  if (limit === null) {
    return res.status(400).json({ message: 'Invalid limit; expected positive integer' });
  }

  const startTime = Date.now();
  try {
    const params = [];
    let oeFilter = '';
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      oeFilter = `AND d.operating_entity_id = $${params.length}`;
    }
    params.push(HOS_DRIVE_CAP_HOURS);
    const driveCapIdx = params.length;
    params.push(HOS_DUTY_CAP_HOURS);
    const dutyCapIdx = params.length;
    params.push(IMMINENT_THRESHOLD_MIN);
    const thresholdIdx = params.length;
    params.push(limit);
    const limitIdx = params.length;

    // Latest record per driver, then derive minutes-remaining for each cap.
    const sql = `
      WITH latest AS (
        SELECT DISTINCT ON (hr.driver_id)
          hr.driver_id, hr.record_date, hr.driving_hours, hr.on_duty_hours
        FROM hos_records hr
        JOIN drivers d ON hr.driver_id = d.id
        WHERE 1=1 ${oeFilter}
        ORDER BY hr.driver_id, hr.record_date DESC
      ),
      windowed AS (
        SELECT
          l.driver_id,
          l.record_date,
          l.driving_hours,
          l.on_duty_hours,
          GREATEST(0, ($${driveCapIdx}::numeric - COALESCE(l.driving_hours, 0)) * 60)::int AS drive_minutes_remaining,
          GREATEST(0, ($${dutyCapIdx}::numeric - COALESCE(l.on_duty_hours, 0)) * 60)::int AS duty_minutes_remaining
        FROM latest l
      )
      SELECT
        w.driver_id,
        d.first_name,
        d.last_name,
        w.drive_minutes_remaining,
        w.duty_minutes_remaining,
        CASE
          WHEN w.drive_minutes_remaining <= w.duty_minutes_remaining THEN '11_hour_drive'
          ELSE '14_hour_duty'
        END AS window_type,
        LEAST(w.drive_minutes_remaining, w.duty_minutes_remaining) AS minutes_remaining
      FROM windowed w
      JOIN drivers d ON d.id = w.driver_id
      WHERE LEAST(w.drive_minutes_remaining, w.duty_minutes_remaining) <= $${thresholdIdx}::int
      ORDER BY minutes_remaining ASC
      LIMIT $${limitIdx}
    `;

    const result = await query(sql, params);
    const nowMs = Date.now();
    const data = result.rows.map((row) => {
      const minutesRemaining = Number(row.minutes_remaining) || 0;
      const driverName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || null;
      return {
        driverId: row.driver_id,
        driverName,
        minutesRemaining,
        windowType: row.window_type,
        windowEndsAt: new Date(nowMs + minutesRemaining * 60_000).toISOString()
      };
    });

    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('SELECT', 'hos_records', duration, true, { count: data.length });
    dtLogger.trackRequest('GET', '/api/hos/violations/imminent', 200, duration);

    return res.json(data);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('hos_imminent_failed', error, { path: '/api/hos/violations/imminent' });
    // Graceful degrade: missing table on partial dev schemas should not turn
    // into 500 + upstreamError on every Smart Alerts dashboard load.
    const code = error?.code ? String(error.code) : '';
    const message = error?.message ? String(error.message) : '';
    if (code === '42P01' || message.includes('does not exist')) {
      dtLogger.warn?.('hos_imminent_table_missing', { message });
      dtLogger.trackRequest('GET', '/api/hos/violations/imminent', 200, duration, { degraded: true });
      return res.json([]);
    }
    dtLogger.trackRequest('GET', '/api/hos/violations/imminent', 500, duration);
    return res.status(500).json({ message: 'Failed to fetch imminent HOS violations' });
  }
});

/**
 * @openapi
 * /api/hos:
 *   post:
 *     summary: Create a new HOS record
 *     description: Creates a new Hours of Service record for a driver. Triggers risk score recalculation if violations are present. Per 49 CFR Part 395 — Hours of Service of Drivers.
 *     tags:
 *       - HOS
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - driverId
 *               - recordDate
 *             properties:
 *               driverId:
 *                 type: integer
 *                 description: Driver ID
 *               recordDate:
 *                 type: string
 *                 format: date
 *                 description: Date of the HOS record
 *               onDutyHours:
 *                 type: number
 *                 description: Hours on duty (defaults to 0)
 *               drivingHours:
 *                 type: number
 *                 description: Hours driving (defaults to 0)
 *               violations:
 *                 type: array
 *                 items:
 *                   type: object
 *                 description: Array of violation objects
 *     responses:
 *       201:
 *         description: HOS record created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 driver_id:
 *                   type: integer
 *                 record_date:
 *                   type: string
 *                   format: date
 *                 on_duty_hours:
 *                   type: number
 *                 driving_hours:
 *                   type: number
 *                 violations:
 *                   type: string
 *       404:
 *         description: Driver not found
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
// POST create new HOS record
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const { driverId, recordDate, onDutyHours, drivingHours, violations } = req.body;
        // Validate driver belongs to active OE
        if (req.context?.operatingEntityId) {
          const driverRes = await query('SELECT operating_entity_id FROM drivers WHERE id = $1', [driverId]);
          if (driverRes.rows.length === 0) {
            return res.status(404).json({ message: 'Driver not found' });
          }
          if (driverRes.rows[0].operating_entity_id !== req.context.operatingEntityId) {
            return res.status(404).json({ message: 'Driver not found' });
          }
        }
    
    
    const result = await query(`
      INSERT INTO hos_records (driver_id, record_date, on_duty_hours, driving_hours, violations)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [driverId, recordDate, onDutyHours || 0, drivingHours || 0, JSON.stringify(violations || [])]);
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('INSERT', 'hos_records', duration, true, { recordId: result.rows[0].id });
    dtLogger.trackEvent('hos.created', { recordId: result.rows[0].id, driverId });
    dtLogger.trackRequest('POST', '/api/hos', 201, duration);

    // FN-479: fire-and-forget risk score recalculation when HOS violations present
    if (violations && violations.length > 0 && driverId) {
      const tid = req.context?.tenantId || req.user?.tenantId;
      if (tid) triggerRiskRecalc(tid, driverId).catch(() => {});
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to create HOS record', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/hos', 500, duration);
    
    console.error('Error creating HOS record:', error);
    res.status(500).json({ message: 'Failed to create HOS record' });
  }
});

module.exports = router;
