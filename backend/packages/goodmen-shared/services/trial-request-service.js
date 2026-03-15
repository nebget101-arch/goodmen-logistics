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
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { VALID_PLAN_IDS, TRIAL_REQUEST_STATUSES, PLANS } = require('../config/plans');

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

function normalizeUsername(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return normalized || null;
}

function buildSuggestedUsername(record) {
  const fromEmail = String(record?.email || '').split('@')[0];
  if (fromEmail) return fromEmail;

  const contact = String(record?.contact_name || '').trim();
  if (!contact) return 'trial-admin';
  return contact.toLowerCase().replace(/\s+/g, '.');
}

async function generateUniqueUsername(trx, preferredBase) {
  const base = normalizeUsername(preferredBase) || 'trial-admin';
  let candidate = base;
  let suffix = 1;

  while (true) {
    const existing = await trx('users').where({ username: candidate }).first('id');
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
}

function getSignupTokenTtlHours() {
  const raw = parseInt(process.env.TRIAL_SIGNUP_TOKEN_TTL_HOURS, 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 168; // 7 days
}

function generateTemporaryPassword() {
  const randomPart = crypto.randomBytes(8).toString('base64url');
  const numericPart = String(Math.floor(100 + Math.random() * 900));
  return `Fn!${randomPart}${numericPart}`;
}

async function approveTrialRequest(id, approvedByUserId = null) {
  const existing = await knex('trial_requests').where({ id }).first();
  if (!existing) {
    const err = new Error('Trial request not found');
    err.statusCode = 404;
    throw err;
  }

  if (existing.status === 'trial_created') {
    const err = new Error('Trial account is already provisioned for this request');
    err.statusCode = 409;
    throw err;
  }

  const token = crypto.randomBytes(24).toString('hex');
  const ttlHours = getSignupTokenTtlHours();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const [record] = await knex('trial_requests')
    .where('id', id)
    .update({
      status: 'approved',
      approved_at: knex.fn.now(),
      approved_by_user_id: approvedByUserId || null,
      signup_token: token,
      signup_token_expires_at: expiresAt,
      updated_at: knex.fn.now()
    })
    .returning('*');

  return record;
}

async function getOrCreateApprovedSignupToken(id, approvedByUserId = null, options = {}) {
  const forceRegenerate = Boolean(options?.forceRegenerate);

  const existing = await knex('trial_requests').where({ id }).first();
  if (!existing) {
    const err = new Error('Trial request not found');
    err.statusCode = 404;
    throw err;
  }

  if (existing.status === 'trial_created' || existing.signup_completed_at) {
    const err = new Error('Trial signup is already completed for this request');
    err.statusCode = 409;
    throw err;
  }

  if (existing.status !== 'approved') {
    const err = new Error('Trial request must be approved before generating a signup link');
    err.statusCode = 400;
    throw err;
  }

  const hasValidToken =
    Boolean(existing.signup_token)
    && (!existing.signup_token_expires_at || new Date(existing.signup_token_expires_at).getTime() > Date.now());

  if (hasValidToken && !forceRegenerate) {
    return existing;
  }

  const token = crypto.randomBytes(24).toString('hex');
  const ttlHours = getSignupTokenTtlHours();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const [record] = await knex('trial_requests')
    .where({ id })
    .update({
      approved_by_user_id: approvedByUserId || existing.approved_by_user_id || null,
      signup_token: token,
      signup_token_expires_at: expiresAt,
      updated_at: knex.fn.now()
    })
    .returning('*');

  return record;
}

async function getSignupContextByToken(token) {
  const safeToken = String(token || '').trim();
  if (!safeToken) {
    const err = new Error('Signup token is required');
    err.statusCode = 400;
    throw err;
  }

  const record = await knex('trial_requests')
    .where({ signup_token: safeToken })
    .first();

  if (!record) {
    const err = new Error('Invalid signup token');
    err.statusCode = 404;
    throw err;
  }

  if (record.status !== 'approved' && record.status !== 'trial_created') {
    const err = new Error('This trial request is not approved for signup');
    err.statusCode = 400;
    throw err;
  }

  if (record.signup_completed_at) {
    return {
      status: 'completed',
      requestId: record.id,
      companyName: record.company_name,
      contactName: record.contact_name,
      email: record.email,
      requestedPlan: record.requested_plan,
      plan: PLANS[record.requested_plan] || null
    };
  }

  if (record.signup_token_expires_at && new Date(record.signup_token_expires_at).getTime() < Date.now()) {
    const err = new Error('Signup token has expired');
    err.statusCode = 410;
    throw err;
  }

  return {
    status: 'ready',
    requestId: record.id,
    companyName: record.company_name,
    contactName: record.contact_name,
    email: record.email,
    requestedPlan: record.requested_plan,
    plan: PLANS[record.requested_plan] || null,
    expiresAt: record.signup_token_expires_at
  };
}

async function completeSignupFromToken(token, payload = {}) {
  const safeToken = String(token || '').trim();
  if (!safeToken) {
    const err = new Error('Signup token is required');
    err.statusCode = 400;
    throw err;
  }

  const password = String(payload.password || '');
  if (password.length < 8) {
    const err = new Error('Password must be at least 8 characters');
    err.statusCode = 400;
    throw err;
  }

  return knex.transaction(async (trx) => {
    const record = await trx('trial_requests')
      .where({ signup_token: safeToken })
      .forUpdate()
      .first();

    if (!record) {
      const err = new Error('Invalid signup token');
      err.statusCode = 404;
      throw err;
    }

    if (record.signup_completed_at || record.status === 'trial_created') {
      const err = new Error('Signup has already been completed');
      err.statusCode = 409;
      throw err;
    }

    if (record.status !== 'approved') {
      const err = new Error('Trial request is not approved yet');
      err.statusCode = 400;
      throw err;
    }

    if (record.signup_token_expires_at && new Date(record.signup_token_expires_at).getTime() < Date.now()) {
      const err = new Error('Signup token has expired');
      err.statusCode = 410;
      throw err;
    }

    const normalizedEmail = String(record.email || '').trim().toLowerCase();
    const emailExists = await trx('users').whereRaw('LOWER(email) = ?', [normalizedEmail]).first('id');
    if (emailExists) {
      const err = new Error('An account already exists for this email');
      err.statusCode = 409;
      throw err;
    }

    const firstName = String(payload.firstName || '').trim() || null;
    const lastName = String(payload.lastName || '').trim() || null;
    const requestedUsername = String(payload.username || '').trim();
    const usernameBase = requestedUsername || buildSuggestedUsername(record);
    const username = await generateUniqueUsername(trx, usernameBase);
    const passwordHash = await bcrypt.hash(password, 10);

    const [tenant] = await trx('tenants')
      .insert({
        name: String(record.company_name || 'Trial Tenant').trim(),
        legal_name: String(record.company_name || '').trim() || null,
        status: 'active',
        subscription_plan: record.requested_plan || 'basic'
      })
      .returning(['id', 'name']);

    const [operatingEntity] = await trx('operating_entities')
      .insert({
        tenant_id: tenant.id,
        entity_type: 'carrier',
        name: String(record.company_name || 'Main').trim(),
        legal_name: String(record.company_name || '').trim() || null,
        email: normalizedEmail,
        phone: String(record.phone || '').trim() || null,
        is_active: true,
        default_currency: 'USD'
      })
      .returning(['id', 'tenant_id', 'name']);

    const [user] = await trx('users')
      .insert({
        username,
        password_hash: passwordHash,
        role: 'admin',
        first_name: firstName,
        last_name: lastName,
        email: normalizedEmail,
        tenant_id: tenant.id
      })
      .returning(['id', 'username', 'email', 'role']);

    await trx('user_tenant_memberships')
      .insert({
        user_id: user.id,
        tenant_id: tenant.id,
        membership_role: 'owner',
        is_default: true,
        is_active: true
      })
      .onConflict(['user_id', 'tenant_id'])
      .ignore();

    await trx('user_operating_entities')
      .insert({
        user_id: user.id,
        operating_entity_id: operatingEntity.id,
        access_level: 'owner',
        is_default: true,
        is_active: true
      })
      .onConflict(['user_id', 'operating_entity_id'])
      .ignore();

    await trx('trial_requests')
      .where({ id: record.id })
      .update({
        status: 'trial_created',
        signup_completed_at: trx.fn.now(),
        signup_token: null,
        signup_token_expires_at: null,
        created_tenant_id: tenant.id,
        created_operating_entity_id: operatingEntity.id,
        created_user_id: user.id,
        updated_at: trx.fn.now()
      });

    return {
      requestId: record.id,
      username: user.username,
      email: user.email,
      role: user.role,
      tenantId: tenant.id,
      operatingEntityId: operatingEntity.id,
      requestedPlan: record.requested_plan,
      plan: PLANS[record.requested_plan] || null
    };
  });
}

/**
 * Get a single trial request by ID. Admin use only.
 * @param {string} id
 * @returns {Object|null}
 */
async function getTrialRequestById(id) {
  return knex('trial_requests').where('id', id).first();
}

async function resetTenantAdminPassword(trialRequestId) {
  const safeId = String(trialRequestId || '').trim();
  if (!safeId) {
    const err = new Error('Trial request id is required');
    err.statusCode = 400;
    throw err;
  }

  return knex.transaction(async (trx) => {
    const record = await trx('trial_requests')
      .where({ id: safeId })
      .forUpdate()
      .first();

    if (!record) {
      const err = new Error('Trial request not found');
      err.statusCode = 404;
      throw err;
    }

    if (record.status !== 'trial_created' || !record.created_user_id) {
      const err = new Error('Tenant admin account is not available for password reset yet');
      err.statusCode = 409;
      throw err;
    }

    const user = await trx('users')
      .where({ id: record.created_user_id })
      .first(['id', 'username', 'email', 'tenant_id']);

    if (!user) {
      const err = new Error('Tenant admin user not found for this trial request');
      err.statusCode = 404;
      throw err;
    }

    if (record.created_tenant_id && user.tenant_id && String(record.created_tenant_id) !== String(user.tenant_id)) {
      const err = new Error('Tenant admin account mapping mismatch for this trial request');
      err.statusCode = 409;
      throw err;
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    await trx('users')
      .where({ id: user.id })
      .update({ password_hash: passwordHash });

    await trx('trial_requests')
      .where({ id: record.id })
      .update({ updated_at: trx.fn.now() });

    return {
      requestId: record.id,
      userId: user.id,
      username: user.username,
      email: user.email,
      temporaryPassword
    };
  });
}

module.exports = {
  createTrialRequest,
  listTrialRequests,
  updateTrialRequestStatus,
  approveTrialRequest,
  getOrCreateApprovedSignupToken,
  getTrialRequestById,
  getSignupContextByToken,
  completeSignupFromToken,
  resetTenantAdminPassword
};
