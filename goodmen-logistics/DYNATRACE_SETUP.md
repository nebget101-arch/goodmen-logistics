# Dynatrace Integration Setup Guide

## Overview
This guide will help you configure Dynatrace monitoring for the Goodmen Logistics application, including both backend (Node.js) and frontend (Angular) monitoring.

## Prerequisites
- Dynatrace account (SaaS or Managed)
- Access to Dynatrace environment credentials
- Node.js and npm installed

## Backend Setup (Node.js)

### 1. Install Dynatrace OneAgent SDK

```bash
cd backend
npm install @dynatrace/oneagent-sdk --save
```

### 2. Configure Environment Variables

Copy the Dynatrace configuration template:
```bash
cp .env.dynatrace .env.dynatrace.local
```

Edit `.env.dynatrace.local` with your Dynatrace credentials:

```bash
# Get these from your Dynatrace environment
DYNATRACE_ENVIRONMENT_URL=https://abc12345.live.dynatrace.com
DYNATRACE_API_TOKEN=your-api-token-here
DYNATRACE_PAAS_TOKEN=your-paas-token-here
DYNATRACE_APP_NAME=Goodmen-Logistics-Backend
DYNATRACE_ENABLED=true
DYNATRACE_LOG_LEVEL=info
DYNATRACE_METADATA_TEAM=logistics
DYNATRACE_METADATA_ENVIRONMENT=production
```

### 3. Update .env file

Add to your main `.env` file:
```bash
# Load Dynatrace config
source .env.dynatrace.local
```

### 4. Features Enabled

The backend integration provides:
- ✅ Automatic HTTP request tracking
- ✅ Response time monitoring
- ✅ Error tracking
- ✅ Custom metrics
- ✅ Database query tracking
- ✅ Health check monitoring

## Frontend Setup (Angular)

### 1. Get Dynatrace RUM Credentials

1. Log into your Dynatrace environment
2. Go to **Settings > Web and mobile monitoring > Applications**
3. Click **Add application** or select existing application
4. Note your **Environment ID** and **Application ID**

### 2. Configure Frontend

Edit `frontend/src/dynatrace-config.ts`:

```typescript
export const dynatraceConfig: DynatraceConfig = {
  enabled: true,
  environmentId: 'abc12345', // Your 8-character environment ID
  applicationId: 'APPLICATION_12345678', // Your application ID
  beaconUrl: '',
  scriptUrl: ''
};
```

### 3. Option A: HTML Script Tag (Recommended)

Uncomment and update the script tag in `frontend/src/index.html`:

```html
<script type="text/javascript" 
        src="https://abc12345.live.dynatrace.com/jstag/APPLICATION_12345678/dt_rum_config.js" 
        crossorigin="anonymous" 
        async></script>
```

### 4. Option B: Programmatic Initialization

Update `frontend/src/main.ts` to initialize Dynatrace:

```typescript
import { initializeDynatraceRUM } from './dynatrace-config';

// Initialize Dynatrace RUM
initializeDynatraceRUM();

// Then bootstrap Angular
platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));
```

### 5. Features Available

The frontend integration provides:
- ✅ Real User Monitoring (RUM)
- ✅ Page load performance
- ✅ User action tracking
- ✅ JavaScript error reporting
- ✅ AJAX request monitoring
- ✅ User identification
- ✅ Session tracking

## Custom Tracking Examples

### Backend: Track Custom Metrics

```javascript
const { trackCustomMetric } = require('./config/dynatrace');

// Track driver creation
trackCustomMetric(dynatrace, 'driver-created', 1, { 
  driverId: driver.id,
  dqfStatus: driver.dqfCompleteness 
});
```

### Backend: Track Database Queries

```javascript
const { trackDatabaseQuery } = require('./config/dynatrace');

const startTime = Date.now();
pool.query(query, params, (err, result) => {
  const duration = Date.now() - startTime;
  trackDatabaseQuery(dynatrace, 'get-drivers', duration, !err);
});
```

### Frontend: Track User Actions

```typescript
import { trackUserAction } from './dynatrace-config';

// Track button click
trackUserAction('add-driver-clicked', { 
  driverId: newDriver.id 
});
```

### Frontend: Report Errors

```typescript
import { reportError } from './dynatrace-config';

try {
  // Your code
} catch (error) {
  reportError(error, { 
    component: 'DriversComponent',
    action: 'saveDriver' 
  });
}
```

### Frontend: Identify User

```typescript
import { identifyUser } from './dynatrace-config';

// After user login
identifyUser(
  user.id,
  user.email,
  `${user.firstName} ${user.lastName}`
);
```

## Getting Your Dynatrace Credentials

### API Token
1. Go to **Settings > Integration > Dynatrace API**
2. Click **Generate token**
3. Enable these permissions:
   - Access problem and event feed, metrics, and topology (API v1)
   - Read metrics (API v2)
   - Write metrics (API v2)
4. Copy the token

### PaaS Token
1. Go to **Settings > Integration > Platform as a Service**
2. Click **Generate token**
3. Copy the token

### Environment ID
- Found in your Dynatrace URL: `https://{ENVIRONMENT_ID}.live.dynatrace.com`
- Example: If URL is `https://abc12345.live.dynatrace.com`, ID is `abc12345`

### Application ID (RUM)
1. Go to **Applications & Microservices > Frontend**
2. Click on your application
3. Click **Browse [...]** > **Capture settings**
4. Find the **Application ID** in the JavaScript tag

## Testing the Integration

### Backend Test
```bash
cd backend
npm start

# Should see in logs:
# ✅ Dynatrace OneAgent initialized successfully
# 📊 Application: Goodmen-Logistics-Backend
```

### Frontend Test
1. Open browser DevTools
2. Go to Network tab
3. Load the application
4. Look for requests to `bf.live.dynatrace.com` (RUM beacons)

### Verify in Dynatrace
1. **Backend**: Go to **Applications & Microservices > Services** - should see your Node.js service
2. **Frontend**: Go to **Applications & Microservices > Frontend** - should see user sessions

## Troubleshooting

### Backend not appearing in Dynatrace
- Verify environment URL and tokens are correct
- Check `DYNATRACE_ENABLED=true` in `.env`
- Ensure `@dynatrace/oneagent-sdk` is installed
- Check server logs for initialization messages

### Frontend not tracking
- Verify script is loading (check Network tab)
- Ensure Environment ID and Application ID are correct
- Check browser console for errors
- Verify `enabled: true` in `dynatrace-config.ts`

### No data showing
- Wait 2-3 minutes for data to appear
- Generate some traffic to the application
- Check Dynatrace dashboard for data

## Security Best Practices

1. **Never commit credentials**: Add `.env.dynatrace.local` to `.gitignore`
2. **Use environment variables**: Store tokens in environment variables, not in code
3. **Rotate tokens**: Regularly rotate API and PaaS tokens
4. **Limit permissions**: Use minimum required permissions for tokens
5. **Use different environments**: Separate dev/staging/production configurations

## Additional Resources

- [Dynatrace OneAgent SDK for Node.js](https://github.com/Dynatrace/OneAgent-SDK-for-NodeJs)
- [Dynatrace RUM JavaScript API](https://www.dynatrace.com/support/help/setup-and-configuration/setup-on-container-platforms/docker/monitor-docker-containers)
- [Dynatrace Documentation](https://www.dynatrace.com/support/help/)

## Support

For issues with:
- **Dynatrace**: Contact Dynatrace support or check their documentation
- **Application integration**: Check application logs and configuration files
- **Custom tracking**: Review the examples in this guide
