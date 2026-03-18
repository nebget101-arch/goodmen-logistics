'use strict';

const dtLogger = require('../utils/logger');

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  dtLogger.warn('[stripe] STRIPE_SECRET_KEY is not configured. Stripe features are disabled.');
}

const stripe = secretKey
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : {
      _disabled: true,
      webhooks: {
        constructEvent() {
          throw new Error('Stripe is not configured: STRIPE_SECRET_KEY is missing');
        }
      }
    };

module.exports = stripe;
