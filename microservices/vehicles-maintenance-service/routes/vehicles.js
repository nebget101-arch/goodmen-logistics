const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const dtLogger = require('../utils/dynatrace-logger');
const { getSignedDownloadUrl, deleteObject } = require('../storage/r2-storage');

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

// GET vehicle documents
router.get('/:id/documents', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM vehicle_documents WHERE vehicle_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    const data = await Promise.all(
      result.rows.map(async row => ({
        ...row,
        downloadUrl: row.file_path ? await getSignedDownloadUrl(row.file_path) : null
      }))
    );
    res.json(data);
  } catch (error) {
    console.error('Error fetching vehicle documents:', error);
    res.status(500).json({ message: 'Failed to fetch vehicle documents' });
  }
});

// POST upload vehicle document (metadata only, R2 key required)
router.post('/:id/documents', async (req, res) => {
  const startTime = Date.now();
  try {
    const { document_type, file_name, file_path, file_size, mime_type, expiry_date, uploaded_by, notes } = req.body;
    if (!file_path) {
      return res.status(400).json({ message: 'file_path (R2 object key) is required' });
    }

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

    const doc = result.rows[0];
    const downloadUrl = await getSignedDownloadUrl(doc.file_path);
    res.status(201).json({ ...doc, downloadUrl });
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
      const deletedDoc = result.rows[0];
      if (deletedDoc?.file_path) {
        await deleteObject(deletedDoc.file_path);
      }
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
