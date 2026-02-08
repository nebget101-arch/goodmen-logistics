#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { LogsService } from "./services/logs-service.js";
import { ConfluenceService } from "./services/confluence-service.js";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from the parent directory (where .env is located)
// Don't override existing environment variables from Claude Desktop
const envPath = path.join(__dirname, "..", ".env");
const requiredEnvVars = [
  "BACKEND_PATH",
  "CONFLUENCE_BASE_URL",
  "CONFLUENCE_EMAIL",
  "CONFLUENCE_API_TOKEN",
  "CONFLUENCE_SPACE_KEY",
];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  console.error("Loading .env from:", envPath);
  console.error("Missing env vars:", missingEnvVars.join(", "));
  dotenv.config({ path: envPath, override: false });
} else {
  console.error("Env vars already set; skipping .env load.");
}

// Debug: Log environment variables to stderr (visible in Claude Desktop logs)
console.error("=== Environment Variables Debug ===");
console.error("CONFLUENCE_BASE_URL:", process.env.CONFLUENCE_BASE_URL);
console.error("CONFLUENCE_EMAIL:", process.env.CONFLUENCE_EMAIL);
console.error("CONFLUENCE_SPACE_KEY:", process.env.CONFLUENCE_SPACE_KEY);
console.error("BACKEND_PATH:", process.env.BACKEND_PATH);
console.error("===================================");

class GoodmenLogsMCPServer {
  private server: Server;
  private logsService: LogsService;
  private confluenceService: ConfluenceService;
  private runningTests: Map<string, { process: any; testType: string; startTime: Date }>;

  constructor() {
    this.runningTests = new Map();
    this.server = new Server(
      {
        name: "goodmen-logs-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.logsService = new LogsService(process.env.BACKEND_PATH || "");
    this.confluenceService = new ConfluenceService({
      baseUrl: process.env.CONFLUENCE_BASE_URL || "",
      email: process.env.CONFLUENCE_EMAIL || "",
      apiToken: process.env.CONFLUENCE_API_TOKEN || "",
      spaceKey: process.env.CONFLUENCE_SPACE_KEY || "",
    });

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_app_logs",
          description:
            "Fetch application logs from Goodmen Logistics backend. Can filter by date, log level, or API endpoint.",
          inputSchema: {
            type: "object",
            properties: {
              level: {
                type: "string",
                description: "Filter by log level (INFO, ERROR, WARN)",
                enum: ["INFO", "ERROR", "WARN", "all"],
              },
              startDate: {
                type: "string",
                description: "Start date for logs (YYYY-MM-DD)",
              },
              endDate: {
                type: "string",
                description: "End date for logs (YYYY-MM-DD)",
              },
              apiPath: {
                type: "string",
                description: "Filter by API path (e.g., /api/drivers)",
              },
              limit: {
                type: "number",
                description: "Maximum number of log entries to return",
                default: 100,
              },
            },
          },
        },
        {
          name: "post_logs_to_confluence",
          description:
            "Post formatted log summary to a Confluence page. Can create new page or update existing one.",
          inputSchema: {
            type: "object",
            properties: {
              pageTitle: {
                type: "string",
                description: "Title for the Confluence page",
              },
              logs: {
                type: "string",
                description: "Log data to post (JSON string or formatted text)",
              },
              pageId: {
                type: "string",
                description: "Optional: Existing page ID to update instead of creating new",
              },
              parentPageId: {
                type: "string",
                description: "Optional: Parent page ID for new pages",
              },
            },
            required: ["pageTitle", "logs"],
          },
        },
        {
          name: "create_daily_log_report",
          description:
            "Generate and post a daily log report to Confluence with statistics and highlights",
          inputSchema: {
            type: "object",
            properties: {
              date: {
                type: "string",
                description: "Date for the report (YYYY-MM-DD), defaults to today",
              },
              includeErrors: {
                type: "boolean",
                description: "Include detailed error logs",
                default: true,
              },
              includeStats: {
                type: "boolean",
                description: "Include statistics (API call counts, response times)",
                default: true,
              },
            },
          },
        },
        {
          name: "run_performance_tests",
          description:
            "Run K6 performance tests and post results to Confluence. Supports smoke, load, stress, spike, and soak tests. Long tests (load/stress/soak) run in background automatically.",
          inputSchema: {
            type: "object",
            properties: {
              testType: {
                type: "string",
                description: "Type of performance test to run",
                enum: ["smoke", "load", "stress", "spike", "soak", "all"],
                default: "smoke",
              },
              background: {
                type: "boolean",
                description: "Force background execution (auto-enabled for long tests)",
              },
              postToConfluence: {
                type: "boolean",
                description: "Automatically post results to Confluence",
                default: true,
              },
              confluencePageTitle: {
                type: "string",
                description: "Title for the Confluence page (auto-generated if not provided)",
              },
            },
          },
        },
        {
          name: "stop_performance_test",
          description:
            "Stop a running background performance test by test ID or type.",
          inputSchema: {
            type: "object",
            properties: {
              testId: {
                type: "string",
                description: "Test ID to stop (from run_performance_tests response)",
              },
              testType: {
                type: "string",
                description: "Or stop by test type if testId not provided",
                enum: ["smoke", "load", "stress", "spike", "soak"],
              },
            },
          },
        },
        {
          name: "get_test_status",
          description:
            "Check status of running performance tests.",
          inputSchema: {
            type: "object",
            properties: {
              testId: {
                type: "string",
                description: "Optional test ID to check specific test status",
              },
            },
          },
        },
        {
          name: "get_performance_test_results",
          description:
            "Retrieve and display results from previous performance test executions. Shows detailed metrics, pass/fail status, and recommendations.",
          inputSchema: {
            type: "object",
            properties: {
              testType: {
                type: "string",
                description: "Specific test type to retrieve (smoke, load, stress, spike, soak). If not provided, shows consolidated results.",
                enum: ["smoke", "load", "stress", "spike", "soak", "all"],
              },
              format: {
                type: "string",
                description: "Output format: 'summary' for key metrics, 'detailed' for full report",
                enum: ["summary", "detailed"],
                default: "summary",
              },
            },
          },
        },
        {
          name: "post_html_report_to_confluence",
          description:
            "Generate HTML performance report and post it to Confluence. Creates a beautiful, interactive report with charts and tables.",
          inputSchema: {
            type: "object",
            properties: {
              pageTitle: {
                type: "string",
                description: "Title for the Confluence page (default: auto-generated with date)",
              },
              testType: {
                type: "string",
                description: "Specific test type or 'all' for consolidated report",
                enum: ["smoke", "load", "stress", "spike", "soak", "all"],
                default: "all",
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case "get_app_logs": {
            const logs = await this.logsService.fetchLogs({
              level: args?.level as string,
              startDate: args?.startDate as string,
              endDate: args?.endDate as string,
              apiPath: args?.apiPath as string,
              limit: args?.limit as number,
            });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(logs, null, 2),
                },
              ],
            };
          }

          case "post_logs_to_confluence": {
            const result = await this.confluenceService.postLogs({
              pageTitle: args?.pageTitle as string,
              logs: args?.logs as string,
              pageId: args?.pageId as string,
              parentPageId: args?.parentPageId as string,
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Successfully posted to Confluence!\nPage ID: ${result.id}\nURL: ${result.url}`,
                },
              ],
            };
          }

          case "create_daily_log_report": {
            const date = args?.date as string || new Date().toISOString().split('T')[0];
            const report = await this.logsService.generateDailyReport({
              date,
              includeErrors: args?.includeErrors !== false,
              includeStats: args?.includeStats !== false,
            });

            const confluenceResult = await this.confluenceService.postLogs({
              pageTitle: `Daily Log Report - ${date}`,
              logs: report,
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Daily report created for ${date}\nPage URL: ${confluenceResult.url}`,
                },
              ],
            };
          }

          case "run_performance_tests": {
            const { exec, execSync } = await import('child_process');
            const fs = await import('fs');
            const path = await import('path');
            
            const testType = args?.testType as string || 'smoke';
            const runInBackground = args?.background === true || ['load', 'stress', 'soak'].includes(testType);
            const postToConfluence = args?.postToConfluence !== false;
            const testDir = '/Users/nebyougetaneh/Desktop/SafetyApp/k6-performance-tests';
            const testId = `${testType}-${Date.now()}`;
            
            try {
              const testCommand = testType === 'all' 
                ? `cd ${testDir} && ./scripts/run-all-tests.sh`
                : `cd ${testDir} && k6 run tests/${testType}.test.js`;
              
              // Run in background for long tests
              if (runInBackground) {
                console.error(`Starting ${testType} performance test in background...`);
                
                const childProcess = exec(testCommand, (error, stdout, stderr) => {
                  this.runningTests.delete(testId);
                  
                  if (error) {
                    console.error(`Test ${testId} failed:`, error);
                    return;
                  }
                  
                  // Generate report after test completes
                  execSync(`cd ${testDir} && node scripts/generate-report.js`);
                  
                  // Auto-post to Confluence if requested
                  if (postToConfluence) {
                    const reportPath = path.join(testDir, 'reports', 'confluence-report.md');
                    const reportContent = fs.readFileSync(reportPath, 'utf-8');
                    const pageTitle = args?.confluencePageTitle as string || 
                      `Performance Test Report - ${testType} - ${new Date().toISOString().split('T')[0]}`;
                    
                    this.confluenceService.postLogs({ pageTitle, logs: reportContent })
                      .then(result => console.error(`✅ Results posted to Confluence: ${result.url}`))
                      .catch(err => console.error(`Failed to post to Confluence:`, err));
                  }
                  
                  console.error(`Test ${testId} completed successfully!`);
                });
                
                this.runningTests.set(testId, {
                  process: childProcess,
                  testType,
                  startTime: new Date(),
                });
                
                return {
                  content: [
                    {
                      type: "text",
                      text: `🚀 ${testType} test started in background\n\nTest ID: ${testId}\nUse 'get_test_status' to check progress\nUse 'stop_performance_test' with testId "${testId}" to stop\n\nThis test will run for approximately ${this.getTestDuration(testType)}.`,
                    },
                  ],
                };
              }
              
              // Run synchronously for quick tests
              console.error(`Running ${testType} performance test...`);
              execSync(testCommand, { stdio: 'inherit' });
              execSync(`cd ${testDir} && node scripts/generate-report.js`, { stdio: 'inherit' });
              
              const reportPath = path.join(testDir, 'reports', 'confluence-report.md');
              const reportContent = fs.readFileSync(reportPath, 'utf-8');
              
              let resultText = `Performance test(s) completed successfully!\n\n`;
              
              if (postToConfluence) {
                const pageTitle = args?.confluencePageTitle as string || 
                  `Performance Test Report - ${new Date().toISOString().split('T')[0]}`;
                
                const confluenceResult = await this.confluenceService.postLogs({
                  pageTitle,
                  logs: reportContent,
                });
                
                resultText += `✅ Results posted to Confluence!\nPage URL: ${confluenceResult.url}`;
              } else {
                resultText += `Report generated at: ${reportPath}`;
              }
              
              return {
                content: [
                  {
                    type: "text",
                    text: resultText,
                  },
                ],
              };
            } catch (error: any) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error running performance tests: ${error.message}`,
                  },
                ],
                isError: true,
              };
            }
          }

          case "stop_performance_test": {
            const testId = args?.testId as string;
            const testType = args?.testType as string;
            
            try {
              let targetTestId = testId;
              
              // If no testId, find by testType
              if (!targetTestId && testType) {
                for (const [id, info] of this.runningTests.entries()) {
                  if (info.testType === testType) {
                    targetTestId = id;
                    break;
                  }
                }
              }
              
              if (!targetTestId) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `No running test found${testType ? ` for type: ${testType}` : ''}`,
                    },
                  ],
                };
              }
              
              const testInfo = this.runningTests.get(targetTestId);
              if (!testInfo) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Test ${targetTestId} not found or already completed`,
                    },
                  ],
                };
              }
              
              // Kill the process
              testInfo.process.kill('SIGTERM');
              this.runningTests.delete(targetTestId);
              
              return {
                content: [
                  {
                    type: "text",
                    text: `✅ Stopped test: ${targetTestId} (${testInfo.testType})`,
                  },
                ],
              };
            } catch (error: any) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error stopping test: ${error.message}`,
                  },
                ],
                isError: true,
              };
            }
          }

          case "get_test_status": {
            const testId = args?.testId as string;
            
            try {
              if (testId) {
                const testInfo = this.runningTests.get(testId);
                if (!testInfo) {
                  return {
                    content: [
                      {
                        type: "text",
                        text: `Test ${testId} not found or already completed`,
                      },
                    ],
                  };
                }
                
                const duration = Math.floor((Date.now() - testInfo.startTime.getTime()) / 1000);
                return {
                  content: [
                    {
                      type: "text",
                      text: `Test Status:\nID: ${testId}\nType: ${testInfo.testType}\nRunning for: ${duration}s\nExpected duration: ${this.getTestDuration(testInfo.testType)}`,
                    },
                  ],
                };
              }
              
              // List all running tests
              if (this.runningTests.size === 0) {
                return {
                  content: [
                    {
                      type: "text",
                      text: "No tests currently running",
                    },
                  ],
                };
              }
              
              const statusLines = ["Running Tests:"];
              for (const [id, info] of this.runningTests.entries()) {
                const duration = Math.floor((Date.now() - info.startTime.getTime()) / 1000);
                statusLines.push(`\n- ${id}`);
                statusLines.push(`  Type: ${info.testType}`);
                statusLines.push(`  Running for: ${duration}s`);
                statusLines.push(`  Expected: ${this.getTestDuration(info.testType)}`);
              }
              
              return {
                content: [
                  {
                    type: "text",
                    text: statusLines.join('\n'),
                  },
                ],
              };
            } catch (error: any) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error getting test status: ${error.message}`,
                  },
                ],
                isError: true,
              };
            }
          }

          case "get_performance_test_results": {
            const fs = await import('fs');
            const path = await import('path');
            
            const testType = args?.testType as string;
            const format = args?.format as string || 'summary';
            const testDir = '/Users/nebyougetaneh/Desktop/SafetyApp/k6-performance-tests';
            
            try {
              // Read consolidated report
              const consolidatedPath = path.join(testDir, 'reports', 'consolidated-report.json');
              
              if (!fs.existsSync(consolidatedPath)) {
                return {
                  content: [
                    {
                      type: "text",
                      text: "No test results found. Run a performance test first using 'run_performance_tests'.",
                    },
                  ],
                };
              }
              
              const reportData = JSON.parse(fs.readFileSync(consolidatedPath, 'utf-8'));
              const timestamp = new Date(reportData.generatedAt).toLocaleString();
              
              // If specific test type requested
              if (testType && testType !== 'all') {
                const testData = reportData.tests[testType];
                if (!testData) {
                  return {
                    content: [
                      {
                        type: "text",
                        text: `No results found for ${testType} test. Available tests: ${Object.keys(reportData.tests).filter(k => reportData.tests[k]).join(', ')}`,
                      },
                    ],
                  };
                }
                
                return {
                  content: [
                    {
                      type: "text",
                      text: this.formatTestResults(testType, testData, timestamp, format),
                    },
                  ],
                };
              }
              
              // Return consolidated results
              return {
                content: [
                  {
                    type: "text",
                    text: this.formatConsolidatedResults(reportData, format),
                  },
                ],
              };
            } catch (error: any) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error retrieving test results: ${error.message}`,
                  },
                ],
                isError: true,
              };
            }
          }

          case "post_html_report_to_confluence": {
            const testType = (args?.testType as string) || 'all';
            const pageTitle = args?.pageTitle as string || 
              `Performance Test Report - ${new Date().toISOString().split('T')[0]}`;
            
            try {
              const testDir = path.join(__dirname, '..', '..', 'k6-performance-tests');
              
              // Generate Confluence-optimized HTML report
              console.error('Generating Confluence-compatible HTML report...');
              execSync(`cd ${testDir} && node scripts/generate-confluence-html.js`, { stdio: 'inherit' });
              
              // Read the generated Confluence HTML report
              const htmlReportPath = path.join(testDir, 'reports', 'confluence-report.html');
              
              if (!fs.existsSync(htmlReportPath)) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `HTML report not found. Please run performance tests first to generate results.`,
                    },
                  ],
                  isError: true,
                };
              }
              
              const htmlContent = fs.readFileSync(htmlReportPath, 'utf-8');
              
              // Post to Confluence
              const confluenceResult = await this.confluenceService.postLogs({
                pageTitle,
                logs: htmlContent,
              });
              
              return {
                content: [
                  {
                    type: "text",
                    text: `✅ HTML Performance Report posted to Confluence!\n\nPage Title: ${pageTitle}\nPage URL: ${confluenceResult.url}\n\nThe report includes:\n- Color-coded status indicators\n- Success rate progress bars\n- Detailed metrics tables\n- Performance recommendations\n- Confluence-optimized formatting`,
                  },
                ],
              };
            } catch (error: any) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Error posting HTML report to Confluence: ${error.message}`,
                  },
                ],
                isError: true,
              };
            }
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private getTestDuration(testType: string): string {
    const durations: { [key: string]: string } = {
      smoke: '30 seconds',
      load: '20 minutes',
      stress: '30 minutes',
      spike: '7 minutes',
      soak: '1+ hours',
      all: '1+ hours',
    };
    return durations[testType] || 'unknown';
  }

  private formatTestResults(testType: string, testData: any, timestamp: string, format: string): string {
    const metrics = testData.metrics;
    const totalRequests = metrics?.http_reqs?.values?.count || 0;
    const failedRequests = metrics?.http_req_failed?.values?.passes || 0;
    const errorRate = metrics?.http_req_failed?.values?.rate ? (metrics.http_req_failed.values.rate * 100).toFixed(2) : '0.00';
    const avgDuration = metrics?.http_req_duration?.values?.avg?.toFixed(2) || 'N/A';
    const p95Duration = metrics?.http_req_duration?.values?.['p(95)']?.toFixed(2) || 'N/A';
    const p99Duration = metrics?.http_req_duration?.values?.['p(99)']?.toFixed(2) || 'N/A';
    const minDuration = metrics?.http_req_duration?.values?.min?.toFixed(2) || 'N/A';
    const maxDuration = metrics?.http_req_duration?.values?.max?.toFixed(2) || 'N/A';
    const medDuration = metrics?.http_req_duration?.values?.med?.toFixed(2) || 'N/A';
    const checksPass = metrics?.checks?.values?.passes || 0;
    const checksFail = metrics?.checks?.values?.fails || 0;
    const throughput = metrics?.http_reqs?.values?.rate?.toFixed(2) || 'N/A';
    const duration = testData.state?.testRunDurationMs ? (testData.state.testRunDurationMs / 1000).toFixed(1) : 'N/A';
    
    const status = failedRequests === 0 && checksFail === 0 ? '✅ PASSED' : '❌ FAILED';
    
    if (format === 'detailed') {
      let result = `## ${testType.toUpperCase()} Test Results\n\n`;
      result += `**Generated:** ${timestamp}\n`;
      result += `**Status:** ${status}\n`;
      result += `**Duration:** ${duration}s\n\n`;
      result += `### Key Metrics\n\n`;
      result += `| Metric | Value |\n|--------|-------|\n`;
      result += `| Total Requests | ${totalRequests} |\n`;
      result += `| Failed Requests | ${failedRequests} |\n`;
      result += `| Error Rate | ${errorRate}% |\n`;
      result += `| Avg Response Time | ${avgDuration}ms |\n`;
      result += `| Min Response Time | ${minDuration}ms |\n`;
      result += `| Max Response Time | ${maxDuration}ms |\n`;
      result += `| P50 (Median) | ${medDuration}ms |\n`;
      result += `| P95 Response Time | ${p95Duration}ms |\n`;
      result += `| P99 Response Time | ${p99Duration}ms |\n`;
      result += `| Throughput | ${throughput} req/s |\n`;
      result += `| Checks Passed | ${checksPass}/${checksPass + checksFail} |\n\n`;
      
      if (testData.root_group?.groups) {
        result += `### Endpoint Results\n\n`;
        for (const group of testData.root_group.groups) {
          result += `**${group.name}**\n`;
          if (group.checks) {
            for (const check of group.checks) {
              const checkStatus = check.fails === 0 ? '✅' : '❌';
              result += `- ${checkStatus} ${check.name}: ${check.passes}/${check.passes + check.fails}\n`;
            }
          }
          result += `\n`;
        }
      }
      
      return result;
    }
    
    // Summary format
    let result = `## ${testType.toUpperCase()} Test - ${status}\n\n`;
    result += `**Timestamp:** ${timestamp}\n`;
    result += `**Duration:** ${duration}s\n\n`;
    result += `**Performance:**\n`;
    result += `- Total Requests: ${totalRequests}\n`;
    result += `- Failed: ${failedRequests} (${errorRate}%)\n`;
    result += `- Avg Response: ${avgDuration}ms\n`;
    result += `- P95 Response: ${p95Duration}ms\n`;
    result += `- Checks: ${checksPass}/${checksPass + checksFail} passed\n`;
    
    return result;
  }

  private formatConsolidatedResults(reportData: any, format: string): string {
    const timestamp = new Date(reportData.generatedAt).toLocaleString();
    const testsRun = reportData.summary.testsRun;
    const overallStatus = reportData.summary.overallStatus;
    
    let result = `# Performance Test Results\n\n`;
    result += `**Generated:** ${timestamp}\n`;
    result += `**Overall Status:** ${overallStatus}\n`;
    result += `**Tests Run:** ${testsRun}\n\n`;
    
    // List available test results
    const availableTests = Object.entries(reportData.tests)
      .filter(([_, data]) => data !== null)
      .map(([name, _]) => name);
    
    result += `**Available Results:** ${availableTests.join(', ')}\n\n`;
    
    // Show summary for each test
    for (const testType of availableTests) {
      const testData = reportData.tests[testType];
      if (!testData) continue;
      
      const metrics = testData.metrics;
      const totalRequests = metrics?.http_reqs?.values?.count || 0;
      const failedRequests = metrics?.http_req_failed?.values?.passes || 0;
      const avgDuration = metrics?.http_req_duration?.values?.avg?.toFixed(2) || 'N/A';
      const p95Duration = metrics?.http_req_duration?.values?.['p(95)']?.toFixed(2) || 'N/A';
      const checksPass = metrics?.checks?.values?.passes || 0;
      const checksFail = metrics?.checks?.values?.fails || 0;
      
      const status = failedRequests === 0 && checksFail === 0 ? '✅' : '❌';
      
      result += `### ${status} ${testType.toUpperCase()}\n`;
      result += `- Requests: ${totalRequests} (${failedRequests} failed)\n`;
      result += `- Avg: ${avgDuration}ms | P95: ${p95Duration}ms\n`;
      result += `- Checks: ${checksPass}/${checksPass + checksFail}\n\n`;
    }
    
    // Recommendations
    if (reportData.recommendations && reportData.recommendations.length > 0) {
      result += `## Recommendations\n\n`;
      for (const rec of reportData.recommendations) {
        result += `**${rec.priority}:** ${rec.issue}\n`;
        result += `> ${rec.recommendation}\n\n`;
      }
    }
    
    return result;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Goodmen Logs MCP server running on stdio");
  }
}

async function main() {
  const server = new GoodmenLogsMCPServer();
  await server.run();
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
