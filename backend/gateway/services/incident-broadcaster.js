'use strict';

/**
 * FN-1240: Incident state change broadcaster for the WebSocket gateway.
 *
 * Follows the alerts-ws.js pattern: takes an `emit` function so the broadcaster
 * can be injected with a mock in tests and the live Socket.IO emitter in prod.
 *
 * Clients subscribe to:
 *   - `incident.state_changed`  payload: { tenantId, incidentId, state, version, changedAt, meta }
 *
 * Per-tenant rooms (`tenant:<id>`) are already joined on WS handshake in index.js.
 * This module only broadcasts; room join stays in initWebSocket.
 */

const EVENT_INCIDENT_STATE_CHANGED = 'incident.state_changed';

function buildIncidentBroadcaster(deps) {
  const { emit } = deps;
  if (typeof emit !== 'function') {
    throw new Error('incident-broadcaster: emit function is required');
  }

  /**
   * Broadcast an incident state change to all tenant-scoped WS clients.
   * @param {object} params
   * @param {string} params.tenantId
   * @param {string} params.incidentId
   * @param {string} params.state  e.g. 'intake_started' | 'triage_complete' | 'on_site' | 'complete'
   * @param {number} params.version  monotonic version counter for idempotency
   * @param {string} [params.changedAt]  ISO timestamp; defaults to now
   * @param {object} [params.meta]  optional free-form metadata
   * @returns {{ delivered: boolean, reason?: string }}
   */
  function broadcastStateChanged({ tenantId, incidentId, state, version, changedAt, meta }) {
    if (!tenantId || !incidentId || !state || version === undefined) {
      return { delivered: false, reason: 'missing_required_fields' };
    }
    return emit({
      tenantId,
      event: EVENT_INCIDENT_STATE_CHANGED,
      payload: {
        tenantId,
        incidentId,
        state,
        version,
        changedAt: changedAt || new Date().toISOString(),
        meta: meta || {}
      }
    });
  }

  return { broadcastStateChanged };
}

module.exports = {
  buildIncidentBroadcaster,
  EVENT_INCIDENT_STATE_CHANGED
};
