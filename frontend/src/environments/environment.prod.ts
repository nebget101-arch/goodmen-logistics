// Production: set apiUrl to your API gateway or backend base + /api.
// If the frontend is served from the same host as the gateway, use relative: '/api'
export const environment = {
  production: true,
  apiUrl: 'https://fleetneuron-logistics-gateway.onrender.com/api',
  STRIPE_PUBLISHABLE_KEY: 'pk_live_replace_with_real_key',
  // Stripe publishable key for browser-side Stripe Elements
  stripePublishableKey: 'pk_live_replace_with_real_key'
};
