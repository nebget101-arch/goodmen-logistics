# Remote MCP Proxy

MCP server that proxies requests to the remote HTTP API gateway.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build:
```bash
npm run build
```

3. Configure Claude Desktop to use this proxy (see below)

## Claude Desktop Configuration

Add this to your `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "remote-gateway": {
      "command": "node",
      "args": [
        "/Users/nebyougetaneh/Desktop/SafetyApp/remote-mcp-proxy/dist/index.js"
      ],
      "env": {
        "REMOTE_API_URL": "https://mcp-http-gateway-867b.onrender.com"
      }
    }
  }
}
```

## Available Tools

All tools from the remote gateway are available:

**GitHub Actions:**
- `trigger_github_workflow` - Trigger workflow runs
- `get_workflow_runs` - List recent runs
- `get_workflow_run_details` - Get run details
- `rerun_workflow` - Re-run failed workflows
- `cancel_workflow` - Cancel running workflows

**Confluence:**
- `create_confluence_page` - Create new pages
- `update_confluence_page` - Update existing pages
- `post_logs_to_confluence` - Post application logs

**Jira:**
- `create_jira_issue` - Create new issues
- `search_jira_issues` - Search with JQL
- `get_jira_issue` - Get issue details

## How It Works

1. Claude Desktop connects to this proxy via stdio
2. Proxy receives MCP tool calls
3. Proxy forwards requests to remote HTTP API at `https://mcp-http-gateway-867b.onrender.com`
4. Proxy returns responses to Claude Desktop

This allows Claude to use the remote API while maintaining the MCP protocol interface.
