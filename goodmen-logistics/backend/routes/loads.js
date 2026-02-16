const express = require('express');
const router = express.Router();
// const { query } = require('../config/database');
// const dtLogger = require('../utils/dynatrace-logger');
const { loads } = require('../data/mock-data');
const auth = require('./auth-middleware');

// Protect all loads routes: admin, dispatch
router.use(auth(['admin', 'dispatch']));

// GET all loads
// Return all mock loads
router.get('/', (req, res) => {
  res.json(loads);
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
