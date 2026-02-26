
const express = require('express');
const router = express.Router();
const auth = require('./auth-middleware');
const axios = require('axios');
const dtLogger = require('../utils/dynatrace-logger');
const { query } = require('../config/database');

// Protect all vehicles routes: admin, safety
router.use(auth(['admin', 'safety']));

// GET decode VIN using NHTSA vPIC
router.get('/decode-vin/:vin', async (req, res) => {
  const startTime = Date.now();
  const vin = (req.params.vin || '').trim();
  if (!vin) {
    return res.status(400).json({ message: 'VIN is required' });
  }
  try {
    const response = await axios.get(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`
    );
    const result = response.data?.Results?.[0] || {};
    const decoded = {
      vin,
      make: result.Make || '',
      model: result.Model || '',
      year: result.ModelYear || ''
    };
    const duration = Date.now() - startTime;
    dtLogger.trackRequest('GET', `/api/vehicles/decode-vin/${vin}`, 200, duration);
    res.json(decoded);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.trackRequest('GET', `/api/vehicles/decode-vin/${vin}`, 500, duration);
    console.error('Error decoding VIN:', error);
    res.status(500).json({ message: 'Failed to decode VIN' });
  }
});

// POST create new customer vehicle
router.post('/customer', async (req, res) => {
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
      customer_id
    } = req.body;

    // Convert empty strings to null and set VIN/unit number fallbacks
    const finalVin = (vin && vin.trim()) ? vin.trim() : (unit_number ? unit_number.slice(-4) : null);
    const finalUnitNumber = (unit_number && unit_number.trim()) ? unit_number.trim() : (finalVin ? finalVin.slice(-4) : null);
    const finalMake = (make && make.trim()) ? make.trim() : null;
    const finalModel = (model && model.trim()) ? model.trim() : null;
    const finalYear = (year && year.trim()) ? year.trim() : null;
    const finalLicensePlate = (license_plate && license_plate.trim()) ? license_plate.trim() : null;
    const finalState = (state && state.trim()) ? state.trim() : null;
    const finalMileage = mileage ? parseInt(mileage) : null;
    const finalInspectionExpiry = (inspection_expiry && inspection_expiry.trim()) ? inspection_expiry : null;
    const finalNextPmDue = (next_pm_due && next_pm_due.trim()) ? next_pm_due : null;
    const finalNextPmMileage = next_pm_mileage ? parseInt(next_pm_mileage) : null;
    const finalCustomerId = (customer_id && customer_id.trim()) ? customer_id.trim() : null;

    const result = await query(
      `INSERT INTO customer_vehicles (
        unit_number, vin, make, model, year, license_plate, state, mileage,
        inspection_expiry, next_pm_due, next_pm_mileage, customer_id
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING vehicle_uuid`,
      [
        finalUnitNumber, finalVin, finalMake, finalModel, finalYear, finalLicensePlate, finalState, finalMileage,
        finalInspectionExpiry, finalNextPmDue, finalNextPmMileage, finalCustomerId
      ]
    );
    const created = await query('SELECT * FROM all_vehicles WHERE id = $1', [result.rows[0].vehicle_uuid]);
    const duration = Date.now() - startTime;
    dtLogger.trackDatabase('INSERT', 'customer_vehicles', duration, true, { vehicleId: result.rows[0].vehicle_uuid });
    dtLogger.trackEvent('customer_vehicle.created', { vehicleId: result.rows[0].vehicle_uuid, unit_number, vin });
    dtLogger.trackRequest('POST', '/api/vehicles/customer', 201, duration);
    dtLogger.info('Customer vehicle created successfully', { vehicleId: result.rows[0].vehicle_uuid, unit_number });
    res.status(201).json(created.rows[0]);
  } catch (error) {
    const duration = Date.now() - startTime;
    dtLogger.error('Failed to create customer vehicle', error, { body: req.body });
    dtLogger.trackRequest('POST', '/api/vehicles/customer', 500, duration);
    console.error('Error creating customer vehicle:', error);
    res.status(500).json({ message: 'Failed to create customer vehicle', error: error.message });
  }
});



// Protect all vehicles routes: admin, safety
router.use(auth(['admin', 'safety']));



// GET vehicles by (partial) VIN
router.get('/search', async (req, res) => {
  const vin = req.query.vin;
  if (!vin || vin.length < 1) {
    return res.status(400).json({ message: 'VIN query parameter is required' });
  }
  try {
    const result = await query(
      `SELECT * FROM all_vehicles WHERE LOWER(vin) LIKE LOWER($1) ORDER BY unit_number`,
      [`%${vin}%`]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error searching vehicles by VIN:', error);
    res.status(500).json({ message: 'Failed to search vehicles by VIN' });
  }
});


// GET all vehicles
router.get('/', async (req, res) => {
  const startTime = Date.now();
  try {
    const result = await query('SELECT * FROM all_vehicles ORDER BY unit_number');
    const duration = Date.now() - startTime;
    
    dtLogger.trackDatabase('SELECT', 'all_vehicles', duration, true, { count: result.rows.length });
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
    const result = await query('SELECT * FROM all_vehicles WHERE id = $1', [req.params.id]);
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

    const finalVin = (vin && vin.trim()) ? vin.trim() : (unit_number ? unit_number.slice(-4) : null);
    const finalUnitNumber = (unit_number && unit_number.trim()) ? unit_number.trim() : (finalVin ? finalVin.slice(-4) : null);
    
    const result = await query(
      `INSERT INTO vehicles (
        unit_number, vin, make, model, year, license_plate, state, mileage, 
        inspection_expiry, next_pm_due, next_pm_mileage,
        insurance_expiry, registration_expiry, oos_reason, status
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'in-service') 
       RETURNING *`,
      [
        finalUnitNumber, finalVin, make, model, year, license_plate, state, mileage || 0,
        inspection_expiry, next_pm_due, next_pm_mileage,
        insurance_expiry, registration_expiry, oos_reason
      ]
    );
    await query('UPDATE vehicles SET is_company_owned = true WHERE id = $1', [result.rows[0].id]);
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
      const customerAllowed = new Set([
        'unit_number',
        'vin',
        'make',
        'model',
        'year',
        'license_plate',
        'state',
        'mileage',
        'inspection_expiry',
        'next_pm_due',
        'next_pm_mileage',
        'insurance_expiry',
        'customer_id'
      ]);
      const customerFields = [];
      const customerValues = [];
      let customerParamCount = 1;
      Object.keys(req.body).forEach(key => {
        if (req.body[key] !== undefined && customerAllowed.has(key)) {
          customerFields.push(`${key} = $${customerParamCount}`);
          customerValues.push(req.body[key]);
          customerParamCount++;
        }
      });
      if (customerFields.length === 0) {
        dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 404, duration);
        return res.status(404).json({ message: 'Vehicle not found' });
      }
      customerValues.push(req.params.id);
      const customerUpdate = await query(
        `UPDATE customer_vehicles SET ${customerFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE vehicle_uuid = $${customerFields.length + 1}
         RETURNING *`,
        customerValues
      );
      if (customerUpdate.rows.length > 0) {
        dtLogger.trackDatabase('UPDATE', 'customer_vehicles', duration, true, { vehicleId: req.params.id });
        dtLogger.trackEvent('customer_vehicle.updated', { vehicleId: req.params.id, fieldsUpdated: customerFields.length });
        dtLogger.trackRequest('PUT', `/api/vehicles/${req.params.id}`, 200, duration);
        return res.json(customerUpdate.rows[0]);
      }
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
    const internal = await query('DELETE FROM vehicles WHERE id = $1 RETURNING *', [req.params.id]);
    if (internal.rows.length > 0) {
      return res.json({ message: 'Vehicle deleted successfully' });
    }
    const customer = await query('DELETE FROM customer_vehicles WHERE vehicle_uuid = $1 RETURNING *', [req.params.id]);
    if (customer.rows.length > 0) {
      return res.json({ message: 'Vehicle deleted successfully' });
    }
    res.status(404).json({ message: 'Vehicle not found' });
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    res.status(500).json({ message: 'Failed to delete vehicle' });
  }
});

// GET vehicles needing maintenance
router.get('/maintenance/needed', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM all_vehicles 
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
