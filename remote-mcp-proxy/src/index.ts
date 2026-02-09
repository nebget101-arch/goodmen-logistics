#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

const REMOTE_API_URL = process.env.REMOTE_API_URL || 'https://mcp-http-gateway-867b.onrender.com';

class RemoteMCPProxy {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'remote-mcp-proxy',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    // List all available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // GitHub Actions Tools
        {
          name: 'trigger_github_workflow',
          description: 'Trigger a GitHub Actions workflow (Cypress tests or K6 performance tests)',
          inputSchema: {
            type: 'object',
            properties: {
              branch: {
                type: 'string',
                description: 'Branch to run the workflow on',
                default: 'main'
              },
              workflow: {
                type: 'string',
                description: 'Workflow file to trigger (test-and-deploy.yml or k6-performance-tests.yml)',
                enum: ['test-and-deploy.yml', 'k6-performance-tests.yml']
              },
              inputs: {
                type: 'object',
                description: 'Workflow inputs (e.g., {test_type: "smoke"} for K6)',
                properties: {
                  test_type: {
                    type: 'string',
                    description: 'Type of K6 test (smoke, load, stress, spike, soak, all)',
                    enum: ['smoke', 'load', 'stress', 'spike', 'soak', 'all']
                  }
                }
              }
            }
          }
        },
        {
          name: 'trigger_cypress_tests',
          description: 'Trigger Cypress E2E tests workflow',
          inputSchema: {
            type: 'object',
            properties: {
              branch: {
                type: 'string',
                description: 'Branch to test',
                default: 'main'
              }
            }
          }
        },
        {
          name: 'trigger_k6_tests',
          description: 'Trigger K6 performance tests with specific test type',
          inputSchema: {
            type: 'object',
            properties: {
              branch: {
                type: 'string',
                description: 'Branch to test',
                default: 'main'
              },
              test_type: {
                type: 'string',
                description: 'Type of performance test to run',
                enum: ['smoke', 'load', 'stress', 'spike', 'soak', 'all'],
                default: 'smoke'
              }
            }
          }
        },
        {
          name: 'get_workflow_runs',
          description: 'Get recent workflow runs',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Number of runs to retrieve',
                default: 10
              },
              branch: {
                type: 'string',
                description: 'Filter by branch'
              },
              workflow: {
                type: 'string',
                description: 'Filter by workflow file'
              }
            }
          }
        },
        {
          name: 'get_workflow_run_details',
          description: 'Get details of a specific workflow run',
          inputSchema: {
            type: 'object',
            properties: {
              runId: {
                type: 'number',
                description: 'Workflow run ID'
              }
            },
            required: ['runId']
          }
        },
        {
          name: 'rerun_workflow',
          description: 'Re-run a failed workflow',
          inputSchema: {
            type: 'object',
            properties: {
              runId: {
                type: 'number',
                description: 'Workflow run ID to re-run'
              }
            },
            required: ['runId']
          }
        },
        {
          name: 'cancel_workflow',
          description: 'Cancel a running workflow',
          inputSchema: {
            type: 'object',
            properties: {
              runId: {
                type: 'number',
                description: 'Workflow run ID to cancel'
              }
            },
            required: ['runId']
          }
        },

        // Logs Tools
        {
          name: 'fetch_logs',
          description: 'Fetch application logs from the backend',
          inputSchema: {
            type: 'object',
            properties: {
              level: {
                type: 'string',
                description: 'Log level filter (ERROR, WARN, INFO, all)',
                enum: ['ERROR', 'WARN', 'INFO', 'all']
              },
              startDate: {
                type: 'string',
                description: 'Start date for filtering (YYYY-MM-DD)'
              },
              endDate: {
                type: 'string',
                description: 'End date for filtering (YYYY-MM-DD)'
              },
              apiPath: {
                type: 'string',
                description: 'Filter by API endpoint path'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of logs to return',
                default: 100
              }
            }
          }
        },
        {
          name: 'generate_daily_report',
          description: 'Generate a daily report with statistics and error highlights',
          inputSchema: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description: 'Date for the report (YYYY-MM-DD)'
              },
              includeErrors: {
                type: 'boolean',
                description: 'Include error details',
                default: true
              },
              includeStats: {
                type: 'boolean',
                description: 'Include statistics',
                default: true
              }
            },
            required: ['date']
          }
        },
        {
          name: 'post_logs_to_confluence',
          description: 'Post application logs to Confluence',
          inputSchema: {
            type: 'object',
            properties: {
              pageTitle: {
                type: 'string',
                description: 'Title for the logs page'
              },
              logs: {
                type: 'string',
                description: 'Log content to post'
              },
              pageId: {
                type: 'string',
                description: 'Optional existing page ID to update'
              }
            },
            required: ['pageTitle', 'logs']
          }
        },

        // Confluence Tools
        {
          name: 'create_confluence_page',
          description: 'Create a new Confluence page',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Page title'
              },
              content: {
                type: 'string',
                description: 'Page content in HTML format'
              },
              parentId: {
                type: 'string',
                description: 'Optional parent page ID'
              }
            },
            required: ['title', 'content']
          }
        },
        {
          name: 'update_confluence_page',
          description: 'Update an existing Confluence page',
          inputSchema: {
            type: 'object',
            properties: {
              pageId: {
                type: 'string',
                description: 'Page ID to update'
              },
              title: {
                type: 'string',
                description: 'Updated title'
              },
              content: {
                type: 'string',
                description: 'Updated content in HTML format'
              }
            },
            required: ['pageId', 'title', 'content']
          }
        },
        {
          name: 'post_logs_to_confluence',
          description: 'Post application logs to Confluence',
          inputSchema: {
            type: 'object',
            properties: {
              pageTitle: {
                type: 'string',
                description: 'Title for the logs page'
              },
              logs: {
                type: 'string',
                description: 'Log content to post'
              },
              pageId: {
                type: 'string',
                description: 'Optional existing page ID to update'
              }
            },
            required: ['pageTitle', 'logs']
          }
        },

        // Jira Tools
        {
          name: 'create_jira_issue',
          description: 'Create a new Jira issue',
          inputSchema: {
            type: 'object',
            properties: {
              summary: {
                type: 'string',
                description: 'Issue summary/title'
              },
              description: {
                type: 'string',
                description: 'Issue description'
              },
              issueType: {
                type: 'string',
                description: 'Type of issue (Bug, Task, Story)',
                default: 'Task'
              },
              priority: {
                type: 'string',
                description: 'Priority level (Highest, High, Medium, Low, Lowest)'
              },
              labels: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of labels'
              }
            },
            required: ['summary', 'description']
          }
        },
        {
          name: 'search_jira_issues',
          description: 'Search Jira issues using JQL',
          inputSchema: {
            type: 'object',
            properties: {
              jql: {
                type: 'string',
                description: 'JQL query string'
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of results',
                default: 50
              }
            }
          }
        },
        {
          name: 'get_jira_issue',
          description: 'Get details of a specific Jira issue',
          inputSchema: {
            type: 'object',
            properties: {
              issueKey: {
                type: 'string',
                description: 'Issue key (e.g., KAN-123)'
              }
            },
            required: ['issueKey']
          }
        }
      ]
    }));

    // Handle tool calls by forwarding to remote API
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;

      try {
        let response;

        // Map tool names to API endpoints
        switch (name) {
          // GitHub Actions
          case 'trigger_github_workflow':
            response = await axios.post(`${REMOTE_API_URL}/github/trigger-workflow`, args);
            break;
          case 'trigger_cypress_tests':
            response = await axios.post(`${REMOTE_API_URL}/github/trigger-workflow`, {
              branch: args.branch || 'main',
              workflow: 'test-and-deploy.yml'
            });
            break;
          case 'trigger_k6_tests':
            response = await axios.post(`${REMOTE_API_URL}/github/trigger-workflow`, {
              branch: args.branch || 'main',
              workflow: 'k6-performance-tests.yml',
              inputs: {
                test_type: args.test_type || 'smoke'
              }
            });
            break;
          case 'get_workflow_runs':
            response = await axios.get(`${REMOTE_API_URL}/github/workflow-runs`, { params: args });
            break;
          case 'get_workflow_run_details':
            response = await axios.get(`${REMOTE_API_URL}/github/workflow-runs/${args.runId}`);
            break;
          case 'rerun_workflow':
            response = await axios.post(`${REMOTE_API_URL}/github/workflow-runs/${args.runId}/rerun`);
            break;
          case 'cancel_workflow':
            response = await axios.delete(`${REMOTE_API_URL}/github/workflow-runs/${args.runId}`);
            break;

          // Logs
          case 'fetch_logs':
            response = await axios.get(`${REMOTE_API_URL}/logs/fetch`, { params: args });
            break;
          case 'generate_daily_report':
            response = await axios.post(`${REMOTE_API_URL}/logs/daily-report`, args);
            break;
          case 'post_logs_to_confluence':
            response = await axios.post(`${REMOTE_API_URL}/logs/post-to-confluence`, args);
            break;

          // Confluence
          case 'create_confluence_page':
            response = await axios.post(`${REMOTE_API_URL}/confluence/create-page`, args);
            break;
          case 'update_confluence_page':
            response = await axios.put(`${REMOTE_API_URL}/confluence/update-page/${args.pageId}`, {
              title: args.title,
              content: args.content
            });
            break;
          case 'post_logs_to_confluence':
            response = await axios.post(`${REMOTE_API_URL}/logs/post-to-confluence`, args);
            break;

          // Jira
          case 'create_jira_issue':
            response = await axios.post(`${REMOTE_API_URL}/jira/create-issue`, args);
            break;
          case 'search_jira_issues':
            response = await axios.get(`${REMOTE_API_URL}/jira/issues`, { params: args });
            break;
          case 'get_jira_issue':
            response = await axios.get(`${REMOTE_API_URL}/jira/issues/${args.issueKey}`);
            break;

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2)
            }
          ]
        };
      } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.message;
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`
            }
          ],
          isError: true
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Remote MCP Proxy server running on stdio');
    console.error(`Forwarding to: ${REMOTE_API_URL}`);
  }
}

const proxy = new RemoteMCPProxy();
proxy.run().catch(console.error);
