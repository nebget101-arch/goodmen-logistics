'use strict';

/**
 * FN-1240: Combined incident event dispatcher.
 *
 * Dispatches incident.state_changed events via:
 *   1. WebSocket broadcast through the gateway (real-time push to browser clients)
 *   2. SMS notification to opted-in recipients
 *
 * Call this from any route that transitions an incident's state, e.g.:
 *   PATCH /api/roadside/calls/:id/status
 *
 * Telemetry is written to stderr as structured JSON for log aggregation.
 * Does not throw — failures are logged and returned in the result object.
 *
 * Usage:
 *   const { dispatchIncidentStateChanged } = require('./incident-events');
 *   await dispatchIncidentStateChanged({
 *     tenantId, incidentId, state, version,
 *     recipientPhones: [driver.phone, caller.phone],
 *   });
 */

const { publishIncidentStateChanged } = require('./incident-event-publisher');
const { notifyIncidentStateChanged } = require('./incident-sms-notify');

/**
 * @param {object} params
 * @param {string}   params.tenantId
 * @param {string}   params.incidentId
 * @param {string}   params.state
 * @param {number}   params.version
 * @param {string}   [params.changedAt]
 * @param {object}   [params.meta]
 * @param {string[]} [params.recipientPhones]  list of phone numbers for SMS delivery
 * @returns {Promise<{ ws: object, sms: object[] }>}
 */
async function dispatchIncidentStateChanged({
  tenantId,
  incidentId,
  state,
  version,
  changedAt,
  meta,
  recipientPhones = []
}) {
  const startMs = Date.now();

  const wsResult = await publishIncidentStateChanged({
    tenantId,
    incidentId,
    state,
    version,
    changedAt,
    meta
  });

  const smsResults = await Promise.all(
    recipientPhones.map((phone) =>
      notifyIncidentStateChanged({ tenantId, incidentId, state, recipientPhone: phone })
    )
  );

  const elapsed = Date.now() - startMs;

  // Structured telemetry — one log line per dispatch
  const telemetry = {
    event: 'incident.dispatch',
    tenantId,
    incidentId,
    state,
    version,
    ws_published: wsResult.published,
    ws_duplicate: wsResult.duplicate,
    ws_latency_ms: wsResult.latency_ms,
    sms_count: smsResults.length,
    sms_sent: smsResults.filter((r) => r.sent).length,
    total_latency_ms: elapsed,
    ts: new Date().toISOString()
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(telemetry));

  return { ws: wsResult, sms: smsResults };
}

module.exports = { dispatchIncidentStateChanged };
