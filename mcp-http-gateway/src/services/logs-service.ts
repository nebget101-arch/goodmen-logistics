import axios from "axios";

export interface LogQuery {
  level?: string;
  startDate?: string;
  endDate?: string;
  apiPath?: string;
  limit?: number;
}

export interface DailyReportOptions {
  date: string;
  includeErrors: boolean;
  includeStats: boolean;
}

export class LogsService {
  constructor(private backendPath: string) {}

  /**
   * Fetch logs from the running Goodmen Logistics application
   */
  async fetchLogs(query: LogQuery): Promise<any[]> {
    const logs: any[] = [];
    const baseUrl = this.backendPath?.trim();
    if (!baseUrl) {
      throw new Error("BACKEND_PATH is not configured for LogsService");
    }

    try {
      // First, try to get application logs from the new /api/audit/logs endpoint
      try {
        const appLogsResponse = await axios.get(`${baseUrl}/api/audit/logs`, {
          params: {
            limit: query.limit || 100
          }
        });
        
        if (Array.isArray(appLogsResponse.data) && appLogsResponse.data.length > 0) {
          appLogsResponse.data.forEach((entry: any) => {
            logs.push({
              timestamp: entry.timestamp || new Date().toISOString(),
              level: entry.level || "INFO",
              message: entry.message,
              type: entry.type,
              path: entry.path,
              method: entry.method,
              statusCode: entry.statusCode,
              duration: entry.duration,
              operation: entry.operation,
              table: entry.table,
              error: entry.error,
              stack: entry.stack,
              app: entry.app,
              ...entry
            });
          });
        }
      } catch (appLogError) {
        console.error("Could not fetch application logs, falling back to audit trail:", appLogError);
      }

      // If no application logs, fall back to audit trail
      if (logs.length === 0) {
        const auditResponse = await axios.get(`${baseUrl}/api/audit/trail`);
        const auditLogs = Array.isArray(auditResponse.data) ? auditResponse.data : [];

        auditLogs.forEach((entry: any) => {
          logs.push({
            timestamp: entry.created_at || entry.timestamp || new Date().toISOString(),
            level: "INFO",
            message: `${entry.action || "ACTION"} ${entry.resource || "resource"}`,
            path: entry.resource ? `/api/${String(entry.resource).toLowerCase()}` : undefined,
            resourceId: entry.resource_id || entry.resourceId,
            userId: entry.user_id || entry.userId,
            changes: entry.changes
          });
        });
      }

      // If still no logs, fall back to a health check entry
      if (logs.length === 0) {
        const response = await axios.get(`${baseUrl}/api/health`);
        logs.push({
          timestamp: new Date().toISOString(),
          level: "INFO",
          message: "Health check",
          data: response.data,
        });
      }

      // Apply filters
      let filteredLogs = logs;

      if (query.level && query.level !== "all") {
        filteredLogs = filteredLogs.filter((log) => log.level === query.level);
      }

      if (query.startDate) {
        const start = new Date(query.startDate);
        filteredLogs = filteredLogs.filter((log) => new Date(log.timestamp) >= start);
      }

      if (query.endDate) {
        const end = new Date(query.endDate);
        filteredLogs = filteredLogs.filter((log) => new Date(log.timestamp) <= end);
      }

      if (query.apiPath) {
        filteredLogs = filteredLogs.filter((log) => log.path?.includes(query.apiPath));
      }

      if (query.limit) {
        filteredLogs = filteredLogs.slice(0, query.limit);
      }

      return filteredLogs;
    } catch (error) {
      console.error("Error fetching logs:", error);
      throw new Error(`Failed to fetch logs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a daily report with statistics and highlights
   */
  async generateDailyReport(options: DailyReportOptions): Promise<string> {
    const { date, includeErrors, includeStats } = options;

    let report = `# Daily Log Report - ${date}\n\n`;

    try {
      // Fetch logs for the day
      const logs = await this.fetchLogs({
        startDate: date,
        endDate: date,
        limit: 1000,
      });

      // Generate statistics
      if (includeStats) {
        const totalLogs = logs.length;
        const errorLogs = logs.filter((log) => log.level === "ERROR").length;
        const warnLogs = logs.filter((log) => log.level === "WARN").length;

        report += `## Statistics\n\n`;
        report += `- **Total Logs**: ${totalLogs}\n`;
        report += `- **Errors**: ${errorLogs}\n`;
        report += `- **Warnings**: ${warnLogs}\n`;
        report += `- **Info**: ${totalLogs - errorLogs - warnLogs}\n\n`;

        // API endpoint statistics
        const apiCalls = logs.filter((log) => log.path);
        const uniqueEndpoints = [...new Set(apiCalls.map((log) => log.path))];

        report += `### API Activity\n\n`;
        report += `- **Total API Calls**: ${apiCalls.length}\n`;
        report += `- **Unique Endpoints**: ${uniqueEndpoints.length}\n\n`;

        // Average response time
        const avgResponseTime =
          apiCalls.reduce((sum, log) => sum + (log.duration || 0), 0) / apiCalls.length || 0;
        report += `- **Average Response Time**: ${avgResponseTime.toFixed(2)}ms\n\n`;
      }

      // Include error details
      if (includeErrors) {
        const errors = logs.filter((log) => log.level === "ERROR");
        if (errors.length > 0) {
          report += `## Errors (${errors.length})\n\n`;
          errors.forEach((error, index) => {
            report += `### Error ${index + 1}\n`;
            report += `- **Time**: ${error.timestamp}\n`;
            report += `- **Message**: ${error.message || error.error || "Unknown error"}\n`;
            if (error.stack) {
              report += `\`\`\`\n${error.stack}\n\`\`\`\n`;
            }
            report += `\n`;
          });
        } else {
          report += `## Errors\n\n✅ No errors logged today!\n\n`;
        }
      }

      report += `\n---\n*Generated at ${new Date().toISOString()}*`;

      return report;
    } catch (error) {
      throw new Error(`Failed to generate daily report: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
