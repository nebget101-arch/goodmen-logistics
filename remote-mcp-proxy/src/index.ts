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
          description: 'Trigger K6 performance tests with specific test type and optional parameters',
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
              },
              smoke_vus: {
                type: 'string',
                description: 'Smoke: VUs (default: 1)',
              },
              smoke_duration: {
                type: 'string',
                description: 'Smoke: Duration (default: 30s)',
              },
              load_ramp_up: {
                type: 'string',
                description: 'Load: Ramp up time (default: 2m)',
              },
              load_steady: {
                type: 'string',
                description: 'Load: Steady time (default: 5m)',
              },
              load_target_vu1: {
                type: 'string',
                description: 'Load: Target VU level 1 (default: 10)',
              },
              load_target_vu2: {
                type: 'string',
                description: 'Load: Target VU level 2 (default: 20)',
              },
              load_target_vu3: {
                type: 'string',
                description: 'Load: Target VU level 3 (default: 30)',
              },
              stress_ramp_time: {
                type: 'string',
                description: 'Stress: Ramp time (default: 2m)',
              },
              stress_steady_time: {
                type: 'string',
                description: 'Stress: Steady time (default: 5m)',
              },
              stress_recovery_time: {
                type: 'string',
                description: 'Stress: Recovery time (default: 5m)',
              },
              stress_target_vu1: {
                type: 'string',
                description: 'Stress: Normal VUs (default: 20)',
              },
              stress_target_vu2: {
                type: 'string',
                description: 'Stress: Above normal VUs (default: 50)',
              },
              stress_target_vu3: {
                type: 'string',
                description: 'Stress: Stress level VUs (default: 100)',
              },
              stress_target_vu4: {
                type: 'string',
                description: 'Stress: Breaking point VUs (default: 150)',
              },
              spike_normal_vu: {
                type: 'string',
                description: 'Spike: Normal VUs (default: 5)',
              },
              spike_peak_vu: {
                type: 'string',
                description: 'Spike: Peak VUs (default: 100)',
              },
              spike_up_time: {
                type: 'string',
                description: 'Spike: Up time (default: 30s)',
              },
              spike_sustain_time: {
                type: 'string',
                description: 'Spike: Sustain time (default: 3m)',
              },
              spike_down_time: {
                type: 'string',
                description: 'Spike: Down time (default: 30s)',
              },
              spike_recovery_time: {
                type: 'string',
                description: 'Spike: Recovery time (default: 2m)',
              },
              soak_vus: {
                type: 'string',
                description: 'Soak: VUs (default: 20)',
              },
              soak_duration: {
                type: 'string',
                description: 'Soak: Duration (default: 1h)',
              },
              vehicles_ramp_up: {
                type: 'string',
                description: 'Vehicles: Ramp up time (default: 30s)',
              },
              vehicles_steady: {
                type: 'string',
                description: 'Vehicles: Steady time (default: 1m)',
              },
              vehicles_ramp_down: {
                type: 'string',
                description: 'Vehicles: Ramp down time (default: 20s)',
              },
              vehicles_target_vu: {
                type: 'string',
                description: 'Vehicles: Target VUs (default: 10)',
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
            const k6Inputs: Record<string, any> = {
              test_type: args.test_type || 'smoke'
            };
            // Add optional parameters if provided
            if (args.smoke_vus) k6Inputs.smoke_vus = args.smoke_vus;
            if (args.smoke_duration) k6Inputs.smoke_duration = args.smoke_duration;
            if (args.load_ramp_up) k6Inputs.load_ramp_up = args.load_ramp_up;
            if (args.load_steady) k6Inputs.load_steady = args.load_steady;
            if (args.load_target_vu1) k6Inputs.load_target_vu1 = args.load_target_vu1;
            if (args.load_target_vu2) k6Inputs.load_target_vu2 = args.load_target_vu2;
            if (args.load_target_vu3) k6Inputs.load_target_vu3 = args.load_target_vu3;
            if (args.stress_ramp_time) k6Inputs.stress_ramp_time = args.stress_ramp_time;
            if (args.stress_steady_time) k6Inputs.stress_steady_time = args.stress_steady_time;
            if (args.stress_recovery_time) k6Inputs.stress_recovery_time = args.stress_recovery_time;
            if (args.stress_target_vu1) k6Inputs.stress_target_vu1 = args.stress_target_vu1;
            if (args.stress_target_vu2) k6Inputs.stress_target_vu2 = args.stress_target_vu2;
            if (args.stress_target_vu3) k6Inputs.stress_target_vu3 = args.stress_target_vu3;
            if (args.stress_target_vu4) k6Inputs.stress_target_vu4 = args.stress_target_vu4;
            if (args.spike_normal_vu) k6Inputs.spike_normal_vu = args.spike_normal_vu;
            if (args.spike_peak_vu) k6Inputs.spike_peak_vu = args.spike_peak_vu;
            if (args.spike_up_time) k6Inputs.spike_up_time = args.spike_up_time;
            if (args.spike_sustain_time) k6Inputs.spike_sustain_time = args.spike_sustain_time;
            if (args.spike_down_time) k6Inputs.spike_down_time = args.spike_down_time;
            if (args.spike_recovery_time) k6Inputs.spike_recovery_time = args.spike_recovery_time;
            if (args.soak_vus) k6Inputs.soak_vus = args.soak_vus;
            if (args.soak_duration) k6Inputs.soak_duration = args.soak_duration;
            if (args.vehicles_ramp_up) k6Inputs.vehicles_ramp_up = args.vehicles_ramp_up;
            if (args.vehicles_steady) k6Inputs.vehicles_steady = args.vehicles_steady;
            if (args.vehicles_ramp_down) k6Inputs.vehicles_ramp_down = args.vehicles_ramp_down;
            if (args.vehicles_target_vu) k6Inputs.vehicles_target_vu = args.vehicles_target_vu;
            
            response = await axios.post(`${REMOTE_API_URL}/github/trigger-workflow`, {
              branch: args.branch || 'main',
              workflow: 'k6-performance-tests.yml',
              inputs: k6Inputs
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
