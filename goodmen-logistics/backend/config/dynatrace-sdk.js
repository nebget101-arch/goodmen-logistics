// TEST: Send a basic standard metric to Dynatrace to verify integration
async function sendTestMetricLine() {
  if (!config.enabled || !config.apiToken) return;
  // Send a basic metric (standard name)
  const metricLine = 'server.cpu.temperature,cpu.id=0 42';
  console.log('[Dynatrace][DEBUG] Sending test metric line:', metricLine);
  try {
    await axios.post(
      `${config.environmentUrl}/api/v2/metrics/ingest`,
      metricLine,
      {
        headers: {
          'Authorization': `Api-Token ${config.apiToken}`,
          'Content-Type': 'text/plain; charset=utf-8'
        },
        timeout: 5000
      }
    );
    console.log('[Dynatrace][DEBUG] Test metric sent successfully');
  } catch (error) {
    console.error('[Dynatrace][DEBUG] Failed to send test metric:', error.message);
  }
}
/**
 * Dynatrace SDK Configuration
 * Uses OneAgent SDK instead of full OneAgent (no root required)
 */

const axios = require('axios');

const config = {
  enabled: process.env.DYNATRACE_ENABLED === 'true',
  environmentUrl: process.env.DYNATRACE_ENVIRONMENT_URL || '',
  apiToken: process.env.DYNATRACE_API_TOKEN || '',
  appName: process.env.DYNATRACE_APP_NAME || 'SafetyApp-Backend',
  logLevel: process.env.DYNATRACE_LOG_LEVEL || 'info',
  metadata: {
    team: process.env.DYNATRACE_METADATA_TEAM || 'logistics',
    environment: process.env.DYNATRACE_METADATA_ENVIRONMENT || 'production'
  }
};

// Initialize Dynatrace SDK (API-based, no OneAgent package needed)
function initializeDynatrace() {
  if (!config.enabled) {
    console.log('[Dynatrace] Disabled - DYNATRACE_ENABLED not set to true');
    return;
  }

  if (!config.apiToken || !config.environmentUrl) {
    console.warn('[Dynatrace] Missing required configuration (API token or environment URL)');
    return;
  }

  console.log('[Dynatrace] SDK initialized successfully');
  console.log('[Dynatrace] Environment:', config.environmentUrl);
  console.log('[Dynatrace] App Name:', config.appName);
}

// Send custom metrics to Dynatrace
async function sendMetric(metricName, value, dimensions = {}) {
  if (!config.enabled || !config.apiToken) return;

  const metric = {
    name: metricName,
    value: value,
    timestamp: Date.now(),
    dimensions: {
      service: config.appName,
      ...config.metadata,
      ...dimensions
    }
  };

  try {
    // Build dimensions string only if dimensions are present
    let dimStr = '';
    const dimEntries = Object.entries(dimensions);
    if (dimEntries.length > 0) {
      dimStr = ',' + dimEntries.map(([k, v]) => `${k}=${v}`).join(',');
    }
    // Compose metric line according to Dynatrace format
    // metric.name[,dimension=value ...] value [timestamp]
    const metricLine = `${metricName}${dimStr} ${value} ${Date.now()}`;
    console.log('[Dynatrace][DEBUG] Sending metric line:', metricLine);
    await axios.post(
      `${config.environmentUrl}/api/v2/metrics/ingest`,
      metricLine,
      {
        headers: {
          'Authorization': `Api-Token ${config.apiToken}`,
          'Content-Type': 'text/plain; charset=utf-8'
        },
        timeout: 5000
      }
    );
  } catch (error) {
    console.error('[Dynatrace] Failed to send metric:', error.message);
  }
}

// Send logs to Dynatrace
async function sendLog(level, message, metadata = {}) {
  if (!config.enabled || !config.apiToken) return;

  // Check log level filtering
  const levels = ['debug', 'info', 'warn', 'error'];
  const configLevelIndex = levels.indexOf(config.logLevel.toLowerCase());
  const messageLevelIndex = levels.indexOf(level.toLowerCase());
  
  if (messageLevelIndex < configLevelIndex) return;

  const logEntry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    content: message,
    'dt.source': config.appName,
    team: config.metadata.team,
    environment: config.metadata.environment,
    ...metadata
  };

  try {
    await axios.post(
      `${config.environmentUrl}/api/v2/logs/ingest`,
      { logs: [logEntry] },
      {
        headers: {
          'Authorization': `Api-Token ${config.apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );
  } catch (error) {
    console.error('[Dynatrace] Failed to send log:', error.message);
  }
}

// Send custom events to Dynatrace
async function sendEvent(eventType, title, properties = {}) {
  if (!config.enabled || !config.apiToken) return;

  const event = {
    eventType: eventType, // CUSTOM_INFO, CUSTOM_ANNOTATION, ERROR_EVENT, etc.
    title: title,
    properties: {
      service: config.appName,
      ...config.metadata,
      ...properties
    }
  };

  try {
    await axios.post(
      `${config.environmentUrl}/api/v2/events/ingest`,
      event,
      {
        headers: {
          'Authorization': `Api-Token ${config.apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );
  } catch (error) {
    console.error('[Dynatrace] Failed to send event:', error.message);
  }
}

// Express middleware for automatic tracing
function dynatraceMiddleware(req, res, next) {
  if (!config.enabled) return next();

  const startTime = Date.now();
  const correlationId = req.headers['x-correlation-id'] || 
                        req.headers['x-dynatrace-trace-id'] || 
                        `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Add correlation ID to request
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  // Track response
  res.on('finish', async () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Send metric
    await sendMetric('custom.http.request.duration', duration, {
      method: req.method,
      path: req.path,
      statusCode: statusCode
    });

    // Send log for slow requests or errors
    if (duration > 1000 || statusCode >= 400) {
      const level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
      await sendLog(level, `HTTP ${req.method} ${req.path}`, {
        method: req.method,
        path: req.path,
        statusCode: statusCode,
        duration: duration,
        correlationId: correlationId,
        userAgent: req.headers['user-agent']
      });
    }

    // Send error event for 5xx errors
    if (statusCode >= 500) {
      await sendEvent('ERROR_EVENT', `Server error on ${req.method} ${req.path}`, {
        method: req.method,
        path: req.path,
        statusCode: statusCode,
        duration: duration,
        correlationId: correlationId
      });
    }
  });

  next();
}

module.exports = {
  initializeDynatrace,
  dynatraceMiddleware,
  sendMetric,
  sendLog,
  sendEvent,
  isEnabled: () => config.enabled,
  sendTestMetricLine
};
