#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { JiraService } from "./services/jira-service.js";
import { CodebaseService } from "./services/codebase-service.js";
import { TestAnalysisService } from "./services/test-analysis-service.js";
import { TestRunnerService } from "./services/test-runner-service.js";
import { ConfluenceService } from "./services/confluence-service.js";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = path.join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

const requiredEnvVars = [
  "JIRA_BASE_URL",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "JIRA_PROJECT_KEY",
  "WORKSPACE_PATH",
  "TEST_RESULTS_PATH",
];

const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  console.error("Missing environment variables:", missingEnvVars.join(", "));
  console.error("Please create a .env file based on .env.example");
  process.exit(1);
}

class JiraMCPServer {
  private server: Server;
  private jiraService: JiraService;
  private codebaseService: CodebaseService;
  private testAnalysisService: TestAnalysisService;
  private testRunnerService: TestRunnerService;
  private confluenceService: ConfluenceService | null;

  constructor() {
    this.server = new Server(
      {
        name: "jira-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.jiraService = new JiraService({
      baseUrl: process.env.JIRA_BASE_URL || "",
      email: process.env.JIRA_EMAIL || "",
      apiToken: process.env.JIRA_API_TOKEN || "",
      projectKey: process.env.JIRA_PROJECT_KEY || "",
    });

    this.codebaseService = new CodebaseService(process.env.WORKSPACE_PATH || "");
    this.testAnalysisService = new TestAnalysisService(process.env.TEST_RESULTS_PATH || "");
    this.testRunnerService = new TestRunnerService(process.env.WORKSPACE_PATH || "");
    
    // Confluence is optional
    this.confluenceService = null;
    if (process.env.CONFLUENCE_BASE_URL && process.env.CONFLUENCE_EMAIL && 
        process.env.CONFLUENCE_API_TOKEN && process.env.CONFLUENCE_SPACE_KEY) {
      this.confluenceService = new ConfluenceService({
        baseUrl: process.env.CONFLUENCE_BASE_URL,
        email: process.env.CONFLUENCE_EMAIL,
        apiToken: process.env.CONFLUENCE_API_TOKEN,
        spaceKey: process.env.CONFLUENCE_SPACE_KEY,
      });
    }

    this.setupToolHandlers();
    this.server.onerror = (error) => console.error("[MCP Error]", error);
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "create_user_story",
          description:
            "Create a user story in Jira with intelligent codebase analysis. Analyzes the codebase to identify relevant files, estimate complexity, and suggest implementation approach.",
          inputSchema: {
            type: "object",
            properties: {
              requirement: {
                type: "string",
                description: "User story requirement or description",
              },
              acceptanceCriteria: {
                type: "array",
                items: { type: "string" },
                description: "List of acceptance criteria",
              },
              priority: {
                type: "string",
                enum: ["Highest", "High", "Medium", "Low", "Lowest"],
                description: "Story priority",
                default: "Medium",
              },
              epicKey: {
                type: "string",
                description: "Parent epic key (e.g., SA-123)",
              },
              labels: {
                type: "array",
                items: { type: "string" },
                description: "Labels/tags for the story",
              },
            },
            required: ["requirement"],
          },
        },
        {
          name: "create_epic",
          description:
            "Create an epic in Jira to group related user stories and features.",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Epic title/name",
              },
              description: {
                type: "string",
                description: "Epic description with goals and scope",
              },
              labels: {
                type: "array",
                items: { type: "string" },
                description: "Labels/tags for the epic",
              },
            },
            required: ["title", "description"],
          },
        },
        {
          name: "create_bug_from_test_failure",
          description:
            "Analyze test failures and create bug tickets in Jira. Uses AI to determine if it's an actual bug or test/environment issue. Only creates bugs for actual code defects.",
          inputSchema: {
            type: "object",
            properties: {
              testName: {
                type: "string",
                description: "Name of the failing test",
              },
              errorMessage: {
                type: "string",
                description: "Error message from test failure",
              },
              stackTrace: {
                type: "string",
                description: "Stack trace (optional)",
              },
              testFile: {
                type: "string",
                description: "Test file path (optional)",
              },
              autoCreate: {
                type: "boolean",
                description: "Auto-create bug if analysis confirms it's a real bug (default: false)",
                default: false,
              },
            },
            required: ["testName", "errorMessage"],
          },
        },
        {
          name: "analyze_all_test_failures",
          description:
            "Scan test results and analyze all failures. Returns which failures are actual bugs vs test/environment issues.",
          inputSchema: {
            type: "object",
            properties: {
              createBugs: {
                type: "boolean",
                description: "Automatically create Jira bugs for confirmed defects",
                default: false,
              },
            },
          },
        },
        {
          name: "search_jira_issues",
          description:
            "Search for existing Jira issues using JQL (Jira Query Language).",
          inputSchema: {
            type: "object",
            properties: {
              jql: {
                type: "string",
                description: "JQL query (e.g., 'project = SA AND status = Open')",
              },
              maxResults: {
                type: "number",
                description: "Maximum number of results",
                default: 20,
              },
            },
            required: ["jql"],
          },
        },
        {
          name: "list_available_tests",
          description:
            "List all available test specs/features/scripts across Cypress, Karate, and K6 frameworks.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "get_test_cases",
          description:
            "Get all test cases (individual tests) from a specific test file. Shows the test names that can be run individually.",
          inputSchema: {
            type: "object",
            properties: {
              testFile: {
                type: "string",
                description: "Test file path relative to test directory (e.g., 'vehicles/vehicles.cy.js', 'vehicles.feature', 'smoke.test.js')",
              },
            },
            required: ["testFile"],
          },
        },
        {
          name: "run_cypress_tests",
          description:
            "Run Cypress E2E tests. Optionally filter by spec pattern and/or specific test name, create JIRA bugs for failures, and generate Confluence documentation.",
          inputSchema: {
            type: "object",
            properties: {
              specPattern: {
                type: "string",
                description: "Spec pattern to run (e.g., 'cypress/e2e/vehicles/*.cy.js' or leave empty for all tests)",
              },
              testName: {
                type: "string",
                description: "Specific test name to run (e.g., 'should display vehicle details'). Use with specPattern to run one test from a file.",
              },
              createBugs: {
                type: "boolean",
                description: "Automatically create JIRA bugs for test failures",
                default: false,
              },
              createConfluenceReport: {
                type: "boolean",
                description: "Create a Confluence page with test results",
                default: false,
              },
            },
          },
        },
        {
          name: "run_karate_tests",
          description:
            "Run Karate API tests. Optionally filter by tag or specific scenario name, create JIRA bugs for failures, and generate Confluence documentation.",
          inputSchema: {
            type: "object",
            properties: {
              tag: {
                type: "string",
                description: "Tag to filter tests (e.g., '@smoke', '@vehicles')",
              },
              scenarioName: {
                type: "string",
                description: "Specific scenario name to run (e.g., 'Get vehicle by ID'). Cannot be used with tag.",
              },
              createBugs: {
                type: "boolean",
                description: "Automatically create JIRA bugs for test failures",
                default: false,
              },
              createConfluenceReport: {
                type: "boolean",
                description: "Create a Confluence page with test results",
                default: false,
              },
            },
          },
        },
        {
          name: "run_k6_tests",
          description:
            "Run K6 performance tests and optionally generate Confluence documentation.",
          inputSchema: {
            type: "object",
            properties: {
              scriptPath: {
                type: "string",
                description: "Path to K6 script (e.g., 'tests/smoke.test.js')",
              },
              createConfluenceReport: {
                type: "boolean",
                description: "Create a Confluence page with test results",
                default: false,
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "create_user_story": {
            const requirement = args?.requirement as string;
            const acceptanceCriteria = (args?.acceptanceCriteria as string[]) || [];
            const priority = (args?.priority as any) || "Medium";
            const epicKey = args?.epicKey as string | undefined;
            const labels = (args?.labels as string[]) || [];

            // Analyze codebase
            console.error("Analyzing codebase for requirement...");
            const analysis = await this.codebaseService.analyzeRequirement(requirement);

            // Create story description with analysis
            let description = `${requirement}\n\n`;
            description += `*Codebase Analysis:*\n`;
            description += `- Estimated Complexity: ${analysis.estimatedComplexity}\n`;
            description += `- Impacted Components: ${analysis.impactedComponents.join(", ") || "None identified"}\n`;
            description += `- Dependencies: ${analysis.dependencies.join(", ") || "None"}\n\n`;
            
            if (analysis.relevantFiles.length > 0) {
              description += `*Relevant Files:*\n${analysis.relevantFiles.map(f => `- ${f}`).join("\n")}\n\n`;
            }
            
            description += `*Suggested Approach:*\n${analysis.suggestedApproach}`;

            // Estimate story points based on complexity
            const storyPoints = analysis.estimatedComplexity === "High" ? 8 : 
                               analysis.estimatedComplexity === "Medium" ? 5 : 3;

            // Create the story
            const issue = await this.jiraService.createIssue({
              summary: requirement.slice(0, 100), // Jira summary limit
              description,
              issueType: "Story",
              priority,
              labels: [...labels, ...analysis.impactedComponents],
              parentKey: epicKey,
              storyPoints,
              acceptanceCriteria,
            });

            return {
              content: [
                {
                  type: "text",
                  text: `✅ User Story Created: ${issue.key}\n\n*Summary:* ${requirement}\n*Complexity:* ${analysis.estimatedComplexity} (${storyPoints} points)\n*Components:* ${analysis.impactedComponents.join(", ")}\n*URL:* ${process.env.JIRA_BASE_URL}/browse/${issue.key}\n\n*Relevant Files Found:*\n${analysis.relevantFiles.slice(0, 5).map(f => `- ${f}`).join("\n")}`,
                },
              ],
            };
          }

          case "create_epic": {
            const title = args?.title as string;
            const description = args?.description as string;
            const labels = (args?.labels as string[]) || [];

            const issue = await this.jiraService.createIssue({
              summary: title,
              description,
              issueType: "Epic",
              labels,
            });

            return {
              content: [
                {
                  type: "text",
                  text: `✅ Epic Created: ${issue.key}\n\n*Title:* ${title}\n*URL:* ${process.env.JIRA_BASE_URL}/browse/${issue.key}\n\nYou can now link user stories to this epic using epicKey: "${issue.key}"`,
                },
              ],
            };
          }

          case "create_bug_from_test_failure": {
            const testName = args?.testName as string;
            const errorMessage = args?.errorMessage as string;
            const stackTrace = args?.stackTrace as string | undefined;
            const testFile = args?.testFile as string | undefined;
            const autoCreate = (args?.autoCreate as boolean) || false;

            // Analyze the failure
            const analysis = this.testAnalysisService.analyzeTestFailure({
              testName,
              errorMessage,
              stackTrace,
              testFile,
            });

            let resultText = `*Test Failure Analysis*\n\n`;
            resultText += `*Test:* ${testName}\n`;
            resultText += `*Error:* ${errorMessage}\n\n`;
            resultText += `*Analysis Results:*\n`;
            resultText += `- Is Actual Bug: ${analysis.isActualBug ? "✅ YES" : "❌ NO"}\n`;
            resultText += `- Confidence: ${analysis.confidence}\n`;
            resultText += `- Bug Type: ${analysis.bugType}\n`;
            resultText += `- Severity: ${analysis.severity}\n`;
            resultText += `- Reproducible: ${analysis.reproducible ? "Yes" : "No (Flaky)"}\n`;
            resultText += `- Affected Components: ${analysis.affectedComponents.join(", ")}\n\n`;
            resultText += `*Root Cause:*\n${analysis.rootCause}\n\n`;

            // Only create bug if it's confirmed as actual bug and autoCreate is true
            if (analysis.isActualBug && autoCreate && analysis.confidence !== "Low") {
              const bugReport = this.testAnalysisService.generateBugReport(
                { testName, errorMessage, stackTrace, testFile },
                analysis
              );

              const issue = await this.jiraService.createIssue({
                summary: `[Test Failure] ${testName}`,
                description: bugReport,
                issueType: "Bug",
                priority: analysis.severity === "Critical" ? "Highest" : 
                         analysis.severity === "High" ? "High" : "Medium",
                labels: ["test-failure", ...analysis.affectedComponents],
              });

              resultText += `\n✅ *Bug Created:* ${issue.key}\n`;
              resultText += `*URL:* ${process.env.JIRA_BASE_URL}/browse/${issue.key}`;
            } else if (!analysis.isActualBug) {
              resultText += `\n💡 *Recommendation:* This appears to be a ${analysis.bugType.toLowerCase()}, not a code defect. No bug ticket created.`;
            } else if (!autoCreate) {
              resultText += `\n💡 *Recommendation:* Set autoCreate=true to automatically create bug ticket.`;
            }

            return {
              content: [
                {
                  type: "text",
                  text: resultText,
                },
              ],
            };
          }

          case "analyze_all_test_failures": {
            const createBugs = (args?.createBugs as boolean) || false;

            const failures = await this.testAnalysisService.getTestFailures();

            if (failures.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: "✅ No test failures found! All tests passing.",
                  },
                ],
              };
            }

            let resultText = `*Test Failure Summary*\n\n`;
            resultText += `Found ${failures.length} test failure(s)\n\n`;

            const actualBugs: any[] = [];
            const nonBugs: any[] = [];

            for (const failure of failures) {
              const analysis = this.testAnalysisService.analyzeTestFailure(failure);

              if (analysis.isActualBug && analysis.confidence !== "Low") {
                actualBugs.push({ failure, analysis });
              } else {
                nonBugs.push({ failure, analysis });
              }
            }

            resultText += `*Actual Bugs:* ${actualBugs.length}\n`;
            resultText += `*Test/Environment Issues:* ${nonBugs.length}\n\n`;

            if (actualBugs.length > 0) {
              resultText += `*🐛 Confirmed Bugs:*\n`;
              for (const { failure, analysis } of actualBugs) {
                resultText += `\n- ${failure.testName}\n`;
                resultText += `  Type: ${analysis.bugType} | Severity: ${analysis.severity}\n`;
                resultText += `  Components: ${analysis.affectedComponents.join(", ")}\n`;

                if (createBugs) {
                  const bugReport = this.testAnalysisService.generateBugReport(failure, analysis);
                  const issue = await this.jiraService.createIssue({
                    summary: `[Test Failure] ${failure.testName}`,
                    description: bugReport,
                    issueType: "Bug",
                    priority: analysis.severity === "Critical" ? "Highest" : 
                             analysis.severity === "High" ? "High" : "Medium",
                    labels: ["test-failure", ...analysis.affectedComponents],
                  });
                  resultText += `  ✅ Created: ${issue.key}\n`;
                }
              }
            }

            if (nonBugs.length > 0) {
              resultText += `\n*⚠️ Test/Environment Issues (Not Bugs):*\n`;
              for (const { failure, analysis } of nonBugs) {
                resultText += `\n- ${failure.testName}\n`;
                resultText += `  Type: ${analysis.bugType}\n`;
              }
            }

            if (!createBugs && actualBugs.length > 0) {
              resultText += `\n\n💡 Set createBugs=true to automatically create Jira tickets for confirmed bugs.`;
            }

            return {
              content: [
                {
                  type: "text",
                  text: resultText,
                },
              ],
            };
          }

          case "search_jira_issues": {
            const jql = args?.jql as string;
            const maxResults = (args?.maxResults as number) || 20;

            const issues = await this.jiraService.searchIssues(jql, maxResults);

            if (issues.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `No issues found for query: ${jql}`,
                  },
                ],
              };
            }

            let resultText = `*Search Results (${issues.length})*\n\n`;
            issues.forEach((issue) => {
              resultText += `*${issue.key}:* ${issue.fields.summary}\n`;
              resultText += `Status: ${issue.fields.status.name}\n`;
              resultText += `URL: ${process.env.JIRA_BASE_URL}/browse/${issue.key}\n\n`;
            });

            return {
              content: [
                {
                  type: "text",
                  text: resultText,
                },
              ],
            };
          }

          case "list_available_tests": {
            const tests = await this.testRunnerService.getAvailableTests();

            let resultText = `*Available Test Suites*\n\n`;
            resultText += `*Cypress (E2E):* ${tests.cypress.length} specs\n`;
            tests.cypress.slice(0, 10).forEach(spec => {
              resultText += `  - ${spec}\n`;
            });
            if (tests.cypress.length > 10) {
              resultText += `  ... and ${tests.cypress.length - 10} more\n`;
            }

            resultText += `\n*Karate (API):* ${tests.karate.length} features\n`;
            tests.karate.slice(0, 10).forEach(feat => {
              resultText += `  - ${feat}\n`;
            });
            if (tests.karate.length > 10) {
              resultText += `  ... and ${tests.karate.length - 10} more\n`;
            }

            resultText += `\n*K6 (Performance):* ${tests.k6.length} scripts\n`;
            tests.k6.forEach(script => {
              resultText += `  - ${script}\n`;
            });

            return {
              content: [
                {
                  type: "text",
                  text: resultText,
                },
              ],
            };
          }

          case "get_test_cases": {
            const testFile = args?.testFile as string;
            const result = await this.testRunnerService.getTestCases(testFile);

            let resultText = `*Test Cases in ${testFile}*\n\n`;
            resultText += `Framework: ${result.framework}\n`;
            resultText += `Total Test Cases: ${result.testCases.length}\n\n`;
            
            result.testCases.forEach((testCase, index) => {
              resultText += `${index + 1}. ${testCase}\n`;
            });

            if (result.testCases.length === 0) {
              resultText += `\nNo test cases found. Make sure the file path is correct.`;
            }

            return {
              content: [
                {
                  type: "text",
                  text: resultText,
                },
              ],
            };
          }

          case "run_cypress_tests": {
            const specPattern = args?.specPattern as string | undefined;
            const testName = args?.testName as string | undefined;
            const createBugs = (args?.createBugs as boolean) || false;
            const createConfluenceReport = (args?.createConfluenceReport as boolean) || false;

            const result = await this.testRunnerService.runCypressTests(specPattern, testName);
            
            let resultText = `*Cypress Test Results*\n\n`;
            if (testName) {
              resultText += `Test: "${testName}"\n`;
            }
            if (specPattern) {
              resultText += `Spec: ${specPattern}\n`;
            }
            resultText += `Status: ${result.success ? "✅ PASSED" : "❌ FAILED"}\n`;
            resultText += `Total: ${result.totalTests} | Passing: ${result.passing} | Failing: ${result.failing}\n`;
            resultText += `Duration: ${result.duration}\n\n`;

            const createdBugs: string[] = [];

            if (result.failures.length > 0 && createBugs) {
              resultText += `*Creating JIRA Bugs for Failures...*\n\n`;
              
              for (const failure of result.failures) {
                const analysis = this.testAnalysisService.analyzeTestFailure(failure);
                
                if (analysis.isActualBug && analysis.confidence !== "Low") {
                  const bugReport = this.testAnalysisService.generateBugReport(failure, analysis);
                  const issue = await this.jiraService.createIssue({
                    summary: `[Cypress] ${failure.testName}`,
                    description: bugReport,
                    issueType: "Bug",
                    priority: analysis.severity === "Critical" ? "Highest" : 
                             analysis.severity === "High" ? "High" : "Medium",
                    labels: ["cypress", "test-failure", ...analysis.affectedComponents],
                  });
                  
                  createdBugs.push(issue.key);
                  resultText += `  ✅ Created ${issue.key}: ${failure.testName}\n`;
                }
              }
            }

            if (createConfluenceReport && this.confluenceService) {
              const timestamp = new Date().toISOString();
              const reportData = {
                title: `Cypress Test Run`,
                framework: 'cypress',
                timestamp,
                success: result.success,
                totalTests: result.totalTests,
                passing: result.passing,
                failing: result.failing,
                duration: result.duration,
                failures: result.failures,
                summary: result.summary,
                jiraBugs: createdBugs,
              };

              const confluencePage = await this.confluenceService.createTestReport(reportData);
              resultText += `\n📄 Confluence Report: ${confluencePage.url}\n`;
            }

            return {
              content: [
                {
                  type: "text",
                  text: resultText,
                },
              ],
            };
          }

          case "run_karate_tests": {
            const tag = args?.tag as string | undefined;
            const scenarioName = args?.scenarioName as string | undefined;
            const createBugs = (args?.createBugs as boolean) || false;
            const createConfluenceReport = (args?.createConfluenceReport as boolean) || false;

            const result = await this.testRunnerService.runKarateTests(tag, scenarioName);
            
            let resultText = `*Karate Test Results*\n\n`;
            if (tag) {
              resultText += `Tag: ${tag}\n`;
            }
            if (scenarioName) {
              resultText += `Scenario: "${scenarioName}"\n`;
            }
            resultText += `Status: ${result.success ? "✅ PASSED" : "❌ FAILED"}\n`;
            resultText += `Total: ${result.totalTests} | Passing: ${result.passing} | Failing: ${result.failing}\n`;
            resultText += `Duration: ${result.duration}\n\n`;

            const createdBugs: string[] = [];

            if (result.failures.length > 0 && createBugs) {
              resultText += `*Creating JIRA Bugs for Failures...*\n\n`;
              
              for (const failure of result.failures) {
                const analysis = this.testAnalysisService.analyzeTestFailure(failure);
                
                if (analysis.isActualBug && analysis.confidence !== "Low") {
                  const bugReport = this.testAnalysisService.generateBugReport(failure, analysis);
                  const issue = await this.jiraService.createIssue({
                    summary: `[Karate] ${failure.testName}`,
                    description: bugReport,
                    issueType: "Bug",
                    priority: analysis.severity === "Critical" ? "Highest" : 
                             analysis.severity === "High" ? "High" : "Medium",
                    labels: ["karate", "api-test", "test-failure", ...analysis.affectedComponents],
                  });
                  
                  createdBugs.push(issue.key);
                  resultText += `  ✅ Created ${issue.key}: ${failure.testName}\n`;
                }
              }
            }

            if (createConfluenceReport && this.confluenceService) {
              const timestamp = new Date().toISOString();
              const reportData = {
                title: `Karate API Test Run`,
                framework: 'karate',
                timestamp,
                success: result.success,
                totalTests: result.totalTests,
                passing: result.passing,
                failing: result.failing,
                duration: result.duration,
                failures: result.failures,
                summary: result.summary,
                jiraBugs: createdBugs,
              };

              const confluencePage = await this.confluenceService.createTestReport(reportData);
              resultText += `\n📄 Confluence Report: ${confluencePage.url}\n`;
            }

            return {
              content: [
                {
                  type: "text",
                  text: resultText,
                },
              ],
            };
          }

          case "run_k6_tests": {
            const scriptPath = args?.scriptPath as string | undefined;
            const createConfluenceReport = (args?.createConfluenceReport as boolean) || false;

            const result = await this.testRunnerService.runK6Tests(scriptPath);
            
            let resultText = `*K6 Performance Test Results*\n\n`;
            resultText += `Status: ${result.success ? "✅ PASSED" : "❌ FAILED"}\n`;
            resultText += `Checks: ${result.passing}/${result.totalTests} passed\n`;
            resultText += `Duration: ${result.duration}\n\n`;

            if (result.failures.length > 0) {
              resultText += `*Failed Checks:*\n`;
              result.failures.forEach(failure => {
                resultText += `  ❌ ${failure.testName}: ${failure.errorMessage}\n`;
              });
            }

            if (createConfluenceReport && this.confluenceService) {
              const timestamp = new Date().toISOString();
              const reportData = {
                title: `K6 Performance Test Run`,
                framework: 'k6',
                timestamp,
                success: result.success,
                totalTests: result.totalTests,
                passing: result.passing,
                failing: result.failing,
                duration: result.duration,
                failures: result.failures,
                summary: result.summary,
              };

              const confluencePage = await this.confluenceService.createTestReport(reportData);
              resultText += `\n📄 Confluence Report: ${confluencePage.url}\n`;
            }

            return {
              content: [
                {
                  type: "text",
                  text: resultText,
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Jira MCP Server running on stdio");
  }
}

const server = new JiraMCPServer();
server.run().catch(console.error);
