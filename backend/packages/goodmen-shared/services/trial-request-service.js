'use strict';

/**
 * Trial Request Service
 * Handles creation, listing, and status updates for free trial / marketing leads.
 *
 * Future extension points:
 * - createTrialTenant(trialRequestId)   → provisions a trial tenant
 * - sendConfirmationEmail(record)       → send welcome email to requester
 * - notifyInternalTeam(record)          → alert sales/ops team on new request
 */

const { knex } = require('../internal/db');
const { VALID_PLAN_IDS, TRIAL_REQUEST_STATUSES } = require('../config/plans');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate and create a new trial request record.
 * @param {Object} payload
 * @returns {Object} created record
 */
async function createTrialRequest(payload) {
  const {
    companyName,
    contactName,
    email,
    phone,
    fleetSize,
    currentSystem,
    requestedPlan,
    wantsDemoAssistance,
    notes,
    source = 'marketing_website'
  } = payload || {};

  const errors = [];
  if (!companyName || !String(companyName).trim()) errors.push('companyName is required');
  if (!contactName || !String(contactName).trim()) errors.push('contactName is required');
  if (!email || !EMAIL_RE.test(String(email).trim())) errors.push('A valid email address is required');
  if (!phone || !String(phone).trim()) errors.push('phone is required');
  if (!requestedPlan || !VALID_PLAN_IDS.includes(requestedPlan)) {
    errors.push(`requestedPlan must be one of: ${VALID_PLAN_IDS.join(', ')}`);
  }

  if (errors.length > 0) {
    const err = new Error(errors.join('; '));
    err.statusCode = 400;
    err.validationErrors = errors;
    throw err;
  }

  const [record] = await knex('trial_requests')
    .insert({
      company_name: String(companyName).trim(),
      contact_name: String(contactName).trim(),
      email: String(email).trim().toLowerCase(),
      phone: String(phone).trim(),
      fleet_size: fleetSize ? String(fleetSize).trim() : null,
      current_system: currentSystem ? String(currentSystem).trim() : null,
      requested_plan: requestedPlan,
      wants_demo_assistance: Boolean(wantsDemoAssistance),
      notes: notes ? String(notes).trim() : null,
      source: source || 'marketing_website',
      status: 'new'
    })
    .returning('*');

  return record;
}

/**
 * List trial requests. Admin use only.
 * @param {Object} options
 * @param {string} [options.status]  - filter by status
 * @param {number} [options.page=1]
 * @param {number} [options.pageSize=25]
 * @returns {Array}
 */
async function listTrialRequests({ status, page = 1, pageSize = 25 } = {}) {
  const q = knex('trial_requests').orderBy('created_at', 'desc');
  if (status) q.where('status', status);
  const offset = (Math.max(1, page) - 1) * pageSize;
  return q.limit(pageSize).offset(offset);
}

/**
 * Update the status of a trial request.
 * @param {string} id
 * @param {string} status
 * @returns {Object} updated record
 */
async function updateTrialRequestStatus(id, status) {
  if (!TRIAL_REQUEST_STATUSES.includes(status)) {
    const err = new Error(
      `Invalid status. Must be one of: ${TRIAL_REQUEST_STATUSES.join(', ')}`
    );
    err.statusCode = 400;
    throw err;
  }

  const [record] = await knex('trial_requests')
    .where('id', id)
    .update({ status, updated_at: knex.fn.now() })
    .returning('*');

  if (!record) {
    const err = new Error('Trial request not found');
    err.statusCode = 404;
    throw err;
  }

  return record;
}

/**
 * Get a single trial request by ID. Admin use only.
 * @param {string} id
 * @returns {Object|null}
 */
async function getTrialRequestById(id) {
  return knex('trial_requests').where('id', id).first();
}

module.exports = {
  createTrialRequest,
  listTrialRequests,
  updateTrialRequestStatus,
  getTrialRequestById
};
