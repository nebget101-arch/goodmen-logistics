const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');
const auth = require('./auth-middleware');

// Protect all vehicles routes: admin, safety
router.use(auth(['admin', 'safety']));

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
    const { 
      unit_number, 
      vin, 
      make, 
      model, 
      year, 
      license_plate, 
      state, 
      mileage, 
      inspection_expiry,
      next_pm_due,
      next_pm_mileage,
      insurance_expiry, 
      registration_expiry,
      oos_reason
    } = req.body;
    
    const result = await query(
      `INSERT INTO vehicles (
        unit_number, vin, make, model, year, license_plate, state, mileage, 
        inspection_expiry, next_pm_due, next_pm_mileage,
        insurance_expiry, registration_expiry, oos_reason, status
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'in-service') 
       RETURNING *`,
      [
        unit_number, vin, make, model, year, license_plate, state, mileage || 0,
        inspection_expiry, next_pm_due, next_pm_mileage,
        insurance_expiry, registration_expiry, oos_reason
      ]
    );
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('INSERT', 'vehicles', duration, true, { vehicleId: result.rows[0].id });
    dtLogger.trackEvent('vehicle.created', { vehicleId: result.rows[0].id, unit_number, vin });
    dtLogger.trackRequest('POST', '/api/vehicles', 201, duration);
    dtLogger.info('Vehicle created successfully', { vehicleId: result.rows[0].id, unit_number });
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to create vehicle', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/vehicles', 500, duration);
    
    console.error('Error creating vehicle:', error);
    res.status(500).json({ message: 'Failed to create vehicle', error: error.message });
  }
});

// PUT update vehicle
router.put('/:id', async (req, res) => {
  const startTime = Date.now();
  try {
    // Fields that should not be updated
    const excludedFields = ['id', 'created_at', 'updated_at'];
    
    const fields = [];
    const values = [];
    let paramCount = 1;
    
    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined && !excludedFields.includes(key)) {
        fields.push(`${key} = $${paramCount}`);
        values.push(req.body[key]);
        paramCount++;
      }
    });
    
    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }
    
    values.push(req.params.id);
    
    const result = await query(
      `UPDATE vehicles SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $${paramCount} 
       RETURNING *`, 
      values
    );
    
    const duration = Date.now() - startTime;
    
    if (result.rows.length > 0) {
      dtLogger.trackDatabase('UPDATE', 'vehicles', duration, true, { vehicleId: req.params.id });
      dtLogger.trackEvent('vehicle.updated', { vehicleId: req.params.id, fieldsUpdated: fields.length });
      dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 200, duration);
      
      res.json(result.rows[0]);
    } else {
      dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 404, duration);
      res.status(404).json({ message: 'Vehicle not found' });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to update vehicle', error, { vehicleId: req.params.id, body: req.body });
    dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 500, duration);
    
    console.error('Error updating vehicle:', error);
    res.status(500).json({ message: 'Failed to update vehicle', error: error.message });
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
router.get('/maintenance/needed', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM vehicles 
      WHERE next_pm_due <= CURRENT_DATE + INTERVAL '30 days' 
         OR status = 'out-of-service'
      ORDER BY next_pm_due
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vehicles needing maintenance:', error);
    res.status(500).json({ message: 'Failed to fetch vehicles needing maintenance' });
  }
});

// GET vehicle documents
router.get('/:id/documents', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM vehicle_documents WHERE vehicle_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching vehicle documents:', error);
    res.status(500).json({ message: 'Failed to fetch vehicle documents' });
  }
});

// POST upload vehicle document
router.post('/:id/documents', async (req, res) => {
  const startTime = Date.now();
  try {
    const { document_type, file_name, file_path, file_size, mime_type, expiry_date, uploaded_by, notes } = req.body;
    
    const result = await query(
      `INSERT INTO vehicle_documents (
        vehicle_id, document_type, file_name, file_path, file_size, 
        mime_type, expiry_date, uploaded_by, notes
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [req.params.id, document_type, file_name, file_path, file_size, mime_type, expiry_date, uploaded_by, notes]
    );
    
    const duration = Date.now() - startTime;
    dtLogger.trackEvent('vehicle.document.uploaded', { 
      vehicleId: req.params.id, 
      documentType: document_type,
      fileName: file_name 
    });
    dtLogger.trackRequest('POST', `/api/vehicles/${req.params.id}/documents`, 201, duration);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to upload vehicle document', error, { vehicleId: req.params.id });
    dtLogger.trackRequest('POST', `/api/vehicles/${req.params.id}/documents`, 500, duration);
    
    console.error('Error uploading vehicle document:', error);
    res.status(500).json({ message: 'Failed to upload vehicle document', error: error.message });
  }
});

// DELETE vehicle document
router.delete('/:id/documents/:documentId', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM vehicle_documents WHERE id = $1 AND vehicle_id = $2 RETURNING *',
      [req.params.documentId, req.params.id]
    );
    
    if (result.rows.length > 0) {
      dtLogger.trackEvent('vehicle.document.deleted', { 
        vehicleId: req.params.id, 
        documentId: req.params.documentId 
      });
      res.json({ message: 'Document deleted successfully' });
    } else {
      res.status(404).json({ message: 'Document not found' });
    }
  } catch (error) {
    console.error('Error deleting vehicle document:', error);
    res.status(500).json({ message: 'Failed to delete vehicle document' });
  }
});

module.exports = router;
