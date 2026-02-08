const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');

// GET all loads
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(`
      SELECT l.*, d.first_name || ' ' || d.last_name as "driverName", v.unit_number as "vehicleUnit"
      FROM loads l
      LEFT JOIN drivers d ON l.driver_id = d.id
      LEFT JOIN vehicles v ON l.vehicle_id = v.id
      ORDER BY l.pickup_date DESC
    `);
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'loads', duration, true, { count: result.rows.length });
    dtLogger.trackRequest('GET', '/api/loads', 200, duration, { count: result.rows.length });
    
    res.json(result.rows);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch loads', error, { path: '/api/loads' });
    dtLogger.trackRequest('GET', '/api/loads', 500, duration);
    
    console.error('Error fetching loads:', error);
    res.status(500).json({ message: 'Failed to fetch loads' });
  }
});

// GET load by ID
router.get('/:id', (req, res) => {
  const load = loads.find(l => l.id === req.params.id);
  if (load) {
    res.json(load);
  } else {
    res.status(404).json({ message: 'Load not found' });
  }
});

// GET loads by status
router.get('/status/:status', (req, res) => {
  const filteredLoads = loads.filter(l => l.status === req.params.status);
  res.json(filteredLoads);
});

// GET loads by driver
router.get('/driver/:driverId', (req, res) => {
  const driverLoads = loads.filter(l => l.driverId === req.params.driverId);
  res.json(driverLoads);
});

// POST create new load
router.post('/', (req, res) => {
  const newLoad = {
    id: require('uuid').v4(),
    loadNumber: `LD-${new Date().getFullYear()}-${String(loads.length + 1).padStart(3, '0')}`,
    ...req.body,
    status: req.body.status || 'pending'
  };
  loads.push(newLoad);
  res.status(201).json(newLoad);
});

// PUT update load (assign driver/vehicle, update status)
router.put('/:id', (req, res) => {
  const index = loads.findIndex(l => l.id === req.params.id);
  if (index !== -1) {
    loads[index] = { ...loads[index], ...req.body };
    res.json(loads[index]);
  } else {
    res.status(404).json({ message: 'Load not found' });
  }
});

// DELETE load
router.delete('/:id', (req, res) => {
  const index = loads.findIndex(l => l.id === req.params.id);
  if (index !== -1) {
    loads.splice(index, 1);
    res.json({ message: 'Load deleted successfully' });
  } else {
    res.status(404).json({ message: 'Load not found' });
  }
});

module.exports = router;
