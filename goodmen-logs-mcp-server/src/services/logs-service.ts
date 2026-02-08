import { exec } from "child_process";
import { promisify } from "util";
import axios from "axios";

const execAsync = promisify(exec);

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
   * This assumes the backend is running on localhost:3000
   */
  async fetchLogs(query: LogQuery): Promise<any[]> {
    // If the backend exposes a logs endpoint, we can query it
    // For now, we'll demonstrate with a health check
    
    const logs: any[] = [];

    try {
      // Example: Query the backend's health endpoint
      const response = await axios.get("http://localhost:3000/api/health");
      logs.push({
        timestamp: new Date().toISOString(),
        level: "INFO",
        message: "Health check",
        data: response.data,
      });

      // In a real implementation, you would:
      // 1. Read from log files in the backend directory
      // 2. Query a logging database
      // 3. Use the backend's log API if available
      // 4. Parse terminal output or Docker logs

      // For demonstration, let's simulate reading recent API logs
      logs.push(
        {
          timestamp: new Date().toISOString(),
          level: "INFO",
          path: "/api/drivers",
          method: "GET",
          status: 200,
          duration: 19,
        },
        {
          timestamp: new Date().toISOString(),
          level: "INFO",
          path: "/api/vehicles",
          method: "GET",
          status: 200,
          duration: 8,
        }
      );

      // Apply filters
      let filteredLogs = logs;

      if (query.level && query.level !== "all") {
        filteredLogs = filteredLogs.filter((log) => log.level === query.level);
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
