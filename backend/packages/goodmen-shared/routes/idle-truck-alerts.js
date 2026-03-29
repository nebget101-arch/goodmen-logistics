'use strict';

/**
 * Idle Truck Alerts API — FN-506
 * Mounted at /api/idle-truck-alerts in the vehicles-maintenance service.
 *
 * Endpoints:
 *   GET    /api/idle-truck-alerts              — list alerts with pagination & filters
 *   GET    /api/idle-truck-alerts/:id          — single alert detail
 *   PATCH  /api/idle-truck-alerts/:id/respond  — update response_status + notes
 *   POST   /api/idle-truck-alerts/run-check    — manually trigger the idle check (admin)
 */

const express = require('express');
const router = express.Router();
const knex = require('../config/knex');
const dtLogger = require('../utils/logger');
const { runIdleTruckCheckForTenant } = require('../services/idle-truck-monitor');

// ─── Helpers ────────────────────────────────────────────────────────────────

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || null;
}

function requireTenant(req, res) {
  const tid = tenantId(req);
  if (!tid) {
    res.status(401).json({ error: 'Tenant context required' });
    return null;
  }
  return tid;
}

// ─── GET / — List alerts with pagination & filters ──────────────────────────

router.get('/', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const {
      page = 1,
      limit = 25,
      alert_type,
      response_status,
      vehicle_id,
      driver_id,
      equipment_owner_id,
      date_from,
      date_to,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * pageSize;

    // Allowed sort columns
    const allowedSorts = ['created_at', 'alert_type', 'accrued_deductions', 'response_status'];
    const sortCol = allowedSorts.includes(sort_by) ? sort_by : 'created_at';
    const sortDir = sort_order === 'asc' ? 'asc' : 'desc';

    let query = knex('idle_truck_alerts as ita')
      .where('ita.tenant_id', tid);

    // Filters
    if (alert_type) query = query.where('ita.alert_type', alert_type);
    if (response_status) query = query.where('ita.response_status', response_status);
    if (vehicle_id) query = query.where('ita.vehicle_id', vehicle_id);
    if (driver_id) query = query.where('ita.driver_id', driver_id);
    if (equipment_owner_id) query = query.where('ita.equipment_owner_id', equipment_owner_id);
    if (date_from) query = query.where('ita.created_at', '>=', date_from);
    if (date_to) query = query.where('ita.created_at', '<=', date_to);

    // Count query (clone before applying order/limit)
    const [{ count: total }] = await query.clone().count('* as count');

    // Data query with joins for display context
    const rows = await query
      .leftJoin('vehicles as v', 'v.id', 'ita.vehicle_id')
      .leftJoin('drivers as d', 'd.id', 'ita.driver_id')
      .select(
        'ita.*',
        knex.raw("COALESCE(v.unit_number, v.vin, v.id::text) as vehicle_label"),
        knex.raw("COALESCE(d.first_name || ' ' || d.last_name, d.id::text) as driver_name")
      )
      .orderBy(`ita.${sortCol}`, sortDir)
      .limit(pageSize)
      .offset(offset);

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total: parseInt(total, 10),
        totalPages: Math.ceil(parseInt(total, 10) / pageSize),
      },
    });
  } catch (err) {
    dtLogger.error('[idle-truck-alerts] GET /', err.message);
    return res.status(500).json({ error: 'Failed to fetch idle truck alerts' });
  }
});

// ─── GET /:id — Single alert detail ─────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const alert = await knex('idle_truck_alerts as ita')
      .where({ 'ita.id': req.params.id, 'ita.tenant_id': tid })
      .leftJoin('vehicles as v', 'v.id', 'ita.vehicle_id')
      .leftJoin('drivers as d', 'd.id', 'ita.driver_id')
      .leftJoin('users as u', 'u.id', 'ita.responded_by')
      .select(
        'ita.*',
        knex.raw("COALESCE(v.unit_number, v.vin, v.id::text) as vehicle_label"),
        knex.raw("COALESCE(d.first_name || ' ' || d.last_name, d.id::text) as driver_name"),
        knex.raw("COALESCE(u.first_name || ' ' || u.last_name, u.email) as responded_by_name")
      )
      .first();

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    return res.json({ success: true, data: alert });
  } catch (err) {
    dtLogger.error('[idle-truck-alerts] GET /:id', err.message);
    return res.status(500).json({ error: 'Failed to fetch alert detail' });
  }
});

// ─── PATCH /:id/respond — Update response status ───────────────────────────

router.patch('/:id/respond', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const { response_status, response_notes } = req.body;

    if (!response_status) {
      return res.status(400).json({ error: 'response_status is required' });
    }

    const validStatuses = ['pending', 'acknowledged', 'resolved', 'escalated'];
    if (!validStatuses.includes(response_status)) {
      return res.status(400).json({
        error: `response_status must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const alert = await knex('idle_truck_alerts')
      .where({ id: req.params.id, tenant_id: tid })
      .first();

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const respondedBy = req.user?.userId || req.user?.id || null;

    const [updated] = await knex('idle_truck_alerts')
      .where({ id: req.params.id, tenant_id: tid })
      .update({
        response_status,
        response_notes: response_notes || null,
        responded_by: respondedBy,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    return res.json({ success: true, data: updated });
  } catch (err) {
    dtLogger.error('[idle-truck-alerts] PATCH /:id/respond', err.message);
    return res.status(500).json({ error: 'Failed to update alert response' });
  }
});

// ─── POST /run-check — Manually trigger idle check (admin) ─────────────────

router.post('/run-check', async (req, res) => {
  try {
    const tid = requireTenant(req, res);
    if (!tid) return;

    const result = await runIdleTruckCheckForTenant(tid);

    return res.json({
      success: true,
      message: 'Idle truck check completed',
      data: result,
    });
  } catch (err) {
    dtLogger.error('[idle-truck-alerts] POST /run-check', err.message);
    return res.status(500).json({ error: 'Failed to run idle truck check' });
  }
});

module.exports = router;
