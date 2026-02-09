# Jira MCP Server with Test Automation

Intelligent Jira integration for creating user stories, epics, and bugs with automatic codebase analysis, test failure detection, and comprehensive test automation orchestration.

## Features

### 🎯 Smart User Story Creation
- **Automatic codebase analysis**: Scans your code to find relevant files
- **Component detection**: Identifies affected components (drivers, vehicles, HOS, etc.)
- **Complexity estimation**: Calculates story points based on impact
- **Implementation suggestions**: Provides recommended approach

### 📊 Epic Management
- Create epics to group related stories
- Link stories to epics automatically

### 🐛 Intelligent Bug Detection
- **AI-powered analysis**: Determines if test failures are actual bugs
- **Filters false positives**: Identifies test/environment issues vs real bugs
- **Severity assessment**: Automatically assigns bug severity
- **Root cause analysis**: Provides detailed bug analysis
- **Batch processing**: Analyze all test failures at once

### 🧪 Test Automation (NEW)
- **Multi-framework support**: Execute Cypress, Karate, and K6 tests
- **Intelligent test discovery**: List all available test specs across frameworks
- **Selective execution**: Run specific tests using patterns and tags
- **Automated bug creation**: Create JIRA bugs for genuine test failures (not flaky tests)
- **Confluence reporting**: Generate formatted test execution reports
- **Claude integration**: Run tests via natural language commands

## Setup

1. **Install dependencies:**
   ```bash
   cd jira-mcp-server
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Jira credentials
   ```

3. **Build the server:**
   ```bash
   npm run build
   ```

4. **Add to Claude Desktop config:**
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

## Configuration

Edit `.env` file:

```env
# Jira Configuration
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-jira-api-token
JIRA_PROJECT_KEY=SA

# Codebase Configuration
WORKSPACE_PATH=/Users/nebyougetaneh/Desktop/SafetyApp

# Test Results Path
TEST_RESULTS_PATH=/Users/nebyougetaneh/Desktop/SafetyApp/k6-performance-tests/reports

# Confluence Configuration (Optional - for test reports)
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net/wiki
CONFLUENCE_EMAIL=your-email@example.com
CONFLUENCE_API_TOKEN=your-confluence-api-token
CONFLUENCE_SPACE_KEY=SA
```

### Getting Jira API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Copy the token to your `.env` file

### Getting Confluence API Token (Optional)

Use the same API token as Jira, or create a separate one following the same steps.

## Usage Examples

### Create User Story
```
"Create a user story for: Add driver license expiration alerts"
```

The server will:
- Analyze codebase to find driver-related files
- Estimate complexity
- Suggest implementation approach
- Create story with all details

### Create Epic
```
"Create an epic for Driver Safety Features with description: Implement comprehensive driver safety monitoring and compliance features"
```

### Run Tests via Claude

**List available tests:**
```
"Show me all available tests in the workspace"
```

**Run Cypress vehicle tests:**
```
"Run Cypress tests for vehicles"
```

**Run specific Cypress spec:**
```
"Run the vehicle details spec in Cypress"
```

**Run Karate API tests with tag:**
```
"Run Karate tests tagged with @smoke"
```

**Run K6 performance tests:**
```
"Run the K6 smoke test"
```

### Automated Bug Creation & Reporting

**Run tests and create bugs:**
```
"Run Cypress vehicle tests, create bugs for failures, and generate a Confluence report"
```

The server will:
- Execute specified tests
- Parse test results
- Analyze each failure using AI
- Create JIRA bugs only for actual defects (not flaky tests)
- Generate formatted Confluence page with test summary and bug links

**Run all test suites with full reporting:**
```
"Run all Cypress tests with bug creation and Confluence documentation"
```

### Analyze Test Failures
```
"Analyze all test failures and create bugs for actual defects"
```

The server will:
- Scan test results
- Determine which failures are real bugs
- Filter out test/environment issues
- Create Jira bugs for confirmed defects

### Check Specific Test Failure
```
"Analyze this test failure: test name 'Driver API returns 500', error 'null pointer exception in getDriverById'"
```

The server will analyze and tell you if it's a real bug or not.

## MCP Tools

### Test Automation Tools (NEW)

#### list_available_tests
Lists all available test specs across all frameworks.

**Returns:**
- Cypress specs (e.g., `vehicles.cy.js`, `drivers.cy.js`)
- Karate features (e.g., `vehicles.feature`, `drivers.feature`)
- K6 scripts (e.g., `smoke.test.js`, `load.test.js`)

**Example:**
```
"Show me all available tests"
```

#### run_cypress_tests
Executes Cypress E2E tests with optional filtering.

**Parameters:**
- `specPattern` (optional): Glob pattern to filter specs (e.g., `**/vehicles*.cy.js`)
- `createBugs` (optional): Create JIRA bugs for failures (default: false)
- `createConfluenceReport` (optional): Generate Confluence test report (default: false)

**Returns:**
- Test execution summary (passed/failed/pending)
- Failure details with error messages
- Created bug keys (if enabled)
- Confluence page URL (if enabled)

**Examples:**
```
"Run Cypress vehicle tests"
"Run all Cypress tests and create bugs"
"Run Cypress tests matching **/drivers*.cy.js with Confluence report"
```

#### run_karate_tests
Executes Karate API tests with optional tag filtering.

**Parameters:**
- `tag` (optional): Karate tag to filter tests (e.g., `@smoke`, `@regression`)
- `createBugs` (optional): Create JIRA bugs for failures (default: false)
- `createConfluenceReport` (optional): Generate Confluence test report (default: false)

**Returns:**
- Test execution summary (passed/failed)
- Failure details
- Created bug keys (if enabled)
- Confluence page URL (if enabled)

**Examples:**
```
"Run Karate smoke tests"
"Run all Karate tests tagged @regression with bug creation"
"Execute Karate API tests and generate Confluence report"
```

#### run_k6_tests
Executes K6 performance tests.

**Parameters:**
- `scriptPath` (optional): Path to specific K6 script (e.g., `smoke.test.js`, `load.test.js`)
- `createConfluenceReport` (optional): Generate Confluence test report (default: false)

**Returns:**
- Performance test summary (checks passed/failed, request metrics)
- Threshold violations
- Confluence page URL (if enabled)

**Examples:**
```
"Run K6 smoke test"
"Execute K6 load test and create Confluence report"
"Run all K6 performance tests"
```

### Story & Epic Tools

#### create_user_story
Creates user story with codebase analysis.

**Parameters:**
- `requirement` (required): Story description
- `acceptanceCriteria`: List of acceptance criteria
- `priority`: Highest/High/Medium/Low/Lowest
- `epicKey`: Parent epic (e.g., "SA-123")
- `labels`: Tags for categorization

#### create_epic
Creates epic to group stories.

**Parameters:**
- `title` (required): Epic name
- `description` (required): Epic goals and scope
- `labels`: Tags

### Bug Analysis Tools

#### create_bug_from_test_failure
Analyzes test failure and optionally creates bug.

**Parameters:**
- `testName` (required): Name of failing test
- `errorMessage` (required): Error message
- `stackTrace`: Optional stack trace
- `testFile`: Optional test file path
- `autoCreate`: Auto-create bug if confirmed (default: false)

#### analyze_all_test_failures
Scans all test results and analyzes failures.

**Parameters:**
- `createBugs`: Auto-create bugs for confirmed defects (default: false)

### Search Tools

#### search_jira_issues
Search Jira using JQL.

**Parameters:**
- `jql` (required): JQL query
- `maxResults`: Max results (default: 20)

## How It Works

### Test Automation Flow (NEW)
1. **Test Discovery**: Scans workspace for Cypress/Karate/K6 test files
2. **Test Execution**: Runs tests using native test runners (cypress run, mvn test, k6 run)
3. **Result Parsing**: Extracts test counts, failures, error messages from test output
4. **AI Analysis**: Each failure analyzed to determine if it's a real bug or test/environment issue
5. **Bug Creation**: Creates JIRA bugs only for confirmed code defects (filters flaky tests)
6. **Confluence Reporting**: Generates formatted HTML report with:
   - Test execution summary with pass/fail counts
   - Success rate calculations
   - Expandable failure details
   - Links to created JIRA bugs
   - Status macros (green/red badges)

### Codebase Analysis
1. Extracts keywords from requirement
2. Searches project files for matches
3. Identifies affected components
4. Estimates complexity based on impact
5. Generates implementation approach

### Bug Detection
1. Analyzes error messages and patterns
2. Categorizes as:
   - **Code Defect**: Real bugs (creates ticket)
   - **Test Issue**: Test needs fixing
   - **Environment Issue**: Temporary/infrastructure
   - **Configuration Issue**: Settings problem
3. Assigns confidence level (High/Medium/Low)
4. Only creates bugs for confirmed defects

### Severity Assessment
- **Critical**: 5xx errors, crashes
- **High**: Null pointers, type errors, 4xx errors
- **Medium**: Assertion failures
- **Low**: Timeouts, flaky tests

## Example Workflows

### Test Automation Workflow (NEW)
1. **Discovery**: `"Show me all available tests"`
2. **Selective Execution**: `"Run Cypress vehicle tests"`
3. **Automated Triage**: `"Run all Cypress tests and create bugs for failures"`
4. **Documentation**: `"Run Karate API tests with Confluence report"`
5. **Performance Monitoring**: `"Run K6 smoke test and create report"`

**Complete CI/CD Integration:**
```
"Run all Cypress tests, create bugs for failures, and generate Confluence report"
```
This will:
- Execute entire Cypress test suite
- Parse all failures
- Use AI to filter real bugs from flaky tests
- Create JIRA bugs with detailed descriptions
- Generate formatted Confluence page with summary and bug links

### Feature Development Workflow
1. Create epic: `"Create epic for Vehicle Maintenance Module"`
2. Create stories: `"Create user story: Add vehicle inspection scheduling"`
3. Link stories to epic using returned epic key

### Bug Triage Workflow
1. Run tests
2. Analyze failures: `"Analyze all test failures"`
3. Review which are real bugs vs test issues
4. Create bugs: `"Analyze all test failures and create bugs for actual defects"`

## Tips

- The server learns from your codebase structure
- More descriptive requirements = better analysis
- Use specific error messages for accurate bug detection
- Review analysis before auto-creating bugs
- Use labels to categorize issues
- **Test Automation:**
  - Use `specPattern` for targeted Cypress test execution (e.g., `**/vehicles*.cy.js`)
  - Use Karate `@tags` to organize and filter API tests (e.g., `@smoke`, `@regression`)
  - Enable `createBugs` only when you want automatic JIRA tickets (saves manual triage)
  - Enable `createConfluenceReport` for stakeholder visibility and documentation
  - Confluence integration is optional - server works without it

## Troubleshooting

**Issue: "Failed to create Jira issue"**
- Check Jira credentials in `.env`
- Verify project key exists
- Check API token permissions

**Issue: "No test failures found"**
- Verify TEST_RESULTS_PATH points to correct directory
- Ensure tests have been run and reports exist

**Issue: "Component not detected"**
- Add more keywords to requirement description
- Components detected: drivers, vehicles, hos, loads, audit, maintenance

**Issue: "Test execution failed"**
- Ensure test frameworks are installed:
  - Cypress: `cd cypress-tests && npm install`
  - Karate: Requires Java 17 and Maven
  - K6: Install from https://k6.io/docs/getting-started/installation/
- Check WORKSPACE_PATH points to correct directory
- Verify test paths in test runner service

**Issue: "Confluence report creation failed"**
- Check Confluence credentials in `.env` (optional feature)
- Verify CONFLUENCE_SPACE_KEY exists
- API token needs write permissions
- Server continues to work without Confluence configured
