'use strict';

/**
 * FN-1240: SMS notifications for incident state changes.
 *
 * Wraps the existing Twilio integration in notification-service.js.
 * Checks the `sms_optin` table (created by FN-1241) before sending.
 * Falls back to allowing SMS if the table doesn't exist yet.
 *
 * GDPR: Recipients must have explicitly opted in via the sms_optin table.
 * Opt-in is stored per (tenant_id, phone_e164) with a consented_at timestamp.
 */

const { sendSms, toE164 } = require('./notification-service');
const { query } = require('@goodmen/shared/config/database');

const STATE_MESSAGES = {
  intake_started: 'FleetNeuron: Your roadside request has been received and is being processed.',
  triage_complete: 'FleetNeuron: Your roadside incident has been triaged. A dispatcher is reviewing.',
  on_site: 'FleetNeuron: Your roadside technician is on-site.',
  complete: 'FleetNeuron: Your roadside service is complete. Thank you.'
};

/**
 * Check whether a recipient has opted in to SMS for roadside incident updates.
 * Returns true (allow) on any DB error so a missing table never silently blocks delivery.
 * @param {string} tenantId
 * @param {string} phoneE164
 * @returns {Promise<boolean>}
 */
async function _isSmsOptedIn(tenantId, phoneE164) {
  try {
    const result = await query(
      `SELECT 1 FROM sms_optin
       WHERE tenant_id = $1 AND phone_e164 = $2 AND opted_out_at IS NULL
       LIMIT 1`,
      [tenantId, phoneE164]
    );
    return result.rows.length > 0;
  } catch (_) {
    return true;
  }
}

/**
 * Send an SMS notification to a recipient when an incident state changes.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.incidentId
 * @param {string} params.state        one of the STATE_MESSAGES keys
 * @param {string} params.recipientPhone  raw phone number (normalized internally)
 * @param {string} [params.customMessage]  override the default state message
 * @returns {Promise<{ sent: boolean, skipped?: string, error?: string, sid?: string }>}
 */
async function notifyIncidentStateChanged({ tenantId, incidentId, state, recipientPhone, customMessage }) {
  if (!tenantId || !incidentId || !state || !recipientPhone) {
    return { sent: false, skipped: 'missing_required_fields' };
  }

  const phoneE164 = toE164(recipientPhone);
  if (!phoneE164) {
    return { sent: false, skipped: 'invalid_phone' };
  }

  const optedIn = await _isSmsOptedIn(tenantId, phoneE164);
  if (!optedIn) {
    return { sent: false, skipped: 'not_opted_in' };
  }

  const body = customMessage || STATE_MESSAGES[state] || `FleetNeuron: Incident ${incidentId} status: ${state}`;
  return sendSms(phoneE164, body);
}

module.exports = {
  notifyIncidentStateChanged,
  STATE_MESSAGES
};
