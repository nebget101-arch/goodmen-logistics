import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GitHubService } from './services/github-service.js';
import { ConfluenceService } from './services/confluence-service.js';
import { ConfluenceService as LogsConfluenceService } from './services/logs-confluence-service.js';
import { JiraService } from './services/jira-service.js';
import { LogsService } from './services/logs-service.js';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize services
const githubService = new GitHubService(
  process.env.GITHUB_TOKEN!,
  process.env.GITHUB_OWNER!,
  process.env.GITHUB_REPO!,
  process.env.WORKFLOW_FILE!
);

const confluenceService = new ConfluenceService(
  process.env.CONFLUENCE_BASE_URL!,
  process.env.CONFLUENCE_EMAIL!,
  process.env.CONFLUENCE_API_TOKEN!,
  process.env.CONFLUENCE_SPACE_KEY!
);

const logsConfluenceService = new LogsConfluenceService({
  baseUrl: process.env.CONFLUENCE_BASE_URL!,
  email: process.env.CONFLUENCE_EMAIL!,
  apiToken: process.env.CONFLUENCE_API_TOKEN!,
  spaceKey: process.env.CONFLUENCE_SPACE_KEY!
});

const jiraService = new JiraService({
  baseUrl: process.env.JIRA_BASE_URL!,
  email: process.env.JIRA_EMAIL!,
  apiToken: process.env.JIRA_API_TOKEN!,
  projectKey: process.env.JIRA_PROJECT_KEY!
});

const logsService = new LogsService(process.env.BACKEND_PATH!);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    services: ['github', 'confluence', 'logs', 'jira'] 
  });
});

// GitHub Actions endpoints
app.post('/github/trigger-workflow', async (req, res) => {
  try {
    const { branch = 'main', workflow, inputs } = req.body;
    const result = await githubService.triggerWorkflow(branch, workflow, inputs);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/github/workflow-runs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const branch = req.query.branch as string;
    const workflow = req.query.workflow as string;
    const result = await githubService.getWorkflowRuns(limit, branch, workflow);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/github/workflow-runs/:runId', async (req, res) => {
  try {
    const runId = parseInt(req.params.runId);
    const result = await githubService.getWorkflowRunDetails(runId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/github/workflow-runs/:runId/rerun', async (req, res) => {
  try {
    const runId = parseInt(req.params.runId);
    const result = await githubService.rerunWorkflow(runId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/github/workflow-runs/:runId', async (req, res) => {
  try {
    const runId = parseInt(req.params.runId);
    const result = await githubService.cancelWorkflowRun(runId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Confluence endpoints
app.post('/confluence/create-page', async (req, res) => {
  try {
    const { title, content, parentId } = req.body;
    const result = await confluenceService.createPage(title, content, parentId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/confluence/update-page/:pageId', async (req, res) => {
  try {
    const pageId = req.params.pageId;
    const { title, content } = req.body;
    const result = await confluenceService.updatePage(pageId, title, content);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/confluence/pages', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 25;
    const result = await confluenceService.getPages(limit);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Logs Service endpoints
app.get('/logs/fetch', async (req, res) => {
  try {
    const query = {
      level: req.query.level as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      apiPath: req.query.apiPath as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined
    };
    const logs = await logsService.fetchLogs(query);
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/logs/daily-report', async (req, res) => {
  try {
    const { date, includeErrors = true, includeStats = true } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'date is required' });
    }
    const report = await logsService.generateDailyReport({ date, includeErrors, includeStats });
    res.json({ report });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/logs/backend', async (req, res) => {
  try {
    const backendUrl = process.env.BACKEND_PATH || 'https://safetyapp-ln58.onrender.com';
    const response = await axios.get(`${backendUrl}/api/health`);
    res.json({ success: true, data: response.data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/logs/post-to-confluence', async (req, res) => {
  try {
    const { pageTitle, logs, pageId, parentPageId } = req.body;
    const result = await logsConfluenceService.postLogs({
      pageTitle,
      logs,
      pageId,
      parentPageId
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Jira Service endpoints
app.post('/jira/create-issue', async (req, res) => {
  try {
    const result = await jiraService.createIssue(req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/jira/issues', async (req, res) => {
  try {
    const jql = req.query.jql as string;
    const maxResults = parseInt(req.query.maxResults as string) || 50;
    const result = await jiraService.searchIssues(jql, maxResults);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/jira/issues/:issueKey', async (req, res) => {
  try {
    const result = await jiraService.getIssue(req.params.issueKey);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 MCP HTTP Gateway running on port ${PORT}`);
  console.log(`   GitHub Actions: ✅`);
  console.log(`   Confluence: ✅`);
  console.log(`   Logs Service: ✅`);
  console.log(`   Jira: ✅`);
});
