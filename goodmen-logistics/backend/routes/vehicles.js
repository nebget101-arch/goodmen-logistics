const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');

// GET all vehicles
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query('SELECT * FROM vehicles ORDER BY unit_number');
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
  try {
    const result = await query('SELECT * FROM vehicles WHERE id = $1', [req.params.id]);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    console.error('Error fetching vehicle:', error);
    res.status(500).json({ message: 'Failed to fetch vehicle' });
  }
});

// POST create new vehicle
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const { unitNumber, vin, make, model, year, licensePlate, state, mileage, eldDeviceId, insuranceExpiry, registrationExpiry } = req.body;
    const result = await query(
      `INSERT INTO vehicles (unit_number, vin, make, model, year, license_plate, state, mileage, eld_device_id, insurance_expiry, registration_expiry, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'in-service') RETURNING *`,
      [unitNumber, vin, make, model, year, licensePlate, state, mileage || 0, eldDeviceId, insuranceExpiry, registrationExpiry]
    );
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('INSERT', 'vehicles', duration, true, { vehicleId: result.rows[0].id });
    dtLogger.trackEvent('vehicle.created', { vehicleId: result.rows[0].id, unitNumber, vin });
    dtLogger.trackRequest('POST', '/api/vehicles', 201, duration);
    dtLogger.info('Vehicle created successfully', { vehicleId: result.rows[0].id, unitNumber });
    
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
  try {
    const fields = [];
    const values = [];
    let paramCount = 1;
    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(req.body[key]);
        paramCount++;
      }
    });
    if (fields.length === 0) return res.status(400).json({ message: 'No fields to update' });
    values.push(req.params.id);
    const result = await query(`UPDATE vehicles SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount} RETURNING *`, values);
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    console.error('Error updating vehicle:', error);
    res.status(500).json({ message: 'Failed to update vehicle' });
  }
});

// DELETE vehicle
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM vehicles WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length > 0) {
      res.json({ message: 'Vehicle deleted successfully' });
    } else {
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    res.status(500).json({ message: 'Failed to delete vehicle' });
  }
});

// GET vehicles needing maintenance
router.get('/maintenance/needed', (req, res) => {
  const needMaintenance = vehicles.filter(v => {
    const nextPM = new Date(v.nextPMDue);
    const thirtyDaysFromNow = new Date(Date.now() + 30*24*60*60*1000);
    return nextPM <= thirtyDaysFromNow || v.status === 'out-of-service';
  });
  res.json(needMaintenance);
});

module.exports = router;
