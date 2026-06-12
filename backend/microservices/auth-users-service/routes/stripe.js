'use strict';

const express = require('express');
const stripe = require('@goodmen/shared/config/stripe');
const { knex } = require('@goodmen/shared/internal/db');
const trialService = require('@goodmen/shared/services/trialService');
const extraSeatSyncService = require('@goodmen/shared/services/extraSeatSyncService');
const billingEmailService = require('@goodmen/shared/services/billing-email-service');
const dtLogger = require('@goodmen/shared/utils/logger');

const PAYMENT_GRACE_PERIOD_DAYS = 3;

const router = express.Router();

async function handleSetupIntentSucceeded(event) {
  dtLogger.info('[stripe-webhook] handler setup_intent.succeeded', { eventId: event.id });
}

async function handlePaymentSucceeded(event) {
  dtLogger.info('[stripe-webhook] handler invoice.payment_succeeded', { eventId: event.id });

  try {
    const invoice = event.data?.object;
    if (!invoice?.customer || !invoice?.subscription) {
      dtLogger.warn('[stripe-webhook] payment_succeeded missing customer or subscription', {
        eventId: event.id,
        hasCustomer: !!invoice?.customer,
        hasSubscription: !!invoice?.subscription
      });
      return;
    }

    const stripeCustomerId = invoice.customer;
    const subscriptionId = invoice.subscription;

    const tenant = await knex('tenants')
      .where({ stripe_customer_id: stripeCustomerId })
      .first('id', 'trial_status');

    if (!tenant) {
      dtLogger.warn('[stripe-webhook] tenant not found for stripe customer', {
        eventId: event.id,
        stripeCustomerId
      });
      return;
    }

    if (tenant.trial_status === 'active') {
      await trialService.markConverted(tenant.id, subscriptionId, null);
      dtLogger.info('[stripe-webhook] trial marked as converted', {
        eventId: event.id,
        tenantId: tenant.id,
        subscriptionId
      });
    } else {
      dtLogger.info('[stripe-webhook] trial already converted or expired', {
        eventId: event.id,
        tenantId: tenant.id,
        status: tenant.trial_status
      });
    }
  } catch (err) {
    dtLogger.error('[stripe-webhook] payment_succeeded handler error', err, {
      eventId: event.id,
      error: err?.message
    });
  }
}

async function handlePaymentFailed(event) {
  dtLogger.info('[stripe-webhook] handler invoice.payment_failed', { eventId: event.id });

  try {
    const invoice = event.data?.object;
    if (!invoice?.customer) {
      dtLogger.warn('[stripe-webhook] payment_failed missing customer', { eventId: event.id });
      return;
    }

    const stripeCustomerId = invoice.customer;

    const tenant = await knex('tenants')
      .where({ stripe_customer_id: stripeCustomerId })
      .first('id', 'name', 'email', 'trial_status', 'stripe_subscription_id');

    if (!tenant) {
      dtLogger.warn('[stripe-webhook] tenant not found for stripe customer', {
        eventId: event.id,
        stripeCustomerId
      });
      return;
    }

    const gracePeriodEnd = new Date();
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + PAYMENT_GRACE_PERIOD_DAYS);

    await knex('tenants')
      .where({ id: tenant.id })
      .update({
        payment_grace_period_end: gracePeriodEnd,
        updated_at: knex.fn.now()
      });

    await trialService.writeAuditLog(
      tenant.id,
      null,
      'payment_failed',
      'tenants',
      tenant.id,
      {
        stripeInvoiceId: invoice.id,
        gracePeriodDays: PAYMENT_GRACE_PERIOD_DAYS,
        gracePeriodEnd: gracePeriodEnd.toISOString()
      }
    );

    dtLogger.info('[stripe-webhook] payment failure grace period set', {
      eventId: event.id,
      tenantId: tenant.id,
      gracePeriodEnd: gracePeriodEnd.toISOString()
    });

    // FN-1694: payment-failure email (replaces the FN-76 TODO). Sent once per
    // failed invoice with the grace-period deadline. Never throws — a mail
    // failure must not fail the webhook ack.
    if (tenant.email) {
      const emailResult = await billingEmailService.sendPaymentFailureEmail({
        to: tenant.email,
        tenantName: tenant.name,
        gracePeriodEnd,
        gracePeriodDays: PAYMENT_GRACE_PERIOD_DAYS
      });
      dtLogger.info('[stripe-webhook] payment failure email', {
        eventId: event.id,
        tenantId: tenant.id,
        sent: emailResult.sent,
        reason: emailResult.reason || null
      });
    } else {
      dtLogger.warn('[stripe-webhook] payment failure email skipped — tenant has no email', {
        eventId: event.id,
        tenantId: tenant.id
      });
    }
  } catch (err) {
    dtLogger.error('[stripe-webhook] payment_failed handler error', err, {
      eventId: event.id,
      error: err?.message
    });
  }
}

async function handleSubscriptionUpdated(event) {
  dtLogger.info('[stripe-webhook] handler customer.subscription.updated', { eventId: event.id });

  try {
    const obj = event.data?.object;
    if (!obj?.id || !obj?.customer) {
      dtLogger.warn('[stripe-webhook] subscription.updated missing id or customer', { eventId: event.id });
      return;
    }
    if (stripe?._disabled) return;

    await extraSeatSyncService.syncTenantExtraSeats(knex, stripe, obj.customer, obj.id);
  } catch (err) {
    dtLogger.error('[stripe-webhook] subscription.updated extra seat sync failed', err, {
      eventId: event.id,
      error: err?.message
    });
  }
}

async function handleSubscriptionDeleted(event) {
  dtLogger.info('[stripe-webhook] handler customer.subscription.deleted', { eventId: event.id });

  try {
    const obj = event.data?.object;
    if (!obj?.id) {
      dtLogger.warn('[stripe-webhook] subscription.deleted missing id', { eventId: event.id });
      return;
    }

    const subscriptionId = obj.id;
    const tenant = await knex('tenants')
      .where({ stripe_subscription_id: subscriptionId })
      .first('id', 'subscription_plan');

    if (!tenant) {
      dtLogger.warn('[stripe-webhook] tenant not found for deleted subscription', {
        eventId: event.id,
        subscriptionId
      });
      return;
    }

    // Sync local state: the subscription no longer exists in Stripe, so clear
    // the reference and flag the tenant as canceled.
    await knex('tenants')
      .where({ id: tenant.id })
      .update({
        stripe_subscription_id: null,
        trial_status: 'canceled',
        updated_at: knex.fn.now()
      });

    await trialService.writeAuditLog(
      tenant.id,
      null,
      'subscription_deleted',
      'tenants',
      tenant.id,
      {
        stripeSubscriptionId: subscriptionId,
        canceledAt: obj.canceled_at ? new Date(obj.canceled_at * 1000).toISOString() : null,
        status: obj.status || null
      }
    );

    dtLogger.info('[stripe-webhook] subscription deleted synced', {
      eventId: event.id,
      tenantId: tenant.id,
      subscriptionId
    });
  } catch (err) {
    dtLogger.error('[stripe-webhook] subscription.deleted handler error', err, {
      eventId: event.id,
      error: err?.message
    });
  }
}

async function routeEvent(event) {
  switch (event.type) {
    case 'setup_intent.succeeded':
      await handleSetupIntentSucceeded(event);
      break;
    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(event);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailed(event);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event);
      break;
    default:
      break;
  }
}

/**
 * @openapi
 * /api/stripe/webhook:
 *   post:
 *     summary: Stripe webhook receiver
 *     description: >
 *       Receives Stripe webhook events. The request body must be raw JSON (not parsed)
 *       so the stripe-signature header can be verified against STRIPE_WEBHOOK_SECRET.
 *       Handled event types:
 *       - setup_intent.succeeded — logs successful SetupIntent
 *       - invoice.payment_succeeded — marks trial as converted when first invoice is paid
 *       - invoice.payment_failed — sets a 3-day grace period, sends the payment-failure email, and logs an audit entry
 *       - customer.subscription.updated — syncs extra seat quantities from the subscription
 *       - customer.subscription.deleted — clears stripe_subscription_id, flags the tenant canceled, and logs an audit entry
 *       The endpoint acknowledges with 200 immediately and processes the event asynchronously.
 *     tags:
 *       - Billing
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: >
 *               Raw Stripe event payload. Key fields: type (event type string),
 *               id (event ID), data.object (event-specific resource).
 *               See https://docs.stripe.com/api/events for full schema.
 *             properties:
 *               id: { type: string, description: Stripe event ID }
 *               type: { type: string, description: "Event type (e.g. invoice.payment_succeeded)" }
 *               data:
 *                 type: object
 *                 properties:
 *                   object: { type: object, description: Event-specific resource }
 *     parameters:
 *       - in: header
 *         name: stripe-signature
 *         required: true
 *         schema: { type: string }
 *         description: Stripe webhook signature for payload verification
 *     responses:
 *       200:
 *         description: Event received and queued for async processing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 received: { type: boolean, example: true }
 *       400:
 *         description: Missing stripe-signature header, missing webhook secret, or invalid signature
 */
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return res.status(400).send('Missing stripe-signature header or webhook secret');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    dtLogger.warn('[stripe-webhook] invalid signature', { error: err?.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  dtLogger.info(`[stripe-webhook] received: ${event.type}`, { eventId: event.id });

  res.status(200).json({ received: true });

  setImmediate(() => {
    routeEvent(event).catch((err) => {
      dtLogger.error('[stripe-webhook] handler failure', err, { eventType: event.type, eventId: event.id });
    });
  });
});

module.exports = router;
