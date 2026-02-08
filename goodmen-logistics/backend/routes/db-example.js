const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

/**
 * Example Route using PostgreSQL Database
 * This demonstrates how to query the database in your routes
 */

// GET /api/db-example/drivers - Get all drivers from database
router.get('/drivers', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM drivers ORDER BY created_at DESC'
    );
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching drivers:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch drivers'
    });
  }
});

// GET /api/db-example/drivers/:id - Get single driver
router.get('/drivers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      'SELECT * FROM drivers WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Driver not found'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching driver:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch driver'
    });
  }
});

// GET /api/db-example/vehicles - Get all vehicles
router.get('/vehicles', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM vehicles ORDER BY unit_number'
    );
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vehicles'
    });
  }
});

// GET /api/db-example/loads - Get all loads with driver and vehicle info
router.get('/loads', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        l.*,
        d.first_name || ' ' || d.last_name as driver_name,
        v.unit_number
      FROM loads l
      LEFT JOIN drivers d ON l.driver_id = d.id
      LEFT JOIN vehicles v ON l.vehicle_id = v.id
      ORDER BY l.pickup_date DESC
    `);
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching loads:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch loads'
    });
  }
});

// GET /api/db-example/dashboard - Get dashboard statistics
router.get('/dashboard', async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM drivers WHERE status = 'active') as active_drivers,
        (SELECT COUNT(*) FROM drivers) as total_drivers,
        (SELECT COUNT(*) FROM vehicles WHERE status = 'in-service') as active_vehicles,
        (SELECT COUNT(*) FROM vehicles) as total_vehicles,
        (SELECT COUNT(*) FROM loads WHERE status = 'in-transit') as active_loads,
        (SELECT COUNT(*) FROM loads WHERE status = 'pending') as pending_loads,
        (SELECT COUNT(*) FROM hos_records WHERE status = 'warning' OR status = 'violation') as hos_violations,
        (SELECT ROUND(AVG(dqf_completeness)) FROM drivers) as avg_dqf_completeness,
        (SELECT COUNT(*) FROM maintenance_records WHERE status = 'pending') as pending_maintenance
    `);
    
    res.json({
      success: true,
      data: stats.rows[0]
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard statistics'
    });
  }
});

// POST /api/db-example/drivers - Create new driver
router.post('/drivers', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      phone,
      cdl_number,
      cdl_state,
      cdl_class,
      endorsements,
      cdl_expiry,
      medical_cert_expiry,
      hire_date
    } = req.body;

    const result = await query(
      `INSERT INTO drivers (
        first_name, last_name, email, phone, cdl_number, cdl_state,
        cdl_class, endorsements, cdl_expiry, medical_cert_expiry, hire_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        first_name, last_name, email, phone, cdl_number, cdl_state,
        cdl_class, endorsements, cdl_expiry, medical_cert_expiry, hire_date
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Driver created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating driver:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create driver'
    });
  }
});

// PUT /api/db-example/drivers/:id - Update driver
router.put('/drivers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, dqf_completeness } = req.body;

    const result = await query(
      `UPDATE drivers 
       SET status = COALESCE($1, status),
           dqf_completeness = COALESCE($2, dqf_completeness),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [status, dqf_completeness, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Driver not found'
      });
    }

    res.json({
      success: true,
      message: 'Driver updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating driver:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update driver'
    });
  }
});

// DELETE /api/db-example/drivers/:id - Delete driver
router.delete('/drivers/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM drivers WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Driver not found'
      });
    }

    res.json({
      success: true,
      message: 'Driver deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting driver:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete driver'
    });
  }
});

module.exports = router;
