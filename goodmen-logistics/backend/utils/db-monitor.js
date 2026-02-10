/**
 * Database Monitoring for Dynatrace
 * Tracks query performance, connection pool metrics, and errors
 */

const { sendMetric, sendLog, sendEvent } = require('../config/dynatrace-sdk');

/**
 * Wrap database queries with monitoring
 */
function monitorQuery(pool) {
  const originalQuery = pool.query.bind(pool);
  
  pool.query = async function(...args) {
    const startTime = Date.now();
    const queryText = typeof args[0] === 'string' ? args[0] : args[0]?.text || 'unknown';
    const queryType = queryText.trim().split(' ')[0].toUpperCase(); // SELECT, INSERT, UPDATE, DELETE
    
    try {
      const result = await originalQuery(...args);
      const duration = Date.now() - startTime;
      
      // Send query duration metric
      await sendMetric('custom.database.query.duration', duration, {
        queryType: queryType,
        rowCount: result.rowCount || 0
      });
      
      // Log slow queries (> 1 second)
      if (duration > 1000) {
        await sendLog('WARN', 'Slow database query detected', {
          queryType: queryType,
          duration: duration,
          rowCount: result.rowCount,
          query: queryText.substring(0, 200) // First 200 chars
        });
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Log database error
      await sendLog('ERROR', 'Database query failed', {
        queryType: queryType,
        duration: duration,
        error: error.message,
        code: error.code,
        query: queryText.substring(0, 200)
      });
      
      // Send error event
      await sendEvent('ERROR_EVENT', 'Database query failed', {
        queryType: queryType,
        error: error.message,
        code: error.code
      });
      
      throw error;
    }
  };
  
  return pool;
}

/**
 * Track connection pool metrics
 */
async function trackPoolMetrics(pool) {
  try {
    // Get pool stats
    const totalCount = pool.totalCount || 0;
    const idleCount = pool.idleCount || 0;
    const waitingCount = pool.waitingCount || 0;
    
    // Send metrics
    await sendMetric('custom.database.pool.total', totalCount);
    await sendMetric('custom.database.pool.idle', idleCount);
    await sendMetric('custom.database.pool.waiting', waitingCount);
    await sendMetric('custom.database.pool.active', totalCount - idleCount);
    
    // Alert if pool is exhausted
    if (waitingCount > 0) {
      await sendLog('WARN', 'Database connection pool exhausted', {
        total: totalCount,
        idle: idleCount,
        waiting: waitingCount,
        active: totalCount - idleCount
      });
    }
  } catch (error) {
    console.error('[DB Monitor] Failed to track pool metrics:', error.message);
  }
}

/**
 * Get database size and table stats
 */
async function trackDatabaseStats(pool) {
  try {
    // Get database size
    const sizeResult = await pool.query(`
      SELECT pg_database_size(current_database()) as size;
    `);
    const dbSize = parseInt(sizeResult.rows[0]?.size || 0);
    
    await sendMetric('custom.database.size.bytes', dbSize);
    
    // Get table count
    const tableResult = await pool.query(`
      SELECT count(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    const tableCount = parseInt(tableResult.rows[0]?.count || 0);
    
    await sendMetric('custom.database.tables.count', tableCount);
    
    // Get connection count
    const connResult = await pool.query(`
      SELECT count(*) as count FROM pg_stat_activity 
      WHERE datname = current_database();
    `);
    const connectionCount = parseInt(connResult.rows[0]?.count || 0);
    
    await sendMetric('custom.database.connections.total', connectionCount);
    
  } catch (error) {
    console.error('[DB Monitor] Failed to track database stats:', error.message);
  }
}

/**
 * Initialize database monitoring
 */
function initializeDatabaseMonitoring(pool, interval = 60000) {
  // Wrap queries with monitoring
  monitorQuery(pool);
  
  // Track pool metrics every interval (default: 60 seconds)
  setInterval(() => {
    trackPoolMetrics(pool);
  }, interval);
  
  // Track database stats every 5 minutes
  setInterval(() => {
    trackDatabaseStats(pool);
  }, 5 * 60 * 1000);
  
  // Initial metrics
  trackPoolMetrics(pool);
  trackDatabaseStats(pool);
  
  console.log('[DB Monitor] Database monitoring initialized');
}

module.exports = {
  initializeDatabaseMonitoring,
  monitorQuery,
  trackPoolMetrics,
  trackDatabaseStats
};
