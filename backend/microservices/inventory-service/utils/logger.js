/**
 * Simple application logger with in-memory buffer.
 * No external monitoring dependencies.
 */

class AppLogger {
  constructor() {
    this.appName = process.env.APP_NAME || 'Goodmen-Logistics';
    this.logBuffer = [];
    this.maxBufferSize = 500;
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
   * Send custom metric
   */
  sendMetric(metricKey, value, dimensions = {}) {
    console.log(`📊 Metric: ${metricKey} = ${value}`, dimensions);
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

    this.addToBuffer(logEntry);
    console.log(`🌐 ${method} ${path} - ${statusCode} (${duration}ms)`);
  }

  /**
   * Track database query
   */
  trackDatabase(operation, table, duration, success = true, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'DATABASE',
      level: success ? 'INFO' : 'ERROR',
      operation,
      table,
      duration,
      success,
      message: `${operation} ${table} - ${success ? 'Success' : 'Failed'} (${duration}ms)`,
      app: this.appName,
      ...metadata
    };

    this.addToBuffer(logEntry);
    console.log(`🗄️  ${operation} ${table} - ${success ? 'Success' : 'Failed'} (${duration}ms)`);
  }

  /**
   * Track business event
   */
  trackEvent(eventName, eventData = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'BUSINESS_EVENT',
      level: 'INFO',
      event: eventName,
      message: `Event: ${eventName}`,
      app: this.appName,
      ...eventData
    };

    this.addToBuffer(logEntry);
    console.log(`📊 Event: ${eventName}`, eventData);
  }
}

// Create singleton instance
const logger = new AppLogger();

module.exports = logger;
