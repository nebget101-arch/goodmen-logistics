# Goodmen Logistics Logs MCP Server

An MCP (Model Context Protocol) server that reads application logs from the Goodmen Logistics backend and posts them to Confluence.

## Features

- 📊 **Fetch Application Logs**: Query logs by date, level, or API endpoint
- 📝 **Post to Confluence**: Create or update Confluence pages with log data
- 📈 **Daily Reports**: Generate automated daily log reports with statistics
- 🔍 **Filter & Search**: Find specific logs by criteria
- ⚡ **Real-time**: Read logs from running application

## Setup

### 1. Install Dependencies

```bash
cd /Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logs-mcp-server
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your Confluence credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net
CONFLUENCE_EMAIL=your-email@example.com
CONFLUENCE_API_TOKEN=your-confluence-api-token
CONFLUENCE_SPACE_KEY=YOUR_SPACE

BACKEND_PATH=/Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics/backend
```

#### Getting Confluence API Token:

1. Go to: https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Give it a name (e.g., "Goodmen Logs MCP")
4. Copy the token and paste it in `.env`

### 3. Build the Server

```bash
npm run build
```

### 4. Configure in Claude Desktop

Add to your Claude Desktop MCP settings (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "goodmen-logs": {
      "command": "node",
      "args": [
        "/Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logs-mcp-server/build/index.js"
      ],
      "env": {
        "CONFLUENCE_BASE_URL": "https://your-domain.atlassian.net",
        "CONFLUENCE_EMAIL": "your-email@example.com",
        "CONFLUENCE_API_TOKEN": "your-api-token",
        "CONFLUENCE_SPACE_KEY": "YOUR_SPACE",
        "BACKEND_PATH": "/Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics/backend"
      }
    }
  }
}
```

### 5. Restart Claude Desktop

After adding the configuration, restart Claude Desktop to load the MCP server.

## Available Tools

### 1. `get_app_logs`

Fetch application logs with optional filters.

**Parameters:**
- `level` (optional): Filter by log level (INFO, ERROR, WARN, all)
- `startDate` (optional): Start date (YYYY-MM-DD)
- `endDate` (optional): End date (YYYY-MM-DD)
- `apiPath` (optional): Filter by API path (e.g., /api/drivers)
- `limit` (optional): Maximum number of entries (default: 100)

**Example:**
```
Get all ERROR logs from yesterday
```

### 2. `post_logs_to_confluence`

Post formatted logs to a Confluence page.

**Parameters:**
- `pageTitle` (required): Title for the Confluence page
- `logs` (required): Log data (JSON or formatted text)
- `pageId` (optional): Existing page ID to update
- `parentPageId` (optional): Parent page ID for new pages

**Example:**
```
Create a Confluence page titled "API Errors - Feb 7, 2026" with the error logs
```

### 3. `create_daily_log_report`

Generate and post a comprehensive daily log report.

**Parameters:**
- `date` (optional): Date for report (YYYY-MM-DD), defaults to today
- `includeErrors` (optional): Include detailed error logs (default: true)
- `includeStats` (optional): Include statistics (default: true)

**Example:**
```
Generate a daily log report for today and post it to Confluence
```

## Usage Examples in Claude

Once configured, you can ask Claude:

1. **View recent logs:**
   ```
   Show me the last 50 application logs
   ```

2. **Find errors:**
   ```
   Get all ERROR level logs from the past 24 hours
   ```

3. **Post to Confluence:**
   ```
   Take the error logs and create a Confluence page titled "Production Errors - Feb 7"
   ```

4. **Generate daily report:**
   ```
   Create a daily log report for today and post it to Confluence
   ```

5. **Specific API tracking:**
   ```
   Show me all logs related to /api/drivers from yesterday
   ```

## Development

### Watch mode (auto-rebuild):

```bash
npm run watch
```

### Test locally:

```bash
npm run dev
```

## Extending the Server

To add more functionality:

1. **Add a new tool** in `src/index.ts` (under `setupToolHandlers()`)
2. **Add service methods** in `src/services/logs-service.ts` or `confluence-service.ts`
3. **Rebuild**: `npm run build`
4. **Restart Claude Desktop**

## Troubleshooting

### "Failed to fetch logs"
- Ensure the Goodmen backend is running on `localhost:3000`
- Check `BACKEND_PATH` is correct in `.env`

### "Failed to post to Confluence"
- Verify your Confluence API token is valid
- Check `CONFLUENCE_BASE_URL` format (should be `https://your-domain.atlassian.net`)
- Ensure you have write permissions in the specified Confluence space

### "Server not showing in Claude"
- Verify the path in `claude_desktop_config.json` is correct
- Check the server built successfully (`npm run build`)
- Restart Claude Desktop completely

## License

MIT
