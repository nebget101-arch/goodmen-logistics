/**
 * Simple Dynatrace Logger
 * Sends logs and metrics to Dynatrace without requiring OneAgent
 */

const axios = require('axios');
require('dotenv').config();

class DynatraceLogger {
  constructor() {
    this.enabled = process.env.DYNATRACE_ENABLED === 'true';
    this.environmentUrl = process.env.DYNATRACE_ENVIRONMENT_URL;
    this.apiToken = process.env.DYNATRACE_API_TOKEN;
    this.appName = process.env.DYNATRACE_APP_NAME || 'Goodmen-Logistics';
    
    if (this.enabled && (!this.environmentUrl || !this.apiToken || this.apiToken === 'your-api-token-here')) {
      console.warn('⚠️  Dynatrace is enabled but credentials are missing. Logging will be local only.');
      this.enabled = false;
    }
  }

  /**
   * Send custom metric to Dynatrace
   */
  async sendMetric(metricKey, value, dimensions = {}) {
    if (!this.enabled) {
      console.log(`📊 Metric: ${metricKey} = ${value}`, dimensions);
      return;
    }

    try {
      // Build dimension string
      const dimStr = Object.entries(dimensions)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      
      const metricLine = dimStr 
        ? `${metricKey},app="${this.appName}",${dimStr} ${value}`
        : `${metricKey},app="${this.appName}" ${value}`;

      await axios.post(
        `${this.environmentUrl}/api/v2/metrics/ingest`,
        metricLine,
        {
          headers: {
            'Authorization': `Api-Token ${this.apiToken}`,
            'Content-Type': 'text/plain; charset=utf-8'
          }
        }
      );

      console.log(`✅ Sent metric to Dynatrace: ${metricKey} = ${value}`);
    } catch (error) {
      console.error('❌ Failed to send metric to Dynatrace:', error.response?.data || error.message);
    }
  }

  /**
   * Log info message
   */
  info(message, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message,
      app: this.appName,
      ...metadata
    };

    console.log('ℹ️ ', JSON.stringify(logEntry));
    
    if (this.enabled) {
      this.sendMetric('custom.log.info', 1, { message: message.substring(0, 50) });
    }
  }

  /**
   * Log error message
   */
  error(message, error, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message,
      error: error?.message || error,
      stack: error?.stack,
      app: this.appName,
      ...metadata
    };

    console.error('❌', JSON.stringify(logEntry));
    
    if (this.enabled) {
      this.sendMetric('custom.log.error', 1, { message: message.substring(0, 50) });
    }
  }

  /**
   * Log warning message
   */
  warn(message, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      message,
      app: this.appName,
      ...metadata
    };

    console.warn('⚠️ ', JSON.stringify(logEntry));
    
    if (this.enabled) {
      this.sendMetric('custom.log.warn', 1, { message: message.substring(0, 50) });
    }
  }

  /**
   * Track API request
   */
  trackRequest(method, path, statusCode, duration, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'API_REQUEST',
      method,
      path,
      statusCode,
      duration,
      app: this.appName,
      ...metadata
    };

    console.log(`🌐 ${method} ${path} - ${statusCode} (${duration}ms)`);

    if (this.enabled) {
      this.sendMetric('custom.api.request', 1, {
        method,
        path: path.substring(0, 50),
        status: statusCode.toString()
      });
      this.sendMetric('custom.api.duration', duration, { path: path.substring(0, 50) });
    }
  }

  /**
   * Track database query
   */
  trackDatabase(operation, table, duration, success = true, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'DATABASE',
      operation,
      table,
      duration,
      success,
      app: this.appName,
      ...metadata
    };

    console.log(`🗄️  ${operation} ${table} - ${success ? 'Success' : 'Failed'} (${duration}ms)`);

    if (this.enabled) {
      this.sendMetric('custom.db.query', 1, {
        operation,
        table,
        status: success ? 'success' : 'failed'
      });
      this.sendMetric('custom.db.duration', duration, { table });
    }
  }

  /**
   * Track business event
   */
  trackEvent(eventName, eventData = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'BUSINESS_EVENT',
      event: eventName,
      app: this.appName,
      ...eventData
    };

    console.log(`📊 Event: ${eventName}`, eventData);

    if (this.enabled) {
      this.sendMetric(`custom.event.${eventName}`, 1, eventData);
    }
  }
}

// Create singleton instance
const logger = new DynatraceLogger();

module.exports = logger;
