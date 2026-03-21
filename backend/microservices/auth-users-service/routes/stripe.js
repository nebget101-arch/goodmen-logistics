'use strict';

const express = require('express');
const stripe = require('@goodmen/shared/config/stripe');
const { knex } = require('@goodmen/shared/internal/db');
const trialService = require('@goodmen/shared/services/trialService');
const dtLogger = require('@goodmen/shared/utils/logger');

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
      .first('id', 'email', 'trial_status', 'stripe_subscription_id');

    if (!tenant) {
      dtLogger.warn('[stripe-webhook] tenant not found for stripe customer', {
        eventId: event.id,
        stripeCustomerId
      });
      return;
    }

    const gracePeriodEnd = new Date();
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 3);

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
        gracePeriodDays: 3,
        gracePeriodEnd: gracePeriodEnd.toISOString()
      }
    );

    dtLogger.info('[stripe-webhook] payment failure grace period set', {
      eventId: event.id,
      tenantId: tenant.id,
      gracePeriodEnd: gracePeriodEnd.toISOString()
    });

    dtLogger.info('[stripe-webhook] payment failure email to be sent', {
      eventId: event.id,
      tenantId: tenant.id,
      email: tenant.email,
      note: 'Email implementation in FN-76'
    });
  } catch (err) {
    dtLogger.error('[stripe-webhook] payment_failed handler error', err, {
      eventId: event.id,
      error: err?.message
    });
  }
}

async function handleSubscriptionUpdated(event) {
  dtLogger.info('[stripe-webhook] handler customer.subscription.updated', { eventId: event.id });
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
    default:
      break;
  }
}

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
