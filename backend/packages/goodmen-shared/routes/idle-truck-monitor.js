/**
 * Idle Truck Monitor routes — FN-501
 *
 * POST   /api/idle-truck-monitor/run            — trigger daily check (admin/manager)
 * GET    /api/idle-truck-monitor/alerts          — list idle_truck_alerts
 * PATCH  /api/idle-truck-monitor/alerts/:id/respond — update response_status
 */

const express = require('express');
const router = express.Router();
const path = require('path');

const sharedRoot = path.join(__dirname, '..');
const knex = require(path.join(sharedRoot, 'config', 'knex'));
const { runIdleTruckCheck } = require(path.join(sharedRoot, 'services', 'idle-truck-monitor-service'));

// ---------------------------------------------------------------------------
// POST /run — trigger idle truck check
// ---------------------------------------------------------------------------
router.post('/run', async (req, res) => {
  const { role, id: userId } = req.user || {};
  if (!['admin', 'manager'].includes(role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const stats = await runIdleTruckCheck(knex, userId || null);
    return res.json({ success: true, stats });
  } catch (err) {
    console.error('[IdleTruckMonitor] run error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /alerts — list idle_truck_alerts
// Query params: alert_type, response_status, vehicle_id, driver_id, limit, offset
// ---------------------------------------------------------------------------
router.get('/alerts', async (req, res) => {
  const { tenantId } = req;
  const { alert_type, response_status, vehicle_id, driver_id, limit = 50, offset = 0 } = req.query;

  try {
    const hasTable = await knex.schema.hasTable('idle_truck_alerts').catch(() => false);
    if (!hasTable) {
      return res.json({ alerts: [], total: 0 });
    }

    const query = knex('idle_truck_alerts as a')
      .leftJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .leftJoin('drivers as d', 'd.id', 'a.driver_id')
      .modify((q) => { if (tenantId) q.where('a.tenant_id', tenantId); })
      .modify((q) => { if (alert_type) q.where('a.alert_type', alert_type); })
      .modify((q) => { if (response_status) q.where('a.response_status', response_status); })
      .modify((q) => { if (vehicle_id) q.where('a.vehicle_id', vehicle_id); })
      .modify((q) => { if (driver_id) q.where('a.driver_id', driver_id); })
      .orderBy('a.created_at', 'desc');

    const [{ total }] = await query.clone().clearOrder().count('a.id as total');

    const alerts = await query
      .select(
        'a.*',
        'v.unit_number as truck_number',
        knex.raw("CONCAT(d.first_name, ' ', d.last_name) as driver_name")
      )
      .limit(Number(limit))
      .offset(Number(offset));

    return res.json({ alerts, total: Number(total) });
  } catch (err) {
    console.error('[IdleTruckMonitor] GET /alerts error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /alerts/:id/respond — update response_status
// Body: { response_status: 'acknowledged' | 'resolved' | 'escalated', response_notes? }
// ---------------------------------------------------------------------------
router.patch('/alerts/:id/respond', async (req, res) => {
  const { id } = req.params;
  const { tenantId } = req;
  const { id: userId, role } = req.user || {};
  const { response_status, response_notes } = req.body;

  const VALID_STATUSES = ['acknowledged', 'resolved', 'escalated'];
  if (!VALID_STATUSES.includes(response_status)) {
    return res.status(400).json({ error: `response_status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  try {
    const hasTable = await knex.schema.hasTable('idle_truck_alerts').catch(() => false);
    if (!hasTable) {
      return res.status(404).json({ error: 'idle_truck_alerts table not found' });
    }

    const existing = await knex('idle_truck_alerts')
      .where({ id })
      .modify((q) => { if (tenantId) q.where('tenant_id', tenantId); })
      .first();

    if (!existing) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const [updated] = await knex('idle_truck_alerts')
      .where({ id })
      .update({
        response_status,
        response_notes: response_notes || null,
        responded_by: userId || null,
        responded_at: knex.fn.now()
      })
      .returning('*');

    return res.json({ success: true, alert: updated });
  } catch (err) {
    console.error('[IdleTruckMonitor] PATCH /alerts/:id/respond error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

module.exports = router;
