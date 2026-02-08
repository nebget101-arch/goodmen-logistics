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
    const baseUrl = this.backendPath || "http://localhost:3000";

    try {
      // Use the audit trail as the primary log source
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

      // If no audit logs exist, fall back to a health check entry
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
