'use strict';

const dtLogger = require('../utils/logger');

/**
 * @param {import('stripe').Stripe.Subscription} subscription
 * @param {string} extraSeatPriceId
 * @returns {{ quantity: number, subscriptionItemId: string | null }}
 */
function getExtraSeatDetailsFromSubscription(subscription, extraSeatPriceId) {
  if (!extraSeatPriceId || !subscription?.items?.data?.length) {
    return { quantity: 0, subscriptionItemId: null };
  }
  const line = subscription.items.data.find((item) => item.price && item.price.id === extraSeatPriceId);
  if (!line) return { quantity: 0, subscriptionItemId: null };
  const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0));
  return { quantity, subscriptionItemId: line.id || null };
}

async function loadSubscriptionWithItems(stripe, subscriptionId) {
  return stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
}

/**
 * Persist extra seat count from Stripe subscription line item (idempotent).
 * @param {import('knex').Knex} knex
 * @param {import('stripe').Stripe} stripe
 * @param {string} stripeCustomerId
 * @param {string} subscriptionId
 */
async function syncTenantExtraSeats(knex, stripe, stripeCustomerId, subscriptionId) {
  const extraSeatPriceId = process.env.STRIPE_PRICE_EXTRA_USER_SEAT;
  if (!extraSeatPriceId || stripe?._disabled) return;

  const tenant = await knex('tenants').where({ stripe_customer_id: stripeCustomerId }).first('id');
  if (!tenant) return;

  const sub = await loadSubscriptionWithItems(stripe, subscriptionId);
  const { quantity, subscriptionItemId } = getExtraSeatDetailsFromSubscription(sub, extraSeatPriceId);

  await knex('tenants')
    .where({ id: tenant.id })
    .update({
      extra_paid_seats: quantity,
      stripe_extra_seats_subscription_item_id: subscriptionItemId,
      updated_at: knex.fn.now()
    });

  dtLogger.info('[extra-seat-sync] updated tenant extra seats', {
    tenantId: tenant.id,
    quantity,
    subscriptionItemId
  });
}

module.exports = {
  getExtraSeatDetailsFromSubscription,
  loadSubscriptionWithItems,
  syncTenantExtraSeats
};
