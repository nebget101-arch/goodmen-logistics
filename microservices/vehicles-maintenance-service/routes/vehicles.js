const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');

// GET all vehicles
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(`
      SELECT * FROM all_vehicles ORDER BY unit_number
    `);
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'vehicles', duration, true, { count: result.rows.length });
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

// GET vehicle by ID
router.get('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query('SELECT * FROM all_vehicles WHERE id = $1', [req.params.id]);
    const duration = Date.now() - startTime;
    
    if (result.rows.length > 0) {
      dtLogger.trackDatabase('SELECT', 'vehicles', duration, true, { vehicleId: req.params.id });
      dtLogger.trackRequest('GET', `/api/vehicles/${req.params.id}`, 200, duration);
      res.json(result.rows[0]);
    } else {
      dtLogger.warn('Vehicle not found', { vehicleId: req.params.id });
      dtLogger.trackRequest('GET', `/api/vehicles/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch vehicle', error, { vehicleId: req.params.id });
    dtLogger.trackRequest('GET', `/api/vehicles/${req.params.id}`, 500, duration);
    
    console.error('Error fetching vehicle:', error);
    res.status(500).json({ message: 'Failed to fetch vehicle' });
  }
});

// POST create new vehicle
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const { unit_number, make, model, year, vin, plate_number, status } = req.body;
    
    const result = await query(
      `INSERT INTO all_vehicles (unit_number, make, model, year, vin, plate_number, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [unit_number, make, model, year, vin, plate_number, status || 'in-service']
    );
    
    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('INSERT', 'vehicles', duration, true, { vehicleId: result.rows[0].id });
    dtLogger.trackRequest('POST', '/api/vehicles', 201, duration);
    dtLogger.trackEvent('vehicle.created', { vehicleId: result.rows[0].id, unitNumber: unit_number });
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to create vehicle', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/vehicles', 500, duration);
    
    console.error('Error creating vehicle:', error);
    res.status(500).json({ message: 'Failed to create vehicle' });
  }
});

// PUT update vehicle
router.put('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const { unit_number, make, model, year, vin, plate_number, status } = req.body;
    
    const result = await query(
      `UPDATE all_vehicles 
       SET unit_number = $1, make = $2, model = $3, year = $4, vin = $5, plate_number = $6, status = $7
       WHERE id = $8
       RETURNING *`,
      [unit_number, make, model, year, vin, plate_number, status, req.params.id]
    );
    
    const duration = Date.now() - startTime;
    
    if (result.rows.length > 0) {
      dtLogger.trackDatabase('UPDATE', 'vehicles', duration, true, { vehicleId: req.params.id });
      dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 200, duration);
      res.json(result.rows[0]);
    } else {
      dtLogger.warn('Vehicle not found', { vehicleId: req.params.id });
      dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to update vehicle', error, { vehicleId: req.params.id });
    dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 500, duration);
    
    console.error('Error updating vehicle:', error);
    res.status(500).json({ message: 'Failed to update vehicle' });
  }
});

// DELETE vehicle
router.delete('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query('DELETE FROM all_vehicles WHERE id = $1 RETURNING *', [req.params.id]);
    const duration = Date.now() - startTime;
    
    if (result.rows.length > 0) {
      dtLogger.trackDatabase('DELETE', 'vehicles', duration, true, { vehicleId: req.params.id });
      dtLogger.trackRequest('DELETE', `/api/vehicles/${req.params.id}`, 200, duration);
      res.json({ message: 'Vehicle deleted successfully' });
    } else {
      dtLogger.warn('Vehicle not found', { vehicleId: req.params.id });
      dtLogger.trackRequest('DELETE', `/api/vehicles/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to delete vehicle', error, { vehicleId: req.params.id });
    dtLogger.trackRequest('DELETE', `/api/vehicles/${req.params.id}`, 500, duration);
    
    console.error('Error deleting vehicle:', error);
    res.status(500).json({ message: 'Failed to delete vehicle' });
  }
});

module.exports = router;
