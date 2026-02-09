# Dynatrace Orchestration for All Services

This guide shows how to orchestrate monitoring for all your Render services using Dynatrace.

## Overview of Services

| Service | Type | Port | Purpose |
|---------|------|------|---------|
| safetyapp | Node.js + Angular | 10000 | Main application (backend + frontend) |
| goodmen-logs-mcp | Node.js | - | MCP logs server (stdio) |
| mcp-http-gateway | Node.js | 10001 | HTTP gateway for MCP tools |
| safetyapp-db | PostgreSQL | - | Database |

## Step 1: Dynatrace Environment Setup

### 1.1 Create Application Monitoring in Dynatrace

1. Log into your Dynatrace environment: `https://{your-env}.live.dynatrace.com`
2. Go to **Deploy Dynatrace > Start installation**
3. Select **Platform as a Service (PaaS)** for cloud deployments

### 1.2 Get Required Tokens

You need 3 types of tokens:

**A. PaaS Token** (for OneAgent installation)
- Navigate to: **Settings > Integration > Platform as a Service**
- Click **Generate new token**
- Name: `Render-Services-PaaS`
- Copy the token

**B. API Token** (for API access and logs)
- Navigate to: **Settings > Integration > Dynatrace API**
- Click **Generate token**
- Name: `Render-Services-API`
- Required scopes:
  - ✅ `DataExport`
  - ✅ `logs.ingest`
  - ✅ `metrics.ingest`
  - ✅ `events.ingest`
  - ✅ `entities.read`
- Copy the token

**C. Environment URL**
- Format: `https://{your-env-id}.live.dynatrace.com`
- Example: `https://abc12345.live.dynatrace.com`

## Step 2: Configure Each Service

### 2.1 Main Application (safetyapp)

This service already has Dynatrace configured. Update the environment variables in Render:

1. Go to Render Dashboard → safetyapp service
2. Navigate to **Environment** tab
3. Add the following environment variables:

```bash
DYNATRACE_ENABLED=true
DYNATRACE_ENVIRONMENT_URL=https://abc12345.live.dynatrace.com
DYNATRACE_API_TOKEN=dt0c01.ABC123...
DYNATRACE_PAAS_TOKEN=dt0c01.XYZ789...
DYNATRACE_APP_NAME=SafetyApp-Backend
DYNATRACE_LOG_LEVEL=info
DYNATRACE_METADATA_TEAM=logistics
DYNATRACE_METADATA_ENVIRONMENT=production
```

4. Redeploy the service

**What gets monitored:**
- ✅ HTTP requests (response times, status codes)
- ✅ API endpoints performance
- ✅ Database queries
- ✅ Error tracking
- ✅ Custom business metrics
- ✅ Frontend RUM (Real User Monitoring)

### 2.2 MCP HTTP Gateway (mcp-http-gateway)

Add Dynatrace monitoring to the HTTP gateway:

**Step A: Install Dynatrace SDK**

Add to `mcp-http-gateway/package.json`:
```json
{
  "dependencies": {
    "@dynatrace/oneagent-sdk": "^1.5.0"
  }
}
```

**Step B: Create Dynatrace middleware**

Create `mcp-http-gateway/src/middleware/dynatrace.ts`:
```typescript
import axios from 'axios';

interface DynatraceConfig {
  enabled: boolean;
  environmentUrl: string;
  apiToken: string;
  appName: string;
}

const config: DynatraceConfig = {
  enabled: process.env.DYNATRACE_ENABLED === 'true',
  environmentUrl: process.env.DYNATRACE_ENVIRONMENT_URL || '',
  apiToken: process.env.DYNATRACE_API_TOKEN || '',
  appName: process.env.DYNATRACE_APP_NAME || 'MCP-HTTP-Gateway'
};

export async function logToDynatrace(level: string, message: string, metadata?: any) {
  if (!config.enabled || !config.apiToken) return;

  const logEntry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    content: message,
    'dt.source': config.appName,
    ...metadata
  };

  try {
    await axios.post(
      `${config.environmentUrl}/api/v2/logs/ingest`,
      {
        logs: [logEntry]
      },
      {
        headers: {
          'Authorization': `Api-Token ${config.apiToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('Failed to send log to Dynatrace:', error);
  }
}

export function dynatraceMiddleware(req: any, res: any, next: any) {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logToDynatrace('INFO', `HTTP ${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      service: 'mcp-http-gateway'
    });
  });

  next();
}
```

**Step C: Update mcp-http-gateway/src/index.ts**

Add near the top:
```typescript
import { dynatraceMiddleware } from './middleware/dynatrace';

// ... existing code ...

// Add Dynatrace middleware
app.use(dynatraceMiddleware);
```

**Step D: Add environment variables in Render**

```bash
DYNATRACE_ENABLED=true
DYNATRACE_ENVIRONMENT_URL=https://abc12345.live.dynatrace.com
DYNATRACE_API_TOKEN=dt0c01.ABC123...
DYNATRACE_APP_NAME=MCP-HTTP-Gateway
```

### 2.3 Logs MCP Server (goodmen-logs-mcp-server)

Since this is a stdio-based MCP server, monitor it differently:

**Option A: File-based logging with Dynatrace log forwarder**

Create `goodmen-logs-mcp-server/src/dynatrace-logger.ts`:
```typescript
import axios from 'axios';

export class DynatraceLogger {
  private config = {
    enabled: process.env.DYNATRACE_ENABLED === 'true',
    environmentUrl: process.env.DYNATRACE_ENVIRONMENT_URL || '',
    apiToken: process.env.DYNATRACE_API_TOKEN || '',
    appName: 'Logs-MCP-Server'
  };

  async log(level: 'INFO' | 'WARN' | 'ERROR', message: string, metadata?: any) {
    console.error(`[${level}] ${message}`); // Still log to stderr for MCP

    if (!this.config.enabled) return;

    try {
      await axios.post(
        `${this.config.environmentUrl}/api/v2/logs/ingest`,
        {
          logs: [{
            timestamp: new Date().toISOString(),
            level,
            content: message,
            'dt.source': this.config.appName,
            'log.source': '/var/log/mcp-server.log',
            ...metadata
          }]
        },
        {
          headers: {
            'Authorization': `Api-Token ${this.config.apiToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
    } catch (error) {
      // Silently fail - don't break MCP
    }
  }
}

export const dtLogger = new DynatraceLogger();
```

**Update goodmen-logs-mcp-server/src/index.ts:**
```typescript
import { dtLogger } from './dynatrace-logger';

// Replace console.error calls with:
dtLogger.log('INFO', 'MCP Server started');
dtLogger.log('ERROR', 'Failed to fetch logs', { error: err.message });
```

## Step 3: Database Monitoring

### 3.1 Enable PostgreSQL Extension Monitoring

Dynatrace can monitor your PostgreSQL database. Two options:

**Option A: Database Metrics via API**

Create a monitoring script that runs periodically:

`monitoring/db-metrics.js`:
```javascript
const { Client } = require('pg');
const axios = require('axios');

const DYNATRACE_URL = process.env.DYNATRACE_ENVIRONMENT_URL;
const DYNATRACE_TOKEN = process.env.DYNATRACE_API_TOKEN;

async function collectDBMetrics() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  await client.connect();

  // Get connection count
  const connections = await client.query(`
    SELECT count(*) as total FROM pg_stat_activity;
  `);

  // Get database size
  const dbSize = await client.query(`
    SELECT pg_database_size('goodmen_logistics') as size;
  `);

  // Get slow queries
  const slowQueries = await client.query(`
    SELECT count(*) as total 
    FROM pg_stat_statements 
    WHERE mean_exec_time > 1000;
  `);

  await client.end();

  // Send to Dynatrace
  const metrics = [
    {
      name: 'custom.database.connections',
      value: parseInt(connections.rows[0].total),
      timestamp: Date.now(),
      dimensions: {
        database: 'goodmen_logistics',
        service: 'safetyapp-db'
      }
    },
    {
      name: 'custom.database.size',
      value: parseInt(dbSize.rows[0].size),
      timestamp: Date.now(),
      dimensions: {
        database: 'goodmen_logistics'
      }
    }
  ];

  await axios.post(
    `${DYNATRACE_URL}/api/v2/metrics/ingest`,
    {
      metrics
    },
    {
      headers: {
        'Authorization': `Api-Token ${DYNATRACE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
}

// Run every 60 seconds
setInterval(collectDBMetrics, 60000);
collectDBMetrics(); // Initial run
```

**Option B: Query Performance Monitoring in Application**

Already implemented in your backend. The Dynatrace middleware tracks all database queries.

## Step 4: Service Health Checks

Create a unified health check endpoint that reports to Dynatrace:

`monitoring/health-check.js`:
```javascript
const axios = require('axios');

const services = [
  { name: 'safetyapp', url: 'https://safetyapp-ln58.onrender.com/api/health' },
  { name: 'mcp-http-gateway', url: 'https://mcp-http-gateway-867b.onrender.com/health' }
];

async function checkServices() {
  for (const service of services) {
    try {
      const start = Date.now();
      const response = await axios.get(service.url, { timeout: 10000 });
      const duration = Date.now() - start;

      // Send custom event to Dynatrace
      await axios.post(
        `${process.env.DYNATRACE_ENVIRONMENT_URL}/api/v2/events/ingest`,
        {
          eventType: 'CUSTOM_INFO',
          title: `${service.name} health check`,
          properties: {
            status: response.status === 200 ? 'UP' : 'DOWN',
            responseTime: duration,
            service: service.name
          }
        },
        {
          headers: {
            'Authorization': `Api-Token ${process.env.DYNATRACE_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      // Send alert
      await axios.post(
        `${process.env.DYNATRACE_ENVIRONMENT_URL}/api/v2/events/ingest`,
        {
          eventType: 'ERROR_EVENT',
          title: `${service.name} health check failed`,
          properties: {
            error: error.message,
            service: service.name
          }
        },
        {
          headers: {
            'Authorization': `Api-Token ${process.env.DYNATRACE_API_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
    }
  }
}

// Run every 5 minutes
setInterval(checkServices, 5 * 60 * 1000);
```

## Step 5: Dynatrace Dashboards

### 5.1 Create Custom Dashboard

1. Log into Dynatrace
2. Go to **Dashboards > Create dashboard**
3. Add tiles:

**Services Overview Tile:**
- Metric: `builtin:service.response.time`
- Split by: `dt.entity.service`
- Filter: `service.name` contains "safetyapp"

**Error Rate Tile:**
- Metric: `builtin:service.errors.total.rate`
- Chart type: Line chart

**Database Performance:**
- Metric: `custom.database.connections`
- Metric: `custom.database.query.duration`

**API Gateway Metrics:**
- Metric: Custom metrics from mcp-http-gateway
- Group by endpoint

### 5.2 Create Alerts

1. Go to **Settings > Anomaly detection > Custom events for alerting**
2. Create alert for:
   - High error rate (> 5%)
   - Slow response time (> 3s)
   - Database connection issues
   - Service health check failures

## Step 6: Distributed Tracing

Enable distributed tracing across services:

**Add correlation IDs:**

`utils/correlation.ts`:
```typescript
export function generateCorrelationId(): string {
  return `dt-trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function extractCorrelationId(req: any): string {
  return req.headers['x-correlation-id'] || 
         req.headers['x-dynatrace-trace-id'] || 
         generateCorrelationId();
}
```

Update all services to pass correlation IDs:
```typescript
app.use((req, res, next) => {
  req.correlationId = extractCorrelationId(req);
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
});
```

## Step 7: Deployment

### 7.1 Update render.yaml

Add Dynatrace environment variables to all services:

```yaml
services:
  - type: web
    name: safetyapp
    # ... existing config ...
    envVars:
      # ... existing vars ...
      - key: DYNATRACE_ENABLED
        value: true
      - key: DYNATRACE_ENVIRONMENT_URL
        sync: false
      - key: DYNATRACE_API_TOKEN
        sync: false
      - key: DYNATRACE_PAAS_TOKEN
        sync: false
      - key: DYNATRACE_APP_NAME
        value: SafetyApp-Backend

  - type: web
    name: mcp-http-gateway
    # ... existing config ...
    envVars:
      # ... existing vars ...
      - key: DYNATRACE_ENABLED
        value: true
      - key: DYNATRACE_ENVIRONMENT_URL
        sync: false
      - key: DYNATRACE_API_TOKEN
        sync: false
      - key: DYNATRACE_APP_NAME
        value: MCP-HTTP-Gateway
```

### 7.2 Set Environment Variables in Render

For each service, add the Dynatrace tokens:
1. Go to Render Dashboard
2. Select service → Environment tab
3. Add secret variables:
   - `DYNATRACE_ENVIRONMENT_URL`
   - `DYNATRACE_API_TOKEN`
   - `DYNATRACE_PAAS_TOKEN`

### 7.3 Redeploy All Services

After configuration, trigger redeployment:
```bash
git add -A
git commit -m "feat: Add Dynatrace orchestration for all services"
git push
```

## Step 8: Verification

### 8.1 Check Dynatrace

1. Go to **Services** in Dynatrace
2. You should see:
   - SafetyApp-Backend
   - MCP-HTTP-Gateway
   - Logs-MCP-Server (if configured)

### 8.2 Verify Logs

1. Go to **Logs** in Dynatrace
2. Filter by `dt.source`
3. Should see logs from all services

### 8.3 Verify Metrics

1. Go to **Metrics** in Dynatrace
2. Search for custom metrics:
   - `custom.database.*`
   - `custom.api.*`

## Quick Start Checklist

- [ ] Get Dynatrace tokens (PaaS, API)
- [ ] Add environment variables to all services in Render
- [ ] Update safetyapp (already has Dynatrace config)
- [ ] Add Dynatrace middleware to mcp-http-gateway
- [ ] Add Dynatrace logger to goodmen-logs-mcp-server
- [ ] Create Dynatrace dashboard
- [ ] Set up alerts
- [ ] Deploy and verify
- [ ] Monitor for 24 hours
- [ ] Tune thresholds and alerts

## Troubleshooting

**Logs not appearing:**
- Verify API token has `logs.ingest` scope
- Check token expiration
- Verify environment URL format

**No service data:**
- Ensure `DYNATRACE_ENABLED=true`
- Check network connectivity from Render to Dynatrace
- Verify PaaS token is valid

**High overhead:**
- Reduce log sampling rate
- Disable debug logging in production
- Use async logging

## Next Steps

1. Set up **Synthetic Monitoring** for external health checks
2. Configure **Session Replay** for frontend debugging
3. Enable **Application Security** module
4. Set up **Management Zones** for team-specific views
5. Create **SLO (Service Level Objectives)** dashboards

## Resources

- [Dynatrace Node.js Documentation](https://www.dynatrace.com/support/help/technology-support/application-software/node-js)
- [Dynatrace API Reference](https://www.dynatrace.com/support/help/dynatrace-api)
- [Logs Ingestion API](https://www.dynatrace.com/support/help/dynatrace-api/environment-api/log-monitoring-v2)
- [Metrics Ingestion API](https://www.dynatrace.com/support/help/dynatrace-api/environment-api/metric-v2)
