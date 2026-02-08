#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Request, Response } from "express";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { LogsService } from "./services/logs-service.js";
import { ConfluenceService } from "./services/confluence-service.js";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from the parent directory (where .env is located)
// Don't override existing environment variables from Claude Desktop
const envPath = path.join(__dirname, '..', '.env');
console.error("Loading .env from:", envPath);
dotenv.config({ path: envPath, override: false });

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

  constructor() {
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

  async runWithTransport(transport: StreamableHTTPServerTransport) {
    await this.server.connect(transport);
  }

  async close() {
    await this.server.close();
  }
}

const app = createMcpExpressApp();

app.post("/mcp", async (req: Request, res: Response) => {
  const server = new GoodmenLogsMCPServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    await server.runWithTransport(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close().catch(() => undefined);
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    }
  }
});

app.get("/mcp", async (_req: Request, res: Response) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

app.delete("/mcp", async (_req: Request, res: Response) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, (error: unknown) => {
  if (error) {
    console.error("Failed to start MCP server:", error);
    process.exit(1);
  }
  console.error(`Goodmen Logs MCP server listening on port ${PORT}`);
});
