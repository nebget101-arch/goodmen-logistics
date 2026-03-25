// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.

export const environment = {
  production: false,
  // Local API Gateway (FleetNeuron)
  apiUrl: 'http://localhost:3333/api',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_replace_with_real_key',
  // Stripe publishable key for browser-side Stripe Elements
  stripePublishableKey: 'pk_test_replace_with_real_key'
};
