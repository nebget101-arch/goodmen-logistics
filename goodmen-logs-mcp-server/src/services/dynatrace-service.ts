import axios from 'axios';

export interface DynatraceConfig {
  environmentUrl: string;
  apiToken: string;
}

export class DynatraceService {
  private config: DynatraceConfig;

  constructor(config: DynatraceConfig) {
    this.config = config;
  }

  /**
   * Query logs from Dynatrace
   */
  async queryLogs(options: {
    query?: string;
    from?: string; // ISO timestamp or relative time like 'now-1h'
    to?: string;
    limit?: number;
    sortBy?: 'timestamp' | 'severity';
  }) {
    const { query = '', from = 'now-1h', to = 'now', limit = 100, sortBy = 'timestamp' } = options;

    try {
      const response = await axios.post(
        `${this.config.environmentUrl}/api/v2/logs/search`,
        {
          query: query,
          from: from,
          to: to,
          limit: limit,
          sort: sortBy
        },
        {
          headers: {
            'Authorization': `Api-Token ${this.config.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        logs: response.data.results || [],
        totalCount: response.data.totalCount || 0
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * Get metrics from Dynatrace
   */
  async getMetrics(options: {
    metricSelector: string; // e.g., 'custom.http.request.duration'
    from?: string;
    to?: string;
    resolution?: string; // e.g., '1m', '5m', '1h'
  }) {
    const { metricSelector, from = 'now-1h', to = 'now', resolution = '1m' } = options;

    try {
      const response = await axios.get(
        `${this.config.environmentUrl}/api/v2/metrics/query`,
        {
          params: {
            metricSelector: metricSelector,
            from: from,
            to: to,
            resolution: resolution
          },
          headers: {
            'Authorization': `Api-Token ${this.config.apiToken}`
          }
        }
      );

      return {
        success: true,
        metrics: response.data.result || []
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * List all services being monitored
   */
  async listServices() {
    try {
      const response = await axios.get(
        `${this.config.environmentUrl}/api/v2/entities`,
        {
          params: {
            entitySelector: 'type("SERVICE")',
            fields: '+properties,+tags'
          },
          headers: {
            'Authorization': `Api-Token ${this.config.apiToken}`
          }
        }
      );

      return {
        success: true,
        services: response.data.entities || []
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * Get service details and metrics
   */
  async getServiceDetails(serviceId: string) {
    try {
      const response = await axios.get(
        `${this.config.environmentUrl}/api/v2/entities/${serviceId}`,
        {
          params: {
            fields: '+properties,+tags,+fromRelationships,+toRelationships'
          },
          headers: {
            'Authorization': `Api-Token ${this.config.apiToken}`
          }
        }
      );

      return {
        success: true,
        service: response.data
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * Get problems (alerts/issues)
   */
  async getProblems(options: {
    from?: string;
    to?: string;
    status?: 'OPEN' | 'CLOSED';
    severity?: 'AVAILABILITY' | 'ERROR' | 'PERFORMANCE' | 'RESOURCE_CONTENTION' | 'CUSTOM_ALERT';
  }) {
    const { from = 'now-24h', to = 'now', status, severity } = options;

    try {
      const params: any = {
        from: from,
        to: to
      };

      if (status) params.problemSelector = `status("${status}")`;
      if (severity) params.problemSelector = params.problemSelector 
        ? `${params.problemSelector},severityLevel("${severity}")`
        : `severityLevel("${severity}")`;

      const response = await axios.get(
        `${this.config.environmentUrl}/api/v2/problems`,
        {
          params: params,
          headers: {
            'Authorization': `Api-Token ${this.config.apiToken}`
          }
        }
      );

      return {
        success: true,
        problems: response.data.problems || [],
        totalCount: response.data.totalCount || 0
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * Get events
   */
  async getEvents(options: {
    from?: string;
    to?: string;
    eventType?: string;
  }) {
    const { from = 'now-1h', to = 'now', eventType } = options;

    try {
      const params: any = {
        from: from,
        to: to
      };

      if (eventType) params.eventSelector = `eventType("${eventType}")`;

      const response = await axios.get(
        `${this.config.environmentUrl}/api/v2/events`,
        {
          params: params,
          headers: {
            'Authorization': `Api-Token ${this.config.apiToken}`
          }
        }
      );

      return {
        success: true,
        events: response.data.events || [],
        totalCount: response.data.totalCount || 0
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * Search for specific application logs by service name
   */
  async getServiceLogs(serviceName: string, options: {
    severity?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
    from?: string;
    to?: string;
    limit?: number;
  }) {
    const { severity, from = 'now-1h', to = 'now', limit = 100 } = options;

    let query = `dt.source="${serviceName}"`;
    if (severity) {
      query += ` AND level="${severity}"`;
    }

    return this.queryLogs({
      query: query,
      from: from,
      to: to,
      limit: limit
    });
  }

  /**
   * Get database metrics
   */
  async getDatabaseMetrics(options: {
    from?: string;
    to?: string;
  }) {
    const { from = 'now-1h', to = 'now' } = options;

    const metrics = [
      'custom.database.query.duration',
      'custom.database.pool.total',
      'custom.database.pool.active',
      'custom.database.connections.total'
    ];

    const results: any = {};

    for (const metric of metrics) {
      const data = await this.getMetrics({
        metricSelector: metric,
        from: from,
        to: to
      });
      results[metric] = data;
    }

    return {
      success: true,
      metrics: results
    };
  }
}
