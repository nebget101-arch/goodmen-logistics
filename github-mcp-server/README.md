# GitHub Actions MCP Server

MCP server for triggering and monitoring GitHub Actions workflows, specifically for running Cypress tests.

## Features

- ✅ **Trigger Cypress Tests** - Run tests on any branch via GitHub Actions
- 📊 **Monitor Workflow Runs** - Get status of recent test runs
- 🔍 **View Detailed Results** - Inspect individual workflow runs and job steps
- 📝 **Access Logs** - Download workflow run logs
- ♻️ **Re-run Failed Tests** - Automatically retry failed workflows
- ❌ **Cancel Runs** - Stop running workflows

## Setup

### 1. Install Dependencies

```bash
cd github-mcp-server
npm install
```

### 2. Create GitHub Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a name: "MCP Server - GitHub Actions"
4. Select scopes:
   - ✅ `repo` (Full control of private repositories)
   - ✅ `workflow` (Update GitHub Action workflows)
5. Click "Generate token"
6. Copy the token (you won't see it again!)

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
GITHUB_TOKEN=ghp_your_token_here
GITHUB_OWNER=your_github_username
GITHUB_REPO=SafetyApp
WORKFLOW_FILE=test-and-deploy.yml
```

### 4. Build the Server

```bash
npm run build
```

### 5. Add to Claude Desktop Config

Edit your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "github-actions": {
      "command": "node",
      "args": ["/Users/nebyougetaneh/Desktop/SafetyApp/github-mcp-server/dist/index.js"]
    }
  }
}
```

### 6. Restart Claude Desktop

The MCP server will now be available in Claude!

## Available Tools

### 1. `trigger_cypress_tests`
Trigger Cypress tests on a specific branch.

**Parameters:**
- `branch` (string, optional): Branch name (default: "main")

**Example:**
```
"Can you trigger the Cypress tests on the dev branch?"
```

### 2. `get_workflow_runs`
Get recent workflow runs with their status.

**Parameters:**
- `limit` (number, optional): Number of runs to retrieve (default: 10)
- `branch` (string, optional): Filter by branch name

**Example:**
```
"Show me the last 5 test runs on main branch"
```

### 3. `get_workflow_run_details`
Get detailed information about a specific workflow run.

**Parameters:**
- `run_id` (number, required): Workflow run ID

**Example:**
```
"Show me the details of workflow run 123456"
```

### 4. `get_workflow_run_logs`
Get logs from a specific workflow run.

**Parameters:**
- `run_id` (number, required): Workflow run ID

**Example:**
```
"Get the logs for workflow run 123456"
```

### 5. `cancel_workflow_run`
Cancel a running workflow.

**Parameters:**
- `run_id` (number, required): Workflow run ID to cancel

**Example:**
```
"Cancel the running workflow 123456"
```

### 6. `rerun_workflow`
Re-run a failed workflow.

**Parameters:**
- `run_id` (number, required): Workflow run ID to re-run

**Example:**
```
"Re-run the failed workflow 123456"
```

## Usage Examples

### Trigger Tests Before Deployment
```
"Run the Cypress tests on the dev branch to verify the latest changes"
```

### Check Test Status
```
"What's the status of the latest test run?"
```

### Investigate Failures
```
"Show me the details of the last failed test run"
```

### Retry Failed Tests
```
"Re-run the latest failed workflow"
```

## Workflow Integration

The MCP server works with your GitHub Actions workflow (`.github/workflows/test-and-deploy.yml`) to:

1. **Trigger on demand** - Run tests without pushing code
2. **Monitor status** - Track test execution in real-time
3. **Debug failures** - Access detailed logs and step results
4. **Automate retries** - Re-run flaky tests instantly

## Troubleshooting

### "Failed to trigger workflow"
- Verify your GitHub token has `workflow` scope
- Check that the repository and workflow file names are correct
- Ensure the branch exists

### "MCP server not showing in Claude"
- Verify the path in `claude_desktop_config.json` is absolute
- Check that `npm run build` completed successfully
- Restart Claude Desktop completely

### "Permission denied"
- Ensure your GitHub token has access to the repository
- For organization repos, check organization permissions

## Development

### Watch Mode
```bash
npm run watch
```

### Rebuild
```bash
npm run build
```

## Security Notes

⚠️ **Never commit `.env` file** - It contains your GitHub token
✅ Store your token securely
✅ Use a token with minimal required scopes
✅ Rotate tokens periodically
