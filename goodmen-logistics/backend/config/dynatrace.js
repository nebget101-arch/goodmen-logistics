/**
 * Dynatrace Configuration and Integration
 * This module initializes Dynatrace monitoring for the Node.js backend
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.dynatrace.local') });

const dynatraceConfig = {
  enabled: process.env.DYNATRACE_ENABLED === 'true',
  environmentUrl: process.env.DYNATRACE_ENVIRONMENT_URL,
  apiToken: process.env.DYNATRACE_API_TOKEN,
  paasToken: process.env.DYNATRACE_PAAS_TOKEN,
  appName: process.env.DYNATRACE_APP_NAME || 'Goodmen-Logistics-Backend',
  logLevel: process.env.DYNATRACE_LOG_LEVEL || 'info',
  metadata: {
    team: process.env.DYNATRACE_METADATA_TEAM || 'logistics',
    environment: process.env.DYNATRACE_METADATA_ENVIRONMENT || 'development'
  }
};

/**
 * Initialize Dynatrace OneAgent
 * This should be called as early as possible in your application
 * NOTE: OneAgent is optional - we can still log metrics without it
 */
function initializeDynatrace() {
  if (!dynatraceConfig.enabled) {
    console.log('ℹ️  Dynatrace monitoring is disabled');
    return null;
  }

  if (!dynatraceConfig.environmentUrl || !dynatraceConfig.apiToken || dynatraceConfig.apiToken === 'your-api-token-here') {
    console.warn('⚠️  Dynatrace credentials not configured. Using local logging only.');
    return null;
  }

  console.log('✅ Dynatrace logging enabled (API-based)');
  console.log(`📊 Application: ${dynatraceConfig.appName}`);
  console.log(`🌍 Environment: ${dynatraceConfig.metadata.environment}`);
  console.log(`💡 Tip: Logs and metrics will be sent to ${dynatraceConfig.environmentUrl}`);
  
  // Note: OneAgent SDK is optional - we use API-based logging instead
  return { enabled: true, config: dynatraceConfig };
}

/**
 * Create custom middleware for tracking HTTP requests
 * This middleware logs requests without requiring OneAgent SDK
 */
function createDynatraceMiddleware(dynatrace) {
  return (req, res, next) => {
    // Middleware is always present but does nothing - logging is done in route handlers
    next();
  };
}

/**
 * Track custom business metrics
 */
function trackCustomMetric(dynatrace, metricName, value, metadata = {}) {
  if (!dynatrace) return;
  
  try {
    // Log custom metrics
    console.log(`📈 Custom Metric: ${metricName} = ${value}`, metadata);
  } catch (error) {
    console.error('Error tracking custom metric:', error);
  }
}

/**
 * Track database queries
 */
/**
 * Track custom business metrics (simplified for API-based logging)
 */
function trackCustomMetric(dynatrace, metricName, value, metadata = {}) {
  if (!dynatrace) return;
  // Metrics are now tracked via dtLogger in routes
  console.log(`📊 Metric: ${metricName} = ${value}`, metadata);
}

/**
 * Track database queries (simplified for API-based logging)
 */
function trackDatabaseQuery(dynatrace, queryName, duration, success = true) {
  if (!dynatrace) return;
  // Database tracking is now done via dtLogger in routes
  console.log(`🗄️  Database Query: ${queryName} - ${duration}ms - ${success ? 'Success' : 'Failed'}`);
}

module.exports = {
  config: dynatraceConfig,
  initializeDynatrace,
  createDynatraceMiddleware,
  trackCustomMetric,
  trackDatabaseQuery
};
