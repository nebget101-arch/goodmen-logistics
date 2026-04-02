const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');

/**
 * Example Route using PostgreSQL Database
 * This demonstrates how to query the database in your routes
 */

/**
 * @openapi
 * /api/db-example/drivers:
 *   get:
 *     summary: List all drivers
 *     description: Returns every driver record ordered by created_at descending.
 *     tags:
 *       - Internal / Debug
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successful driver list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
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

/**
 * @openapi
 * /api/db-example/drivers/{id}:
 *   get:
 *     summary: Get a single driver
 *     description: Returns one driver record by its primary-key ID.
 *     tags:
 *       - Internal / Debug
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Driver ID
 *     responses:
 *       200:
 *         description: Driver found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *       404:
 *         description: Driver not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
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

/**
 * @openapi
 * /api/db-example/vehicles:
 *   get:
 *     summary: List all vehicles
 *     description: Returns every vehicle record from the all_vehicles view ordered by unit_number.
 *     tags:
 *       - Internal / Debug
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successful vehicle list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
router.get('/vehicles', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM all_vehicles ORDER BY unit_number'
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

/**
 * @openapi
 * /api/db-example/loads:
 *   get:
 *     summary: List all loads with joins
 *     description: Returns every load joined with its assigned driver name and vehicle unit_number, ordered by pickup_date descending.
 *     tags:
 *       - Internal / Debug
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successful load list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       driver_name:
 *                         type: string
 *                       unit_number:
 *                         type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
router.get('/loads', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        l.*,
        d.first_name || ' ' || d.last_name as driver_name,
        v.unit_number
      FROM loads l
      LEFT JOIN drivers d ON l.driver_id = d.id
      LEFT JOIN all_vehicles v ON l.vehicle_id = v.id
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

/**
 * @openapi
 * /api/db-example/dashboard:
 *   get:
 *     summary: Dashboard statistics
 *     description: Returns aggregate counts for active drivers, vehicles, loads, HOS violations, average DQF completeness, and pending maintenance.
 *     tags:
 *       - Internal / Debug
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     active_drivers:
 *                       type: integer
 *                     total_drivers:
 *                       type: integer
 *                     active_vehicles:
 *                       type: integer
 *                     total_vehicles:
 *                       type: integer
 *                     active_loads:
 *                       type: integer
 *                     pending_loads:
 *                       type: integer
 *                     hos_violations:
 *                       type: integer
 *                     avg_dqf_completeness:
 *                       type: number
 *                     pending_maintenance:
 *                       type: integer
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
router.get('/dashboard', async (req, res) => {
  try {
    const stats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM drivers WHERE status = 'active') as active_drivers,
        (SELECT COUNT(*) FROM drivers) as total_drivers,
        (SELECT COUNT(*) FROM all_vehicles WHERE status = 'in-service') as active_vehicles,
        (SELECT COUNT(*) FROM all_vehicles) as total_vehicles,
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

/**
 * @openapi
 * /api/db-example/drivers:
 *   post:
 *     summary: Create a driver
 *     description: Inserts a new driver record and returns the created row.
 *     tags:
 *       - Internal / Debug
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - first_name
 *               - last_name
 *             properties:
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               cdl_number:
 *                 type: string
 *               cdl_state:
 *                 type: string
 *               cdl_class:
 *                 type: string
 *               endorsements:
 *                 type: string
 *               cdl_expiry:
 *                 type: string
 *                 format: date
 *               medical_cert_expiry:
 *                 type: string
 *                 format: date
 *               hire_date:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Driver created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
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

/**
 * @openapi
 * /api/db-example/drivers/{id}:
 *   put:
 *     summary: Update a driver
 *     description: Updates the status and/or dqf_completeness of an existing driver. Fields not provided are left unchanged (COALESCE).
 *     tags:
 *       - Internal / Debug
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Driver ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               dqf_completeness:
 *                 type: number
 *     responses:
 *       200:
 *         description: Driver updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       404:
 *         description: Driver not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
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

/**
 * @openapi
 * /api/db-example/drivers/{id}:
 *   delete:
 *     summary: Delete a driver
 *     description: Permanently removes a driver record by ID. Returns the deleted row on success.
 *     tags:
 *       - Internal / Debug
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Driver ID
 *     responses:
 *       200:
 *         description: Driver deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *       404:
 *         description: Driver not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
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
