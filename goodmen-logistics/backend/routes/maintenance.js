const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');
const auth = require('./auth-middleware');

// Protect all maintenance routes: admin, fleet
router.use(auth(['admin', 'fleet']));

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
      JOIN vehicles v ON mr.vehicle_id = v.id
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
       JOIN vehicles v ON mr.vehicle_id = v.id
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
