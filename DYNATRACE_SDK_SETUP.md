# Dynatrace SDK Setup for Render (No Root Required)

## Why SDK Instead of OneAgent?

Render's build environment runs as a non-root user, preventing installation of the full Dynatrace OneAgent. Instead, we use the **Dynatrace OneAgent SDK for Node.js**, which:

- ✅ No root privileges required
- ✅ Simple npm package installation
- ✅ Full API access (logs, metrics, events)
- ✅ Custom instrumentation
- ⚠️ No automatic instrumentation (need to add middleware manually)

## Quick Setup

### Step 1: Get Dynatrace API Token

1. Log into: https://muz70888.live.dynatrace.com
2. Navigate to: **Settings > Integration > Dynatrace API**
3. Click **Generate token**
4. Name: `Render-Services-API`
5. Enable scopes:
   - ✅ `logs.ingest`
   - ✅ `metrics.ingest`
   - ✅ `events.ingest`
   - ✅ `entities.read`
   - ✅ `DataExport`
6. Copy the token (starts with `dt0c01.`)

### Step 2: Add Environment Variables to Render

For **safetyapp** service:

1. Go to: [Render Dashboard](https://dashboard.render.com)
2. Select: **safetyapp** service
3. Navigate to: **Environment** tab
4. Add these variables:

```bash
DYNATRACE_ENABLED=true
DYNATRACE_ENVIRONMENT_URL=https://muz70888.live.dynatrace.com
DYNATRACE_API_TOKEN=dt0c01.YOUR_TOKEN_HERE
DYNATRACE_APP_NAME=SafetyApp-Backend
DYNATRACE_LOG_LEVEL=info
DYNATRACE_METADATA_TEAM=logistics
DYNATRACE_METADATA_ENVIRONMENT=production
```

### Step 3: Update Backend Code

The SDK is already configured in your backend. You just need to enable it in `server.js`:

**Add to `goodmen-logistics/backend/server.js` (after Express app creation):**

```javascript
const { initializeDynatrace, dynatraceMiddleware } = require('./config/dynatrace-sdk');

// Initialize Dynatrace
initializeDynatrace();

// Add Dynatrace middleware (before other routes)
app.use(dynatraceMiddleware);
```

### Step 4: Install Dependencies & Deploy

```bash
cd goodmen-logistics/backend
npm install

# Commit changes
git add .
git commit -m "feat: Add Dynatrace SDK monitoring"
git push
```

Render will automatically redeploy with Dynatrace monitoring enabled.

## What Gets Monitored

### ✅ Automatic (via Middleware)

- HTTP request duration
- Response status codes
- Slow requests (> 1 second)
- Error responses (4xx, 5xx)
- Request correlation IDs

### ✅ Manual (via SDK Functions)

Import the SDK functions in your code:

```javascript
const { sendMetric, sendLog, sendEvent } = require('./config/dynatrace-sdk');
```

**Custom Metrics:**
```javascript
await sendMetric('custom.vehicles.created', 1, { region: 'us-west' });
await sendMetric('custom.database.query.duration', queryTime);
```

**Custom Logs:**
```javascript
await sendLog('INFO', 'Vehicle inspection completed', { 
  vehicleId: vehicle.id,
  inspector: user.name 
});

await sendLog('ERROR', 'Database connection failed', { 
  error: err.message 
});
```

**Custom Events:**
```javascript
await sendEvent('CUSTOM_INFO', 'Vehicle inspection completed', {
  vehicleId: vehicle.id,
  duration: inspectionTime
});

await sendEvent('ERROR_EVENT', 'Critical database failure', {
  database: 'goodmen_logistics',
  error: err.message
});
```

## Verify Monitoring

### 1. Check Logs in Dynatrace

1. Go to: **Logs** in Dynatrace
2. Filter by: `dt.source="SafetyApp-Backend"`
3. You should see HTTP request logs

### 2. Check Metrics

1. Go to: **Metrics** in Dynatrace
2. Search for: `custom.http.request.duration`
3. Create charts to visualize response times

### 3. Check Events

1. Go to: **Events** in Dynatrace
2. Filter by service: `SafetyApp-Backend`
3. See error events and custom events

## Dashboard Configuration

Create a custom dashboard in Dynatrace:

1. **Navigate to**: Dashboards > Create dashboard
2. **Add tiles**:

**Response Time Chart:**
- Metric: `custom.http.request.duration`
- Visualization: Line chart
- Split by: `path`, `statusCode`

**Error Rate:**
- Metric: Filter logs by `level="ERROR"`
- Visualization: Single value
- Threshold: > 5% (red alert)

**Request Volume:**
- Metric: Count of `custom.http.request.duration`
- Visualization: Bar chart
- Split by: `method`

## Common Use Cases

### Database Query Monitoring

```javascript
const { sendMetric, sendLog } = require('./config/dynatrace-sdk');

async function executeQuery(query) {
  const startTime = Date.now();
  try {
    const result = await pool.query(query);
    const duration = Date.now() - startTime;
    
    // Track query performance
    await sendMetric('custom.database.query.duration', duration, {
      queryType: query.split(' ')[0] // SELECT, INSERT, etc.
    });
    
    if (duration > 1000) {
      await sendLog('WARN', 'Slow database query detected', {
        query: query.substring(0, 100),
        duration: duration
      });
    }
    
    return result;
  } catch (error) {
    await sendLog('ERROR', 'Database query failed', {
      error: error.message,
      query: query.substring(0, 100)
    });
    throw error;
  }
}
```

### Business Metrics

```javascript
// Track vehicle inspections
app.post('/api/vehicles/:id/inspect', async (req, res) => {
  try {
    const result = await performInspection(req.params.id);
    
    // Send business metric
    await sendMetric('custom.business.inspections.completed', 1, {
      vehicleType: result.vehicleType,
      status: result.status
    });
    
    await sendEvent('CUSTOM_INFO', 'Vehicle inspection completed', {
      vehicleId: req.params.id,
      inspector: req.user.name,
      duration: result.duration
    });
    
    res.json(result);
  } catch (error) {
    await sendLog('ERROR', 'Inspection failed', {
      vehicleId: req.params.id,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});
```

## MCP HTTP Gateway Setup

For the **mcp-http-gateway** service:

1. Add same environment variables in Render
2. Install SDK: `npm install @dynatrace/oneagent-sdk axios`
3. Create similar config file
4. Add middleware to Express app

See [DYNATRACE_ORCHESTRATION.md](./DYNATRACE_ORCHESTRATION.md) for detailed MCP gateway setup.

## Troubleshooting

**No logs appearing in Dynatrace:**
- Verify `DYNATRACE_ENABLED=true` in Render
- Check API token has `logs.ingest` scope
- Ensure environment URL is correct: `https://muz70888.live.dynatrace.com`
- Check Render logs for Dynatrace errors

**SDK initialization failed:**
```bash
# Check Render logs
[Dynatrace] Missing required configuration (API token or environment URL)
```
Solution: Verify environment variables are set in Render Dashboard

**High API usage:**
- Increase `DYNATRACE_LOG_LEVEL=warn` (only warnings and errors)
- Reduce metric frequency
- Filter out health check requests

## Next Steps

1. ✅ Add environment variables to Render
2. ✅ Update server.js to use Dynatrace middleware
3. ✅ Deploy and verify logs appear in Dynatrace
4. ⏳ Create custom dashboard
5. ⏳ Set up alerts for errors and slow requests
6. ⏳ Add business metrics to critical endpoints
7. ⏳ Configure log sampling if needed

## Resources

- [Dynatrace OneAgent SDK for Node.js](https://github.com/Dynatrace/OneAgent-SDK-for-NodeJs)
- [Dynatrace Logs API](https://www.dynatrace.com/support/help/dynatrace-api/environment-api/log-monitoring-v2/post-ingest-logs)
- [Dynatrace Metrics API](https://www.dynatrace.com/support/help/dynatrace-api/environment-api/metric-v2/post-ingest-metrics)
- [Dynatrace Events API](https://www.dynatrace.com/support/help/dynatrace-api/environment-api/events-v2/post-event)
