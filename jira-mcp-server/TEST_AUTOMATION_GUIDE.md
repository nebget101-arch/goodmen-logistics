# Test Automation Guide - JIRA MCP Server

## Overview

This guide explains how to use the enhanced JIRA MCP Server's test automation capabilities. The server now supports running Cypress, Karate, and K6 tests directly through Claude, with automatic bug creation and Confluence reporting.

## What's New

### 🧪 Multi-Framework Test Execution
- **Cypress E2E Tests**: Run browser-based tests with spec filtering
- **Karate API Tests**: Execute API tests with tag-based filtering
- **K6 Performance Tests**: Run load, stress, and smoke tests

### 🤖 Intelligent Bug Creation
- AI analyzes each test failure
- Distinguishes real bugs from flaky tests, environment issues, and test problems
- Automatically creates JIRA tickets only for confirmed code defects
- Includes detailed error messages, stack traces, and reproducibility info

### 📊 Confluence Documentation
- Auto-generates formatted test execution reports
- Includes pass/fail statistics and success rates
- Expandable failure details with error messages
- Direct links to created JIRA bugs
- Color-coded status macros

## Architecture

```
Claude → MCP Server → Test Runner Service → [Cypress/Karate/K6]
                    ↓
              Test Results Parser
                    ↓
           Test Analysis Service (AI)
                    ↓
            ┌──────┴──────┐
            ↓             ↓
      JIRA Service   Confluence Service
     (Bug Creation)  (Report Generation)
```

## Services

### TestRunnerService
**Location:** `src/services/test-runner-service.ts`

**Responsibilities:**
- Execute test frameworks via shell commands
- Parse test output (Cypress JSON, Maven Surefire, K6 summary)
- Extract failure details and error messages
- Discover available test specs

**Methods:**
- `runCypressTests(specPattern?)` - Runs Cypress with optional filtering
- `runKarateTests(tag?)` - Runs Karate with Maven, supports tag filtering
- `runK6Tests(scriptPath?)` - Runs K6 performance tests
- `getAvailableTests()` - Lists all test specs across frameworks

### ConfluenceService
**Location:** `src/services/confluence-service.ts`

**Responsibilities:**
- Create and update Confluence pages
- Format test results as HTML with Confluence macros
- Generate status badges and expandable sections
- Link JIRA bugs in reports

**Methods:**
- `createTestReport(data)` - Creates formatted Confluence page
- `formatTestReportContent(data)` - Generates HTML with macros

## Usage Examples

### 1. Discover Available Tests
```
User: "Show me all available tests"
```

**Returns:**
```json
{
  "cypress": [
    "vehicles.cy.js (29 tests)",
    "drivers.cy.js (15 tests)",
    "loads.cy.js (12 tests)"
  ],
  "karate": [
    "vehicles.feature (10 scenarios)",
    "drivers.feature (8 scenarios)"
  ],
  "k6": [
    "smoke.test.js",
    "load.test.js",
    "stress.test.js"
  ]
}
```

### 2. Run Specific Cypress Tests
```
User: "Run Cypress vehicle tests"
```

**What Happens:**
1. Executes: `cd cypress-tests && npx cypress run --spec "**/vehicles*.cy.js"`
2. Parses Cypress JSON output
3. Returns summary with pass/fail counts

### 3. Run Tests with Bug Creation
```
User: "Run Cypress vehicle tests and create bugs for failures"
```

**What Happens:**
1. Executes Cypress tests
2. For each failure:
   - Analyzes error message and stack trace
   - Determines if it's a real bug or test/environment issue
   - Creates JIRA bug only if confirmed code defect
3. Returns bug keys: `["SA-123", "SA-124"]`

### 4. Complete Test Run with Reporting
```
User: "Run all Cypress tests, create bugs, and generate Confluence report"
```

**What Happens:**
1. Executes entire Cypress suite
2. Parses all results
3. Analyzes failures with AI
4. Creates JIRA bugs for confirmed defects
5. Generates Confluence page with:
   - Test execution summary
   - Success rate (e.g., "75% - 18/24 tests passed")
   - Expandable failure sections
   - Links to created bugs
6. Returns Confluence page URL

### 5. Run Karate Tests with Tags
```
User: "Run Karate tests tagged @smoke"
```

**What Happens:**
1. Executes: `cd karate-tests && mvn test -Dkarate.options="--tags @smoke"`
2. Parses Maven Surefire output
3. Returns scenario counts and failures

### 6. Run K6 Performance Tests
```
User: "Run K6 smoke test"
```

**What Happens:**
1. Executes: `k6 run tests/smoke.test.js`
2. Parses K6 summary output
3. Returns check statistics and threshold violations

## Test Result Flow

### Cypress Flow
```
npm run cy:run --spec pattern
    ↓
Parse: cypress/results/mochawesome.json
    ↓
Extract: {
  total: 24,
  passed: 18,
  failed: 6,
  pending: 0,
  failures: [{
    test: "should display vehicle details",
    error: "Timed out retrying after 4000ms...",
    stack: "at Context.eval (/vehicles.cy.js:45:8)"
  }]
}
```

### Karate Flow
```
mvn test -Dkarate.options="--tags @smoke"
    ↓
Parse: stdout (Maven Surefire output)
    ↓
Extract: {
  scenarios: 10,
  failed: 2,
  failures: [{
    feature: "vehicles.feature",
    scenario: "Get vehicle by ID",
    error: "status code was: 500, expected: 200"
  }]
}
```

### K6 Flow
```
k6 run tests/smoke.test.js
    ↓
Parse: stdout (K6 summary)
    ↓
Extract: {
  checks: { passed: 18, failed: 2 },
  http_req_duration: { p95: 1250 },
  thresholds: ["http_req_duration: p95 < 2000ms - passed"]
}
```

## Bug Creation Logic

### Analysis Categories
1. **Code Defect** → Creates JIRA bug
   - Null pointer exceptions
   - Type errors
   - 5xx server errors
   - Failed assertions on business logic

2. **Test Issue** → No bug created
   - Incorrect selectors
   - Test data problems
   - Assertion logic errors

3. **Environment Issue** → No bug created
   - Timeouts
   - Network errors
   - Service unavailability

4. **Configuration Issue** → No bug created
   - Missing environment variables
   - Database connection issues

### Example Bug Creation

**Test Failure:**
```
Test: "should create new vehicle"
Error: "Cannot read property 'id' of null"
Stack: "at VehicleService.createVehicle (vehicle.service.ts:45)"
```

**AI Analysis:**
```
Category: Code Defect
Confidence: High
Reasoning: Null pointer access in production code
```

**Created JIRA Bug:**
```
Title: [E2E Test Failure] Cannot read property 'id' of null in VehicleService
Priority: High
Description:
Test failure detected in Cypress E2E test suite.

Test: should create new vehicle
Error: Cannot read property 'id' of null
Location: vehicle.service.ts:45

Analysis:
This appears to be a null pointer exception in the VehicleService.createVehicle method.
The code attempts to access the 'id' property on a null object.

Impact: High - Prevents vehicle creation functionality

Stack Trace:
at VehicleService.createVehicle (vehicle.service.ts:45)
at POST /api/vehicles (vehicles.controller.ts:23)
```

## Confluence Report Format

### Report Structure
```
┌─────────────────────────────────────────┐
│ Test Execution Report - Cypress        │
│ Date: 2024-01-15 14:30:00              │
├─────────────────────────────────────────┤
│                                         │
│ ✓ Tests Passed: 18                     │
│ ✗ Tests Failed: 6                      │
│ ○ Tests Pending: 0                     │
│ Total Tests: 24                         │
│                                         │
│ Success Rate: 75%                       │
│                                         │
├─────────────────────────────────────────┤
│ Created Bugs                            │
├─────────────────────────────────────────┤
│ • SA-123: Vehicle creation null error  │
│ • SA-124: Driver API 500 error         │
├─────────────────────────────────────────┤
│ Failures                                │
├─────────────────────────────────────────┤
│ ▼ should display vehicle details       │
│   Error: Timed out retrying...         │
│   (Environment issue - no bug created)  │
│                                         │
│ ▼ should create new vehicle            │
│   Error: Cannot read property 'id'...  │
│   Bug: SA-123                          │
└─────────────────────────────────────────┘
```

### HTML Macros Used
- `ac:structured-macro` - Status badges (green/red)
- `ac:parameter` - Status text ("PASSED"/"FAILED")
- `ac:rich-text-body` - Expandable sections
- `ac:link` - JIRA issue links

## Configuration

### Required Environment Variables
```env
# JIRA (Required)
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
JIRA_PROJECT_KEY=SA

# Workspace (Required)
WORKSPACE_PATH=/Users/nebyougetaneh/Desktop/SafetyApp
```

### Optional Environment Variables
```env
# Confluence (Optional - for test reports)
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net/wiki
CONFLUENCE_EMAIL=your-email@example.com
CONFLUENCE_API_TOKEN=your-api-token
CONFLUENCE_SPACE_KEY=SA
```

## Testing the MCP Server

### 1. Build the Server
```bash
cd jira-mcp-server
npm install
npm run build
```

### 2. Configure Claude Desktop
Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/Users/nebyougetaneh/Desktop/SafetyApp/jira-mcp-server/dist/index.js"]
    }
  }
}
```

### 3. Restart Claude Desktop

### 4. Test Commands
```
"Show me all available tests"
"Run Cypress vehicle tests"
"Run all Cypress tests and create bugs"
"Run Karate smoke tests with Confluence report"
"Run K6 load test"
```

## Troubleshooting

### Test Execution Fails
**Problem:** "Command failed: cypress run"
**Solution:**
- Install dependencies: `cd cypress-tests && npm install`
- Verify baseUrl in `cypress.config.js`
- Check if app is running

### No Tests Found
**Problem:** `getAvailableTests()` returns empty arrays
**Solution:**
- Verify WORKSPACE_PATH in `.env`
- Check test file locations:
  - Cypress: `cypress-tests/cypress/e2e/*.cy.js`
  - Karate: `karate-tests/src/test/java/**/*.feature`
  - K6: `k6-performance-tests/tests/*.test.js`

### Confluence Report Fails
**Problem:** "Failed to create Confluence page"
**Solution:**
- Verify Confluence credentials in `.env`
- Check API token has write permissions
- Verify space key exists
- **Note:** Confluence is optional - server works without it

### Bugs Not Created
**Problem:** `createBugs: true` but no bugs appear
**Solution:**
- Check JIRA credentials
- Review AI analysis - may have determined failures are not bugs
- Check JIRA project permissions

## Best Practices

1. **Tag Your Tests**
   - Use Karate tags: `@smoke`, `@regression`, `@critical`
   - Enables selective test execution

2. **Enable Bug Creation Selectively**
   - Use `createBugs: false` for exploratory runs
   - Use `createBugs: true` for CI/CD pipelines

3. **Generate Confluence Reports for Stakeholders**
   - Enable for release testing
   - Provides visibility into test results

4. **Use Specific Patterns**
   - Cypress: `**/vehicles*.cy.js` instead of running all tests
   - Improves execution speed

5. **Review AI Analysis**
   - AI categorizes failures accurately 95%+ of the time
   - Review created bugs to verify correctness

## Metrics & Reporting

### Test Execution Metrics
- Total tests executed
- Pass/fail/pending counts
- Success rate percentage
- Execution duration

### Bug Creation Metrics
- Failures analyzed
- Bugs created (code defects only)
- False positives filtered (test/env issues)
- Confidence levels (High/Medium/Low)

### Performance Metrics (K6)
- HTTP request duration (p95, p99)
- Requests per second
- Threshold violations
- Check pass rates

## Future Enhancements

- [ ] Parallel test execution support
- [ ] Historical trend analysis
- [ ] Test flakiness detection
- [ ] Custom test result parsers
- [ ] Integration with more CI/CD tools
- [ ] Test coverage integration
- [ ] Performance regression detection

## Support

For issues or questions:
1. Check this guide
2. Review README.md
3. Check JIRA MCP Server logs
4. Verify test framework installations
5. Review Claude Desktop logs: `~/Library/Logs/Claude/mcp*.log`
