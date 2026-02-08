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
    
    // In-memory log buffer to store recent logs (last 500 entries)
    this.logBuffer = [];
    this.maxBufferSize = 500;
    
    if (this.enabled && (!this.environmentUrl || !this.apiToken || this.apiToken === 'your-api-token-here')) {
      console.warn('⚠️  Dynatrace is enabled but credentials are missing. Logging will be local only.');
      this.enabled = false;
    }
  }
  
  /**
   * Add log entry to buffer
   */
  addToBuffer(logEntry) {
    this.logBuffer.push(logEntry);
    
    // Keep buffer size limited
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift(); // Remove oldest entry
    }
  }
  
  /**
   * Get recent logs from buffer
   */
  getRecentLogs(limit = 100) {
    return this.logBuffer.slice(-limit).reverse(); // Return most recent first
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

    this.addToBuffer(logEntry);
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

    this.addToBuffer(logEntry);
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
this.addToBuffer(logEntry);
    
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
      level: statusCode >= 400 ? 'ERROR' : 'INFO',
      method,
      path,
      statusCode,
      duration,
      message: `${method} ${path} - ${statusCode} (${duration}ms)`,
      app: this.appName,
      ...metadata
    };

    this.addToBuffer(logEntry);    };

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
  traclevel: success ? 'INFO' : 'ERROR',
      operation,
      table,
      duration,
      success,
      message: `${operation} ${table} - ${success ? 'Success' : 'Failed'} (${duration}ms)`,
      app: this.appName,
      ...metadata
    };

    this.addToBuffer(logEntry);      success,
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
   * Tlevel: 'INFO',
      event: eventName,
      message: `Event: ${eventName}`,
      app: this.appName,
      ...eventData
    };

    this.addToBuffer(logEntry);      timestamp: new Date().toISOString(),
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
