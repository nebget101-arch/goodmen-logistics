# Jira MCP Server

Intelligent Jira integration for creating user stories, epics, and bugs with automatic codebase analysis and test failure detection.

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
WORKSPACE_PATH=/Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics

# Test Results Path
TEST_RESULTS_PATH=/Users/nebyougetaneh/Desktop/SafetyApp/k6-performance-tests/reports
```

### Getting Jira API Token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Copy the token to your `.env` file

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

### create_user_story
Creates user story with codebase analysis.

**Parameters:**
- `requirement` (required): Story description
- `acceptanceCriteria`: List of acceptance criteria
- `priority`: Highest/High/Medium/Low/Lowest
- `epicKey`: Parent epic (e.g., "SA-123")
- `labels`: Tags for categorization

### create_epic
Creates epic to group stories.

**Parameters:**
- `title` (required): Epic name
- `description` (required): Epic goals and scope
- `labels`: Tags

### create_bug_from_test_failure
Analyzes test failure and optionally creates bug.

**Parameters:**
- `testName` (required): Name of failing test
- `errorMessage` (required): Error message
- `stackTrace`: Optional stack trace
- `testFile`: Optional test file path
- `autoCreate`: Auto-create bug if confirmed (default: false)

### analyze_all_test_failures
Scans all test results and analyzes failures.

**Parameters:**
- `createBugs`: Auto-create bugs for confirmed defects (default: false)

### search_jira_issues
Search Jira using JQL.

**Parameters:**
- `jql` (required): JQL query
- `maxResults`: Max results (default: 20)

## How It Works

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
