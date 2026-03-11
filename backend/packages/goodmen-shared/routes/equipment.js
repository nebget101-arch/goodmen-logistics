const express = require('express');
const router = express.Router();
const auth = require('./auth-middleware');
const { query } = require('../internal/db');

router.use(auth(['admin', 'dispatch', 'safety', 'fleet']));

router.get('/', async (req, res) => {
  try {
    const type = (req.query.type || '').toString().trim().toLowerCase();
    const status = (req.query.status || '').toString().trim().toLowerCase();
    const params = [];
    let sql = `
      SELECT id, unit_number, vin, make, model, year, vehicle_type, status, operating_entity_id
      FROM all_vehicles
      WHERE 1=1
    `;
    if (type) {
      params.push(type);
      sql += ` AND LOWER(vehicle_type) = $${params.length}`;
    }
    if (status) {
      const normalizedStatus = status === 'active' ? 'in-service' : status;
      params.push(normalizedStatus);
      sql += ` AND LOWER(status) = $${params.length}`;
    }
    // Apply operating entity scoping: if request has an operatingEntityId and user is not global admin
    if (req.context && req.context.operatingEntityId && !req.context.isGlobalAdmin) {
      params.push(req.context.operatingEntityId);
      sql += ` AND operating_entity_id = $${params.length}`;
    }
    sql += ' ORDER BY unit_number';
    const result = await query(sql, params);
    // Even if there is no equipment, return an empty array (no error)
    res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    // If schema is not fully migrated (e.g. all_vehicles view missing), treat as "no data"
    const message = (error && error.message) ? String(error.message) : '';
    const code = error && error.code ? String(error.code) : '';
    if (code === '42P01' || message.includes('does not exist') || message.includes('all_vehicles')) {
      return res.json({ success: true, data: [] });
    }
    console.error('Error fetching equipment:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch equipment' });
  }
});

module.exports = router;
