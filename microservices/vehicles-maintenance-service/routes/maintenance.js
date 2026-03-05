const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/logger');

// GET all maintenance records
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(`
      SELECT m.*, v.unit_number 
      FROM maintenance_records m
      JOIN all_vehicles v ON m.vehicle_id = v.id
      ORDER BY m.date_performed DESC
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

// GET maintenance record by ID
router.get('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query(
      `SELECT m.*, v.unit_number 
       FROM maintenance_records m
       JOIN all_vehicles v ON m.vehicle_id = v.id
       WHERE m.id = $1`,
      [req.params.id]
    );
    
    const duration = Date.now() - startTime;
    
    if (result.rows.length > 0) {
      dtLogger.trackDatabase('SELECT', 'maintenance_records', duration, true, { maintenanceId: req.params.id });
      dtLogger.trackRequest('GET', `/api/maintenance/${req.params.id}`, 200, duration);
      res.json(result.rows[0]);
    } else {
      dtLogger.warn('Maintenance record not found', { maintenanceId: req.params.id });
      dtLogger.trackRequest('GET', `/api/maintenance/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'Maintenance record not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to fetch maintenance record', error, { maintenanceId: req.params.id });
    dtLogger.trackRequest('GET', `/api/maintenance/${req.params.id}`, 500, duration);
    
    console.error('Error fetching maintenance record:', error);
    res.status(500).json({ message: 'Failed to fetch maintenance record' });
  }
});

// POST create new maintenance record
router.post('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const { vehicle_id, type, description, date_performed, cost, status, odometer } = req.body;
    
    const result = await query(
      `INSERT INTO maintenance_records (vehicle_id, type, description, date_performed, cost, status, odometer)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [vehicle_id, type, description, date_performed, cost, status || 'pending', odometer]
    );
    
    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('INSERT', 'maintenance_records', duration, true, { maintenanceId: result.rows[0].id });
    dtLogger.trackRequest('POST', '/api/maintenance', 201, duration);
    dtLogger.trackEvent('maintenance.created', { maintenanceId: result.rows[0].id, vehicleId: vehicle_id });
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to create maintenance record', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/maintenance', 500, duration);
    
    console.error('Error creating maintenance record:', error);
    res.status(500).json({ message: 'Failed to create maintenance record' });
  }
});

// PUT update maintenance record
router.put('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const { type, description, date_performed, cost, status, odometer } = req.body;
    
    const result = await query(
      `UPDATE maintenance_records 
       SET type = $1, description = $2, date_performed = $3, cost = $4, status = $5, odometer = $6
       WHERE id = $7
       RETURNING *`,
      [type, description, date_performed, cost, status, odometer, req.params.id]
    );
    
    const duration = Date.now() - startTime;
    
    if (result.rows.length > 0) {
      dtLogger.trackDatabase('UPDATE', 'maintenance_records', duration, true, { maintenanceId: req.params.id });
      dtLogger.trackRequest('PUT', `/api/maintenance/${req.params.id}`, 200, duration);
      res.json(result.rows[0]);
    } else {
      dtLogger.warn('Maintenance record not found', { maintenanceId: req.params.id });
      dtLogger.trackRequest('PUT', `/api/maintenance/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'Maintenance record not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to update maintenance record', error, { maintenanceId: req.params.id });
    dtLogger.trackRequest('PUT', `/api/maintenance/${req.params.id}`, 500, duration);
    
    console.error('Error updating maintenance record:', error);
    res.status(500).json({ message: 'Failed to update maintenance record' });
  }
});

// DELETE maintenance record
router.delete('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query('DELETE FROM maintenance_records WHERE id = $1 RETURNING *', [req.params.id]);
    const duration = Date.now() - startTime;
    
    if (result.rows.length > 0) {
      dtLogger.trackDatabase('DELETE', 'maintenance_records', duration, true, { maintenanceId: req.params.id });
      dtLogger.trackRequest('DELETE', `/api/maintenance/${req.params.id}`, 200, duration);
      res.json({ message: 'Maintenance record deleted successfully' });
    } else {
      dtLogger.warn('Maintenance record not found', { maintenanceId: req.params.id });
      dtLogger.trackRequest('DELETE', `/api/maintenance/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'Maintenance record not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to delete maintenance record', error, { maintenanceId: req.params.id });
    dtLogger.trackRequest('DELETE', `/api/maintenance/${req.params.id}`, 500, duration);
    
    console.error('Error deleting maintenance record:', error);
    res.status(500).json({ message: 'Failed to delete maintenance record' });
  }
});

module.exports = router;
