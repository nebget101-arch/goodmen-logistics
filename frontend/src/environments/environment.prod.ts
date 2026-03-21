// Host-aware runtime API routing to avoid cross-environment CORS mismatches.
// - dev.fleetneuron.ai -> dev gateway
// - fleetneuron.ai (and others) -> prod gateway
const host = typeof window !== 'undefined' ? window.location.hostname : '';
const isDevHost = host === 'dev.fleetneuron.ai';

export const environment = {
  production: true,
  apiUrl: isDevHost
    ? 'https://fleetneuron-logistics-gateway-dev.onrender.com/api'
    : 'https://fleetneuron-logistics-gateway.onrender.com/api',
  STRIPE_PUBLISHABLE_KEY: 'pk_live_replace_with_real_key',
  // Stripe publishable key for browser-side Stripe Elements
  stripePublishableKey: 'pk_live_replace_with_real_key'
};
