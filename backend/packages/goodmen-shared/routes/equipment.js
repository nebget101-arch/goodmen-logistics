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
      SELECT av.id, av.unit_number, av.vin, av.make, av.model, av.year, av.vehicle_type, av.status, av.operating_entity_id
      FROM all_vehicles av
      WHERE 1=1
    `;
    if (req.context?.tenantId) {
      params.push(req.context.tenantId);
      sql += ` AND av.tenant_id = $${params.length}`;
    }
    // Align with dispatch / loads: "truck" = any unit that is not a trailer (fleet truck, customer_vehicle, etc.)
    if (type === 'trailer') {
      params.push('trailer');
      sql += ` AND LOWER(COALESCE(av.vehicle_type, '')) = $${params.length}`;
    } else if (type === 'truck') {
      sql += ` AND LOWER(COALESCE(av.vehicle_type, '')) <> 'trailer'`;
    } else if (type) {
      params.push(type);
      sql += ` AND LOWER(COALESCE(av.vehicle_type, '')) = $${params.length}`;
    }
    // all_vehicles: fleet rows use in-service; shop_client union uses active — both mean "usable" for loads
    if (status) {
      if (status === 'active') {
        sql += ` AND (LOWER(COALESCE(av.status, '')) = 'in-service' OR LOWER(COALESCE(av.status, '')) = 'active')`;
      } else {
        params.push(status);
        sql += ` AND LOWER(COALESCE(av.status, '')) = $${params.length}`;
      }
    }
    if (req.context?.operatingEntityId) {
      params.push(req.context.operatingEntityId);
      const oeParam = params.length;
      if (type === 'trailer') {
        sql += ` AND (av.operating_entity_id = $${oeParam} OR LOWER(COALESCE(av.vehicle_type, '')) = 'trailer')`;
      } else {
        sql += ` AND (
      av.operating_entity_id = $${oeParam}
      OR av.vehicle_source = 'shop_client'
      OR EXISTS (
        SELECT 1 FROM drivers d
        WHERE d.tenant_id = av.tenant_id
          AND d.operating_entity_id = $${oeParam}
          AND d.truck_id = av.id
      )
    )`;
      }
    }
    sql += ' ORDER BY av.unit_number NULLS LAST';
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
