const express = require('express');
const router = express.Router();
const knex = require('../config/knex');

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
