'use strict';

/**
 * FN-1240: Thin router that intercepts PATCH /api/roadside/calls/:id/status
 * to fire incident.state_changed WS + SMS events after a successful status
 * transition. Mount this BEFORE the shared roadsideRouter in server.js.
 *
 * State → incident state mapping (roadside call statuses → canonical event states):
 *   OPEN / PENDING   → 'intake_started'
 *   IN_PROGRESS      → 'triage_complete'
 *   ON_SITE          → 'on_site'
 *   RESOLVED         → 'complete'
 *   CANCELED         → (no WS event)
 *
 * The version counter uses the call's updated_at unix epoch (seconds) so it
 * is monotonically increasing without an extra sequence column. It is only
 * used for idempotent dedup — clients should treat state transitions as
 * ordered by changedAt, not by version.
 */

const express = require('express');
const router = express.Router();
const roadsideService = require('@goodmen/shared/services/roadside.service');
const { dispatchIncidentStateChanged } = require('../services/incident-events');

const STATUS_TO_INCIDENT_STATE = {
  OPEN: 'intake_started',
  PENDING: 'intake_started',
  IN_PROGRESS: 'triage_complete',
  ON_SITE: 'on_site',
  RESOLVED: 'complete'
};

router.patch('/calls/:id/status', async (req, res) => {
  let row;
  try {
    const userId = req.context?.userId || req.user?.id || null;
    row = await roadsideService.setStatus(req.params.id, req.body.status, userId, req.context);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.json(row);

  // Fire-and-forget dispatch — response already sent
  const incidentState = STATUS_TO_INCIDENT_STATE[row.status];
  if (incidentState && row.tenant_id) {
    const version = row.updated_at ? Math.floor(new Date(row.updated_at).getTime() / 1000) : Date.now();
    dispatchIncidentStateChanged({
      tenantId: row.tenant_id,
      incidentId: String(row.id),
      state: incidentState,
      version,
      changedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
      recipientPhones: [row.caller_phone].filter(Boolean)
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[roadside-realtime] dispatch error:', err?.message || err);
    });
  }
});

module.exports = router;
