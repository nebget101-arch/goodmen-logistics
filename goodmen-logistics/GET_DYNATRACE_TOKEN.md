# How to Get Your Dynatrace API Token

## Quick Steps (Only need API Token for logging!)

Since you already have your Dynatrace environment ID (`muz70888`), you just need **ONE token** - the API Token.

### Step 1: Access the Access Tokens Page

1. Click your **profile icon** in the top-right corner (not Settings menu)
2. Select **"Access tokens"** from the dropdown menu

   OR use the quick search:
   - Press `Cmd+K` (Mac) or `Ctrl+K` (Windows)
   - Type: "access tokens"
   - Click the first result

### Step 2: Generate New Token

1. Click **"Generate new token"** button
2. Give it a name: `Goodmen-Logistics-API`
3. Select the following permissions:
   - ✅ **Metrics ingestion** (WriteMetrics)
   - ✅ **Logs ingestion** (WriteLogEvents)
   - ✅ **Events ingestion** (WriteEvents)
   - ✅ **Read metrics** (ReadMetrics) - optional
   - ✅ **Read logs** (ReadLogs) - optional

### Step 3: Copy the Token

1. Click **"Generate token"**
2. **IMMEDIATELY COPY** the token value (you won't see it again!)
3. It will look something like: `dt0c01.ABC123DEF456...`

### Step 4: Add Token to Your App

1. Open the file: `/Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics/backend/.env.dynatrace.local`
2. Replace `your-api-token-here` with your actual token:

```bash
DYNATRACE_API_TOKEN=dt0c01.ABC123DEF456GHI789...YOUR_ACTUAL_TOKEN
```

3. Save the file

### Step 5: Test It

```bash
cd /Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics/backend
npm start
```

You should see:
```
✅ Dynatrace logging enabled (API-based)
📊 Application: Goodmen-Logistics-Backend
🌍 Environment: development
```

## What Will Be Logged?

Your app will now send these to Dynatrace:
- ✅ **Server startup/shutdown events**
- ✅ **API request metrics** (count, duration, status codes)
- ✅ **Database query metrics** (duration, success/failure)
- ✅ **Custom business events** (driver updates, vehicle changes, etc.)
- ✅ **Error logs** with full stack traces
- ✅ **Info/warning logs**

## View Logs in Dynatrace

After starting your app:

1. Go to your Dynatrace environment: https://muz70888.apps.dynatrace.com
2. Navigate to **Observe and explore** (left menu)
3. Click **Metrics** or **Logs**
4. Search for: `custom.*` to see your application metrics
5. Filter by: `app=Goodmen-Logistics-Backend`

## Troubleshooting

### "Failed to send metric to Dynatrace"
- Check your API token is correct in `.env.dynatrace.local`
- Verify the token has "Metrics ingestion" permission
- Make sure `DYNATRACE_ENABLED=true`

### "Dynatrace credentials not configured"
- Make sure you saved `.env.dynatrace.local` file
- Restart the server: `pkill -f "node server.js" && npm start`

### Still seeing "Dynatrace monitoring is disabled"
- Open `.env.dynatrace.local`
- Verify: `DYNATRACE_ENABLED=true`
- Verify: `DYNATRACE_API_TOKEN` is not `your-api-token-here`

## Example: Adding Custom Logs in Your Code

```javascript
const dtLogger = require('./utils/dynatrace-logger');

// Log info
dtLogger.info('Driver created successfully', { driverId: 123, name: 'John Doe' });

// Log error
dtLogger.error('Failed to fetch vehicles', error, { userId: 456 });

// Track custom metric
dtLogger.sendMetric('custom.drivers.active', 42, { region: 'west' });

// Track business event
dtLogger.trackEvent('driver.license.expiring', { driverId: 123, daysLeft: 7 });

// Track API request
dtLogger.trackRequest('GET', '/api/drivers', 200, 125); // 125ms

// Track database query
dtLogger.trackDatabase('SELECT', 'drivers', 45, true); // 45ms, success
```

## No PaaS Token Needed! ✅

The new logging approach uses **Dynatrace Metrics API** directly - you don't need:
- ❌ PaaS Token
- ❌ OneAgent installation
- ❌ Application ID
- ❌ RUM configuration

Just the **API Token** is enough to get logs flowing to Dynatrace!
