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
      SELECT mr.*, v.unit_number as "vehicleUnit", v.vin
      FROM maintenance_records mr
      JOIN vehicles v ON mr.vehicle_id = v.id
      ORDER BY mr.service_date DESC
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
router.get('/vehicle/:vehicleId', (req, res) => {
  const records = maintenanceRecords.filter(m => m.vehicleId === req.params.vehicleId);
  res.json(records);
});

// GET pending maintenance
router.get('/status/pending', (req, res) => {
  const pending = maintenanceRecords.filter(m => m.status === 'pending');
  res.json(pending);
});

// POST create new maintenance record
router.post('/', (req, res) => {
  const newRecord = {
    id: require('uuid').v4(),
    ...req.body,
    status: req.body.status || 'pending'
  };
  maintenanceRecords.push(newRecord);
  res.status(201).json(newRecord);
});

// PUT update maintenance record
router.put('/:id', (req, res) => {
  const index = maintenanceRecords.findIndex(m => m.id === req.params.id);
  if (index !== -1) {
    maintenanceRecords[index] = { ...maintenanceRecords[index], ...req.body };
    res.json(maintenanceRecords[index]);
  } else {
    res.status(404).json({ message: 'Maintenance record not found' });
  }
});

module.exports = router;
