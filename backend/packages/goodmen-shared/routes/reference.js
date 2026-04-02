const express = require('express');
const router = express.Router();
const knex = require('../config/knex');

/**
 * @openapi
 * /api/reference/load-status-codes:
 *   get:
 *     summary: Get all load status codes
 *     description: Returns the full list of load status codes with display labels, colors, sort order, and terminal flags. Used to populate status dropdowns and badge colors throughout the UI.
 *     tags:
 *       - Reference
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of load status codes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                       display_label:
 *                         type: string
 *                       color_hex:
 *                         type: string
 *                       sort_order:
 *                         type: integer
 *                       is_terminal:
 *                         type: boolean
 *       500:
 *         description: Server error
 */
router.get('/load-status-codes', async (_req, res) => {
  try {
    const rows = await knex('load_status_codes')
      .select('code', 'display_label', 'color_hex', 'sort_order', 'is_terminal')
      .orderBy('sort_order', 'asc')
      .orderBy('code', 'asc');

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching load status codes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch load status codes',
      message: error.message
    });
  }
});

/**
 * @openapi
 * /api/reference/billing-status-codes:
 *   get:
 *     summary: Get all billing status codes
 *     description: Returns the full list of billing status codes with display labels, colors, sort order, and terminal flags. Used to populate billing-status dropdowns and badge colors.
 *     tags:
 *       - Reference
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of billing status codes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                       display_label:
 *                         type: string
 *                       color_hex:
 *                         type: string
 *                       sort_order:
 *                         type: integer
 *                       is_terminal:
 *                         type: boolean
 *       500:
 *         description: Server error
 */
router.get('/billing-status-codes', async (_req, res) => {
  try {
    const rows = await knex('billing_status_codes')
      .select('code', 'display_label', 'color_hex', 'sort_order', 'is_terminal')
      .orderBy('sort_order', 'asc')
      .orderBy('code', 'asc');

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching billing status codes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch billing status codes',
      message: error.message
    });
  }
});

module.exports = router;
