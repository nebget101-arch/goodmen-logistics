/**
 * Trial Service (FN-72)
 * Centralizes all trial state transitions and queries for tenants.
 */
'use strict';

const { knex } = require('../internal/db');
const stripeService = require('./stripeService');

/**
 * Activate a trial for a tenant: sets trial_start, trial_end, trial_status, creates Stripe customer.
 * @param {string} tenantId
 * @param {string} planId
 * @param {number} trialDays
 * @param {string} [actorUserId] (for audit log)
 * @returns {Promise<void>}
 */
async function activateTrial(tenantId, planId, trialDays = 14, actorUserId = null) {
  const safeTrialDays = Number.isFinite(Number(trialDays)) && Number(trialDays) > 0
    ? Math.floor(Number(trialDays))
    : 14;
  const now = new Date();
  const trialEnd = new Date(now.getTime() + safeTrialDays * 24 * 60 * 60 * 1000);
  // Fetch tenant for email/name
  const tenant = await knex('tenants').where({ id: tenantId }).first();
  if (!tenant) throw new Error('Tenant not found');
  // Create Stripe customer if not present
  let stripeCustomerId = tenant.stripe_customer_id;
  if (!stripeCustomerId) {
    const customer = await stripeService.createCustomer(tenantId, tenant.email || tenant.legal_name || tenant.name, tenant.legal_name || tenant.name);
    stripeCustomerId = customer.id;
    await knex('tenants').where({ id: tenantId }).update({ stripe_customer_id: stripeCustomerId });
  }
  await knex('tenants').where({ id: tenantId }).update({
    trial_start: now,
    trial_end: trialEnd,
    trial_status: 'active',
    subscription_plan: planId,
    updated_at: knex.fn.now()
  });
  await writeAuditLog(tenantId, actorUserId, 'trial_activated', 'tenants', tenantId, {
    planId,
    trialDays: safeTrialDays
  });
}

/**
 * Get trial status and info for a tenant.
 * @param {string} tenantId
 * @returns {Promise<{trial_status, trial_start, trial_end, daysRemaining, hasPaymentMethod, stripe_customer_id}>}
 */
async function getTrialStatus(tenantId) {
  const t = await knex('tenants').where({ id: tenantId }).first();
  if (!t) throw new Error('Tenant not found');
  let daysRemaining = 0;
  if (t.trial_status === 'active' && t.trial_end) {
    daysRemaining = Math.max(0, Math.ceil((new Date(t.trial_end) - Date.now()) / (1000 * 60 * 60 * 24)));
  }
  let hasPaymentMethod = false;
  hasPaymentMethod = Boolean(t.stripe_payment_method_id);
  return {
    trial_status: t.trial_status,
    trial_start: t.trial_start,
    trial_end: t.trial_end,
    daysRemaining,
    hasPaymentMethod,
    stripe_customer_id: t.stripe_customer_id
  };
}

/**
 * Get integer days remaining in trial (0 if expired or not active).
 * @param {string} tenantId
 * @returns {Promise<number>}
 */
async function getDaysRemaining(tenantId) {
  const t = await knex('tenants').where({ id: tenantId }).first();
  if (!t || t.trial_status !== 'active' || !t.trial_end) return 0;
  return Math.max(0, Math.ceil((new Date(t.trial_end) - Date.now()) / (1000 * 60 * 60 * 24)));
}

/**
 * Expire a trial (sets trial_status = 'expired').
 * @param {string} tenantId
 * @param {string} [actorUserId]
 * @returns {Promise<void>}
 */
async function expireTrial(tenantId, actorUserId = null) {
  await knex('tenants').where({ id: tenantId }).update({
    trial_status: 'expired',
    updated_at: knex.fn.now()
  });
  await writeAuditLog(tenantId, actorUserId, 'trial_expired', 'tenants', tenantId, {});
}

/**
 * Mark a trial as converted (sets trial_status = 'converted', sets stripe_subscription_id).
 * @param {string} tenantId
 * @param {string} subscriptionId
 * @param {string} [actorUserId]
 * @returns {Promise<void>}
 */
async function markConverted(tenantId, subscriptionId, actorUserId = null) {
  await knex('tenants').where({ id: tenantId }).update({
    trial_status: 'converted',
    stripe_subscription_id: subscriptionId,
    updated_at: knex.fn.now()
  });
  await writeAuditLog(tenantId, actorUserId, 'trial_converted', 'tenants', tenantId, { subscriptionId });
}

/**
 * Write an audit log entry for trial state changes.
 * @private
 */
async function writeAuditLog(tenantId, userId, action, entityType, entityId, details = {}) {
  try {
    await knex('audit_logs').insert({
      tenant_id: tenantId,
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: JSON.stringify(details),
      created_at: knex.fn.now()
    });
  } catch {
    // Best effort only: do not block business flow on audit log failure.
  }
}

module.exports = {
  activateTrial,
  getTrialStatus,
  getDaysRemaining,
  expireTrial,
  markConverted,
  writeAuditLog
};
