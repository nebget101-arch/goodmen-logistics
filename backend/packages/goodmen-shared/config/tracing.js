'use strict';

/**
 * Shared OpenTelemetry tracing initializer for FleetNeuron services.
 *
 * Usage (must be the FIRST require in every service entry point):
 *   require('goodmen-shared/config/tracing')({ serviceName: 'fleetneuron-logistics-service' });
 *
 * Environment variables:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  - Self-hosted OTel Collector URL (e.g. https://signoz-otel-collector-fleetneuron.onrender.com)
 *   OTEL_SERVICE_NAME            - Fallback service name (overridden by serviceName param)
 *   NODE_ENV                     - Maps to deployment.environment resource attribute
 *
 * If OTEL_EXPORTER_OTLP_ENDPOINT is not set, tracing is disabled (graceful no-op for local dev).
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT } = require('@opentelemetry/semantic-conventions');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');

/**
 * Initialize OpenTelemetry SDK with auto-instrumentation.
 *
 * @param {Object} options
 * @param {string} options.serviceName - The service name (e.g. 'fleetneuron-logistics-service')
 * @param {string} [options.serviceVersion] - Service version (defaults to '1.0.0')
 */
function initTracing({ serviceName, serviceVersion } = {}) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!endpoint) {
    console.log(`[tracing] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled (${serviceName || 'unknown'})`);
    return;
  }

  const resolvedName = serviceName || process.env.OTEL_SERVICE_NAME || 'fleetneuron-unknown';
  const resolvedVersion = serviceVersion || '1.0.0';
  const environment = process.env.NODE_ENV || 'development';

  // Enable diagnostic logging in development for troubleshooting
  if (environment === 'development') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
  }

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: resolvedName,
    [ATTR_SERVICE_VERSION]: resolvedVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT]: environment,
  });

  // Trace exporter — sends spans to OTel Collector via HTTP/protobuf
  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  });

  // Metric exporter — sends metrics to OTel Collector via HTTP/protobuf
  const metricExporter = new OTLPMetricExporter({
    url: `${endpoint}/v1/metrics`,
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60000, // Export metrics every 60s
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Enable key instrumentations for FleetNeuron
        '@opentelemetry/instrumentation-http': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-express': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-pg': {
          enabled: true,
          enhancedDatabaseReporting: true, // Include SQL query text in spans
        },
        '@opentelemetry/instrumentation-knex': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-dns': {
          enabled: true,
        },
        // Disable noisy instrumentations that add little value
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
        '@opentelemetry/instrumentation-net': {
          enabled: false,
        },
      }),
    ],
  });

  sdk.start();

  console.log(`[tracing] OpenTelemetry initialized for ${resolvedName} → ${endpoint}`);

  // Graceful shutdown — flush pending spans on process exit
  const shutdown = () => {
    sdk.shutdown()
      .then(() => console.log(`[tracing] OpenTelemetry shut down gracefully (${resolvedName})`))
      .catch((err) => console.error(`[tracing] Error shutting down OpenTelemetry:`, err));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = initTracing;
