'use strict';

const stripe = require('../config/stripe');

function stripeError(code, message, cause, context = {}) {
  const err = new Error(message);
  err.code = code;
  err.context = context;
  if (cause) err.cause = cause;
  return err;
}

function assertStripeConfigured() {
  if (stripe?._disabled) {
    throw stripeError(
      'STRIPE_NOT_CONFIGURED',
      'Stripe is not configured. Set STRIPE_SECRET_KEY to enable billing features.'
    );
  }
}

/**
 * Create a Stripe customer for a tenant.
 * @param {string} tenantId FleetNeuron tenant ID.
 * @param {string} email Customer billing email.
 * @param {string} name Customer display name.
 * @returns {Promise<import('stripe').Stripe.Customer>} Stripe customer object.
 */
async function createCustomer(tenantId, email, name) {
  try {
    assertStripeConfigured();
    return await stripe.customers.create({
      email,
      name,
      metadata: {
        tenantId: String(tenantId || '')
      }
    });
  } catch (error) {
    throw stripeError('STRIPE_CREATE_CUSTOMER_FAILED', 'Failed to create Stripe customer', error, { tenantId, email, name });
  }
}

/**
 * Attach a payment method to a Stripe customer and make it default.
 * @param {string} stripeCustomerId Stripe customer ID.
 * @param {string} paymentMethodId Stripe payment method ID.
 * @returns {Promise<{paymentMethod: import('stripe').Stripe.PaymentMethod, customer: import('stripe').Stripe.Customer}>}
 */
async function attachPaymentMethod(stripeCustomerId, paymentMethodId) {
  try {
    assertStripeConfigured();
    const paymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
      customer: stripeCustomerId
    });

    const customer = await stripe.customers.update(stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId
      }
    });

    return { paymentMethod, customer };
  } catch (error) {
    throw stripeError('STRIPE_ATTACH_PAYMENT_METHOD_FAILED', 'Failed to attach payment method', error, {
      stripeCustomerId,
      paymentMethodId
    });
  }
}

/**
 * Detach a payment method from its current customer.
 * @param {string} paymentMethodId Stripe payment method ID.
 * @returns {Promise<import('stripe').Stripe.PaymentMethod>} Detached payment method.
 */
async function detachPaymentMethod(paymentMethodId) {
  try {
    assertStripeConfigured();
    return await stripe.paymentMethods.detach(paymentMethodId);
  } catch (error) {
    throw stripeError('STRIPE_DETACH_PAYMENT_METHOD_FAILED', 'Failed to detach payment method', error, {
      paymentMethodId
    });
  }
}

/**
 * Retrieve payment method card details.
 * @param {string} paymentMethodId Stripe payment method ID.
 * @returns {Promise<{id: string, brand: string | null, last4: string | null, exp_month: number | null, exp_year: number | null}>}
 */
async function getPaymentMethod(paymentMethodId) {
  try {
    assertStripeConfigured();
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    return {
      id: paymentMethod.id,
      brand: paymentMethod.card?.brand || null,
      last4: paymentMethod.card?.last4 || null,
      exp_month: paymentMethod.card?.exp_month || null,
      exp_year: paymentMethod.card?.exp_year || null
    };
  } catch (error) {
    throw stripeError('STRIPE_GET_PAYMENT_METHOD_FAILED', 'Failed to fetch payment method details', error, {
      paymentMethodId
    });
  }
}

/**
 * Create a setup intent for card collection.
 * @param {string} stripeCustomerId Stripe customer ID.
 * @returns {Promise<{id: string, client_secret: string | null, status: string}>}
 */
async function createSetupIntent(stripeCustomerId) {
  try {
    assertStripeConfigured();
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      usage: 'off_session'
    });

    return {
      id: setupIntent.id,
      client_secret: setupIntent.client_secret,
      status: setupIntent.status
    };
  } catch (error) {
    throw stripeError('STRIPE_CREATE_SETUP_INTENT_FAILED', 'Failed to create setup intent', error, {
      stripeCustomerId
    });
  }
}

/**
 * Create a subscription for a customer using a Stripe Price ID.
 * @param {string} stripeCustomerId Stripe customer ID.
 * @param {string} stripePriceId Stripe price ID.
 * @returns {Promise<import('stripe').Stripe.Subscription>} Stripe subscription object.
 */
async function createSubscription(stripeCustomerId, stripePriceId) {
  try {
    assertStripeConfigured();
    return await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: stripePriceId }],
      payment_behavior: 'error_if_incomplete',
      expand: ['latest_invoice.payment_intent']
    });
  } catch (error) {
    throw stripeError('STRIPE_CREATE_SUBSCRIPTION_FAILED', 'Failed to create subscription', error, {
      stripeCustomerId,
      stripePriceId
    });
  }
}

/**
 * Cancel a subscription at the end of current billing period.
 * @param {string} stripeSubscriptionId Stripe subscription ID.
 * @returns {Promise<import('stripe').Stripe.Subscription>} Updated Stripe subscription.
 */
async function cancelSubscription(stripeSubscriptionId) {
  try {
    assertStripeConfigured();
    return await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true
    });
  } catch (error) {
    throw stripeError('STRIPE_CANCEL_SUBSCRIPTION_FAILED', 'Failed to cancel subscription', error, {
      stripeSubscriptionId
    });
  }
}

/**
 * Add recurring extra-seat quantity on an existing subscription (prorated invoice).
 * @param {string} subscriptionId
 * @param {string} extraSeatPriceId Stripe Price id (e.g. price_xxx)
 * @param {number} quantityToAdd
 */
async function applyExtraSeatPurchase(subscriptionId, extraSeatPriceId, quantityToAdd) {
  try {
    assertStripeConfigured();
    const qtyAdd = Math.min(100, Math.max(1, Math.floor(Number(quantityToAdd) || 1)));

    const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
    const line = (sub.items?.data || []).find((item) => item.price && item.price.id === extraSeatPriceId);

    if (line) {
      return await stripe.subscriptionItems.update(line.id, {
        quantity: (line.quantity || 0) + qtyAdd,
        proration_behavior: 'create_prorations'
      });
    }

    return await stripe.subscriptionItems.create({
      subscription: subscriptionId,
      price: extraSeatPriceId,
      quantity: qtyAdd,
      proration_behavior: 'create_prorations'
    });
  } catch (error) {
    throw stripeError(
      'STRIPE_EXTRA_SEAT_PURCHASE_FAILED',
      'Failed to add extra seats to subscription',
      error,
      { subscriptionId, extraSeatPriceId }
    );
  }
}

module.exports = {
  createCustomer,
  attachPaymentMethod,
  detachPaymentMethod,
  getPaymentMethod,
  createSetupIntent,
  createSubscription,
  cancelSubscription,
  applyExtraSeatPurchase
};
