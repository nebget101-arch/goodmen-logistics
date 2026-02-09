#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GitHubService } from "./services/github-service.js";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = path.join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

const requiredEnvVars = [
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "GITHUB_REPO",
  "WORKFLOW_FILE",
];

const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  console.error("Missing environment variables:", missingEnvVars.join(", "));
  console.error("Please create a .env file based on .env.example");
  process.exit(1);
}

class GitHubMCPServer {
  private server: Server;
  private githubService: GitHubService;

  constructor() {
    this.server = new Server(
      {
        name: "github-actions-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.githubService = new GitHubService(
      process.env.GITHUB_TOKEN!,
      process.env.GITHUB_OWNER!,
      process.env.GITHUB_REPO!,
      process.env.WORKFLOW_FILE!
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "trigger_cypress_tests",
          description: "Trigger Cypress tests on GitHub Actions for a specific branch",
          inputSchema: {
            type: "object",
            properties: {
              branch: {
                type: "string",
                description: "Branch name to run tests on (default: main)",
                default: "main",
              },
            },
          },
        },
        {
          name: "get_workflow_runs",
          description: "Get recent workflow runs with their status",
          inputSchema: {
            type: "object",
            properties: {
              limit: {
                type: "number",
                description: "Number of recent runs to retrieve (default: 10)",
                default: 10,
              },
              branch: {
                type: "string",
                description: "Filter by branch name (optional)",
              },
            },
          },
        },
        {
          name: "get_workflow_run_details",
          description: "Get detailed information about a specific workflow run",
          inputSchema: {
            type: "object",
            properties: {
              run_id: {
                type: "number",
                description: "Workflow run ID",
              },
            },
            required: ["run_id"],
          },
        },
        {
          name: "get_workflow_run_logs",
          description: "Get logs from a specific workflow run",
          inputSchema: {
            type: "object",
            properties: {
              run_id: {
                type: "number",
                description: "Workflow run ID",
              },
            },
            required: ["run_id"],
          },
        },
        {
          name: "cancel_workflow_run",
          description: "Cancel a running workflow",
          inputSchema: {
            type: "object",
            properties: {
              run_id: {
                type: "number",
                description: "Workflow run ID to cancel",
              },
            },
            required: ["run_id"],
          },
        },
        {
          name: "rerun_workflow",
          description: "Re-run a failed workflow",
          inputSchema: {
            type: "object",
            properties: {
              run_id: {
                type: "number",
                description: "Workflow run ID to re-run",
              },
            },
            required: ["run_id"],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case "trigger_cypress_tests": {
            const branch = (args?.branch as string) || "main";
            const result = await this.githubService.triggerWorkflow(branch);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case "get_workflow_runs": {
            const limit = (args?.limit as number) || 10;
            const branch = args?.branch as string | undefined;
            const result = await this.githubService.getWorkflowRuns(limit, branch);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case "get_workflow_run_details": {
            const runId = args?.run_id as number;
            if (!runId) {
              throw new Error("run_id is required");
            }
            const result = await this.githubService.getWorkflowRunDetails(runId);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case "get_workflow_run_logs": {
            const runId = args?.run_id as number;
            if (!runId) {
              throw new Error("run_id is required");
            }
            const result = await this.githubService.getWorkflowRunLogs(runId);
            return {
              content: [
                {
                  type: "text",
                  text: result,
                },
              ],
            };
          }

          case "cancel_workflow_run": {
            const runId = args?.run_id as number;
            if (!runId) {
              throw new Error("run_id is required");
            }
            const result = await this.githubService.cancelWorkflowRun(runId);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case "rerun_workflow": {
            const runId = args?.run_id as number;
            if (!runId) {
              throw new Error("run_id is required");
            }
            const result = await this.githubService.rerunWorkflow(runId);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
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

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("GitHub Actions MCP Server running on stdio");
  }
}

const server = new GitHubMCPServer();
server.run().catch(console.error);
