a# MCP HTTP Gateway

REST API gateway exposing MCP server functionality remotely.

## Features

- 🌐 **REST API** - Access all MCP tools via HTTP endpoints
- 🔐 **Secure** - Token-based authentication
- 🚀 **Deploy Anywhere** - Render, Vercel, AWS, etc.
- 📡 **Remote Access** - Use from anywhere, not just locally
- 🔧 **All Services** - GitHub, Confluence, Jira, Logs

## Quick Start

### 1. Install Dependencies

```bash
cd mcp-http-gateway
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your tokens
```

### 3. Build and Run

```bash
npm run build
npm start
```

Server runs on `http://localhost:3001`

## API Endpoints

### GitHub Actions

**Trigger Workflow**
```bash
POST /github/trigger-workflow
Body: { "branch": "main" }
```

**Get Workflow Runs**
```bash
GET /github/workflow-runs?limit=10&branch=main
```

**Get Run Details**
```bash
GET /github/workflow-runs/:runId
```

**Re-run Workflow**
```bash
POST /github/workflow-runs/:runId/rerun
```

**Cancel Workflow**
```bash
DELETE /github/workflow-runs/:runId
```

### Confluence

**Create Page**
```bash
POST /confluence/create-page
Body: {
  "title": "Page Title",
  "content": "<p>HTML content</p>",
  "parentId": "optional-parent-id"
}
```

**Update Page**
```bash
PUT /confluence/update-page/:pageId
Body: {
  "title": "Updated Title",
  "content": "<p>Updated content</p>"
}
```

**List Pages**
```bash
GET /confluence/pages?limit=25
```

### Logs Service

**Get Backend Health**
```bash
GET /logs/backend
```

**Post Logs to Confluence**
```bash
POST /logs/post-to-confluence
Body: {
  "pageTitle": "Application Logs",
  "logs": "Log content here...",
  "pageId": "optional-existing-page-id",
  "parentPageId": "optional-parent-page-id"
}
```

### Jira

**Create Issue**
```bash
POST /jira/create-issue
Body: {
  "summary": "Bug in login",
  "description": "Users cannot log in",
  "issueType": "Bug",
  "priority": "High",
  "labels": ["backend", "authentication"]
}
```

**Search Issues**
```bash
GET /jira/issues?jql=project=KAN&maxResults=50
```

**Get Issue**
```bash
GET /jira/issues/:issueKey
```

**Update Issue**
```bash
PUT /jira/issues/:issueKey
Body: {
  "summary": "Updated summary",
  "description": "Updated description"
}
```

## Deploy to Render

### Step 1: Configure Secrets in Render Dashboard

🔐 **IMPORTANT**: Never commit sensitive tokens to your repository!

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Select your service (or create new)
3. Go to **Environment** tab
4. Add the following **Secret Files** or **Environment Variables**:

**Required Secrets:**
- `GITHUB_TOKEN` - Your GitHub Personal Access Token
- `CONFLUENCE_API_TOKEN` - Your Confluence API token
- `CONFLUENCE_EMAIL` - Your Atlassian email
- `JIRA_API_TOKEN` - Your Jira API token
- `JIRA_EMAIL` - Your Atlassian email

**Non-Sensitive Variables:**
- `GITHUB_OWNER` - Your GitHub username
- `GITHUB_REPO` - Your repository name
- `WORKFLOW_FILE` - test-and-deploy.yml
- `CONFLUENCE_BASE_URL` - https://your-domain.atlassian.net/wiki
- `CONFLUENCE_SPACE_KEY` - Your Confluence space key
- `JIRA_BASE_URL` - https://your-domain.atlassian.net
- `JIRA_PROJECT_KEY` - Your Jira project key
- `BACKEND_PATH` - https://your-backend.onrender.com
- `PORT` - 3001

### Step 2: Deploy Options

#### Option 1: Using render.yaml (Recommended)

Your `render.yaml` already includes the service. Just:
1. Push code to GitHub
2. Render auto-deploys
3. Add secrets in Render dashboard (Step 1)

#### Option 2: Manual Deploy

1. Push code to GitHub
2. Go to Render Dashboard
3. New Web Service → Connect repository
4. Set root directory to `mcp-http-gateway`
5. Build command: `npm install && npm run build`
6. Start command: `npm start`
7. Add environment variables from Step 1
8. Deploy!

## Usage from Claude (or any client)

Once deployed, you can use cURL, fetch, or any HTTP client:

```bash
# Trigger tests
curl -X POST https://your-gateway.onrender.com/github/trigger-workflow \
  -H "Content-Type: application/json" \
  -d '{"branch": "dev"}'

# Get workflow runs
curl https://your-gateway.onrender.com/github/workflow-runs?limit=5

# Create Confluence page
curl -X POST https://your-gateway.onrender.com/confluence/create-page \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Results",
    "content": "<h1>Results</h1><p>All tests passed!</p>"
  }'
```

## Security

⚠️ **Add authentication** before deploying publicly!

Simple API key example:

```typescript
app.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

## Local Development

```bash
npm run dev
```

Test with:
```bash
curl http://localhost:3001/health
```
