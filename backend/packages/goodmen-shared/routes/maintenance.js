const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const dtLogger = require('../utils/logger');
const auth = require('./auth-middleware');

// Protect all maintenance routes: admin, fleet
router.use(auth(['admin', 'fleet']));

/**
 * @openapi
 * /api/maintenance:
 *   get:
 *     summary: List all maintenance records
 *     description: >-
 *       Returns all maintenance records joined with vehicle data, ordered by
 *       date performed descending.
 *     tags:
 *       - Maintenance
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of maintenance records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   vehicleId:
 *                     type: string
 *                     format: uuid
 *                   type:
 *                     type: string
 *                   description:
 *                     type: string
 *                   datePerformed:
 *                     type: string
 *                     format: date
 *                   mileage:
 *                     type: integer
 *                   mechanicName:
 *                     type: string
 *                   cost:
 *                     type: number
 *                   status:
 *                     type: string
 *                   priority:
 *                     type: string
 *                   vehicleUnit:
 *                     type: string
 *                   vin:
 *                     type: string
 *       500:
 *         description: Server error
 */
// GET all maintenance records
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(`
      SELECT
        mr.id,
        mr.vehicle_id as "vehicleId",
        mr.type,
        mr.description,
        mr.date_performed as "datePerformed",
        mr.mileage,
        mr.mechanic_name as "mechanicName",
        mr.cost,
        mr.status,
        mr.priority,
        mr.customer_id as "customerId",
        mr.created_at as "createdAt",
        mr.updated_at as "updatedAt",
        v.unit_number as "vehicleUnit",
        v.vin
      FROM maintenance_records mr
      JOIN all_vehicles v ON mr.vehicle_id = v.id
      ORDER BY mr.date_performed DESC NULLS LAST, mr.created_at DESC
    `);
    const duration = Date.now() - startTime;

    dtLogger.trackDatabase('SELECT', 'maintenance_records', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/maintenance', 200, duration, { count: result.rows.length });

    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch maintenance records', error, { path: '/api/maintenance' });
    dtLogger.trackRequest('GET', '/api/maintenance', 500, duration);

    console.error('Error fetching maintenance records:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance records' });
  }
});

/**
 * @openapi
 * /api/maintenance/vehicle/{vehicleId}:
 *   get:
 *     summary: Get maintenance records by vehicle
 *     description: Returns all maintenance records for the specified vehicle, ordered by date descending.
 *     tags:
 *       - Maintenance
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vehicleId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Vehicle ID
 *     responses:
 *       200:
 *         description: Maintenance records for the vehicle
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
// GET maintenance records by vehicle ID
router.get('/vehicle/:vehicleId', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM maintenance_records WHERE vehicle_id = $1 ORDER BY date_performed DESC NULLS LAST, created_at DESC`,
      [req.params.vehicleId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching maintenance records by vehicle:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance records by vehicle' });
  }
});

/**
 * @openapi
 * /api/maintenance/status/pending:
 *   get:
 *     summary: Get pending maintenance records
 *     description: Returns all maintenance records with status pending, joined with vehicle data.
 *     tags:
 *       - Maintenance
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending maintenance records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Server error
 */
// GET pending maintenance
router.get('/status/pending', async (req, res) => {
  try {
    const result = await query(
      `SELECT
        mr.id,
        mr.vehicle_id as "vehicleId",
        mr.type,
        mr.description,
        mr.date_performed as "datePerformed",
        mr.mileage,
        mr.mechanic_name as "mechanicName",
        mr.cost,
        mr.status,
        mr.priority,
        mr.customer_id as "customerId",
        v.unit_number as "vehicleUnit",
        v.vin
      FROM maintenance_records mr
      JOIN all_vehicles v ON mr.vehicle_id = v.id
       WHERE mr.status = 'pending'
       ORDER BY mr.created_at DESC`,
      []
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching pending maintenance:', error);
    res.status(500).json({ message: 'Failed to fetch pending maintenance' });
  }
});

/**
 * @openapi
 * /api/maintenance:
 *   post:
 *     summary: Create a maintenance record
 *     description: Creates a new maintenance record for a vehicle.
 *     tags:
 *       - Maintenance
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vehicleId:
 *                 type: string
 *                 format: uuid
 *               type:
 *                 type: string
 *               description:
 *                 type: string
 *               datePerformed:
 *                 type: string
 *                 format: date
 *               mileage:
 *                 type: integer
 *               mechanicName:
 *                 type: string
 *               cost:
 *                 type: number
 *               status:
 *                 type: string
 *                 default: pending
 *               partsUsed:
 *                 type: array
 *                 items:
 *                   type: string
 *               nextServiceDue:
 *                 type: string
 *                 format: date
 *               priority:
 *                 type: string
 *               customerId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Maintenance record created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       500:
 *         description: Server error
 */
// POST create new maintenance record
router.post('/', async (req, res) => {
  try {
    const normalize = (value) => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'string' && value.trim() === '') return null;
      return value;
    };

    const {
      vehicleId,
      type,
      description,
      datePerformed,
      mileage,
      mechanicName,
      cost,
      status,
      partsUsed,
      nextServiceDue,
      priority,
      customerId
    } = req.body || {};

    const result = await query(
      `INSERT INTO maintenance_records (
        vehicle_id, type, description, date_performed, mileage,
        mechanic_name, cost, status, parts_used, next_service_due, priority, customer_id
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        normalize(vehicleId),
        normalize(type),
        normalize(description),
        normalize(datePerformed),
        normalize(mileage) ? parseInt(mileage, 10) : null,
        normalize(mechanicName),
        normalize(cost) ? Number(cost) : 0,
        normalize(status) || 'pending',
        Array.isArray(partsUsed) ? partsUsed : null,
        normalize(nextServiceDue),
        normalize(priority),
        normalize(customerId)
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating maintenance record:', error);
    res.status(500).json({ message: 'Failed to create maintenance record' });
  }
});

/**
 * @openapi
 * /api/maintenance/{id}:
 *   put:
 *     summary: Update a maintenance record
 *     description: >-
 *       Updates an existing maintenance record. Field names are converted from
 *       camelCase to snake_case automatically.
 *     tags:
 *       - Maintenance
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Maintenance record ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vehicleId:
 *                 type: string
 *                 format: uuid
 *               type:
 *                 type: string
 *               description:
 *                 type: string
 *               datePerformed:
 *                 type: string
 *                 format: date
 *               mileage:
 *                 type: integer
 *               mechanicName:
 *                 type: string
 *               cost:
 *                 type: number
 *               status:
 *                 type: string
 *               priority:
 *                 type: string
 *     responses:
 *       200:
 *         description: Maintenance record updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: No fields to update
 *       404:
 *         description: Maintenance record not found
 *       500:
 *         description: Server error
 */
// PUT update maintenance record
router.put('/:id', async (req, res) => {
  try {
    const excludedFields = ['id', 'created_at', 'updated_at'];
    const fields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(req.body || {}).forEach(key => {
      if (req.body[key] !== undefined && !excludedFields.includes(key)) {
        const column = key
          .replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        fields.push(`${column} = $${paramCount}`);
        values.push(req.body[key]);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(req.params.id);

    const result = await query(
      `UPDATE maintenance_records SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Maintenance record not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating maintenance record:', error);
    res.status(500).json({ message: 'Failed to update maintenance record' });
  }
});

module.exports = router;
