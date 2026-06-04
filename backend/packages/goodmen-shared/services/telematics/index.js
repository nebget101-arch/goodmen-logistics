'use strict';

/**
 * Telematics adapter registry — FN-1661
 *
 * Resolves a provider code (`samsara`, `motive`) to a singleton adapter
 * instance. Adapters are stateless apart from reading env vars, so one instance
 * per provider is sufficient.
 */

const { TelematicsAdapter } = require('./telematics-adapter');
const { SamsaraAdapter } = require('./samsara-adapter');
const { MotiveAdapter } = require('./motive-adapter');

const ADAPTERS = {
  samsara: new SamsaraAdapter(),
  motive: new MotiveAdapter()
};

/** List of supported provider codes. */
const SUPPORTED_PROVIDERS = Object.keys(ADAPTERS);

/**
 * Return the adapter for a provider code (case-insensitive), or null when the
 * provider is unknown.
 */
function getAdapter(provider) {
  if (!provider) return null;
  return ADAPTERS[provider.toString().trim().toLowerCase()] || null;
}

module.exports = {
  TelematicsAdapter,
  SamsaraAdapter,
  MotiveAdapter,
  getAdapter,
  SUPPORTED_PROVIDERS
};
