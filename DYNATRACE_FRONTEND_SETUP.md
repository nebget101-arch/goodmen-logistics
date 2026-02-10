# Dynatrace Frontend (RUM) Monitoring Setup

## What is RUM?

**Real User Monitoring (RUM)** tracks actual user interactions with your Angular frontend:

- ✅ Page load times
- ✅ JavaScript errors
- ✅ User clicks and interactions
- ✅ API calls (XHR/Fetch requests)
- ✅ User sessions and journeys
- ✅ Browser and device information
- ✅ Geographic location of users

## Setup Steps

### Step 1: Create RUM Application in Dynatrace

1. Go to: https://muz70888.live.dynatrace.com
2. Navigate to: **Settings > Web and mobile monitoring > Applications**
3. Click: **Add new application**
4. Configure:
   - **Application name**: SafetyApp Frontend
   - **Application type**: Web application
   - **Domain**: `safetyapp-ln58.onrender.com`
5. Click: **Create application**
6. Copy the **Application ID** (looks like `APPLICATION-123ABC...`)

### Step 2: Get JavaScript Snippet

After creating the application:

1. Go to application settings
2. Find: **Instrumentation** section
3. You'll see two options:
   - **JavaScript tag** (async snippet)
   - **Inline JavaScript** (sync snippet)
4. Copy the **async snippet** (recommended)

It will look like this:

```html
<script type="text/javascript" src="https://js-cdn.dynatrace.com/jstag/YOUR_ENV_ID/YOUR_APP_ID/YOUR_MONITORING_ID_dynamo.js" crossorigin="anonymous"></script>
```

### Step 3: Add to Angular index.html

Add the script to your `frontend/src/index.html` in the `<head>` section:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Goodmen Logistics</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
  
  <!-- Dynatrace RUM - Add this -->
  <script type="text/javascript" src="https://js-cdn.dynatrace.com/jstag/YOUR_ENV_ID/YOUR_APP_ID/YOUR_MONITORING_ID_dynamo.js" crossorigin="anonymous"></script>
</head>
<body>
  <app-root></app-root>
</body>
</html>
```

### Step 4: Deploy to Render

```bash
cd /Users/nebyougetaneh/Desktop/SafetyApp
git add goodmen-logistics/frontend/src/index.html
git commit -m "feat: Add Dynatrace RUM for frontend monitoring"
git push
```

Render will automatically rebuild and deploy.

## What You'll See in Dynatrace

### 1. Page Performance

- **Navigate to**: Applications > SafetyApp Frontend
- **View**:
  - Page load time
  - Time to interactive
  - Largest contentful paint (LCP)
  - First input delay (FID)
  - Cumulative layout shift (CLS)

### 2. User Actions

Track user interactions:
- Button clicks
- Form submissions
- Route changes in Angular
- Custom actions

### 3. XHR/API Calls

Monitor all API requests:
- Request duration
- Response codes
- Failed requests
- Endpoints called

**Example**: Calls to `/api/vehicles`, `/api/drivers`, etc.

### 4. JavaScript Errors

Automatically captures:
- Uncaught exceptions
- Promise rejections
- Console errors
- Stack traces

### 5. User Sessions

See complete user journeys:
- Pages visited
- Actions taken
- Errors encountered
- Geographic location
- Browser/device info

## Advanced: Custom Events (Optional)

If you want to track custom business events in your Angular app, add this to your components:

### Install Dynatrace API (if not using RUM script)

```bash
cd goodmen-logistics/frontend
npm install @dynatrace/dtrum-api-types
```

### Track Custom Events

In your Angular components:

```typescript
// src/app/services/analytics.service.ts
import { Injectable } from '@angular/core';

declare const dtrum: any; // Dynatrace RUM API

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  
  trackVehicleInspection(vehicleId: string, result: string) {
    if (typeof dtrum !== 'undefined') {
      dtrum.reportCustomEvent('VehicleInspection', {
        vehicleId: vehicleId,
        result: result,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  trackUserLogin(username: string) {
    if (typeof dtrum !== 'undefined') {
      dtrum.identifyUser(username);
      dtrum.reportCustomEvent('UserLogin', {
        username: username
      });
    }
  }
  
  trackError(error: any, context: string) {
    if (typeof dtrum !== 'undefined') {
      dtrum.reportError(error, context);
    }
  }
}
```

### Use in Components

```typescript
// src/app/components/vehicle-detail.component.ts
import { Component } from '@angular/core';
import { AnalyticsService } from '../services/analytics.service';

export class VehicleDetailComponent {
  constructor(private analytics: AnalyticsService) {}
  
  completeInspection() {
    // ... your inspection logic ...
    
    // Track in Dynatrace
    this.analytics.trackVehicleInspection(
      this.vehicle.id, 
      'passed'
    );
  }
}
```

## Verify Monitoring

### 1. Test Locally First (Optional)

Before deploying, test locally:

```bash
cd goodmen-logistics/frontend
npm run build
npm install -g http-server
http-server dist/goodmen-logistics -p 8080
```

Open http://localhost:8080 and check browser console for Dynatrace logs.

### 2. Check Dynatrace After Deployment

After deploying to Render:

1. Visit: https://safetyapp-ln58.onrender.com
2. Click around the app (vehicles, drivers, etc.)
3. Wait 2-3 minutes for data to appear
4. Go to Dynatrace: **Applications > SafetyApp Frontend**
5. You should see:
   - User sessions
   - Page loads
   - XHR requests to your backend API

## Dashboard Setup

Create a frontend performance dashboard:

1. **Navigate to**: Dashboards > Create dashboard
2. **Name**: SafetyApp Frontend Performance
3. **Add tiles**:

**Tile 1: Page Load Time**
- Metric: `builtin:apps.web.loadTime`
- Visualization: Line chart

**Tile 2: JavaScript Errors**
- Metric: `builtin:apps.web.javaScriptErrorCount`
- Alert threshold: > 10 errors/hour

**Tile 3: Failed XHR Requests**
- Metric: `builtin:apps.web.xhr.failedCount`
- Filter: Status code >= 400

**Tile 4: User Sessions**
- Metric: `builtin:apps.web.sessionCount`
- Split by: Browser, Device type

**Tile 5: Geographic Distribution**
- Metric: User sessions
- Visualization: Map

## Troubleshooting

**No data appearing in Dynatrace:**
- Check browser DevTools console for Dynatrace errors
- Verify script URL is correct
- Ensure domain matches what you configured (`safetyapp-ln58.onrender.com`)
- Wait 2-3 minutes after first page load

**RUM script blocking page load:**
- Ensure you're using the async version of the script
- Add `defer` attribute if needed

**CORS errors:**
- The Dynatrace beacon endpoint should allow cross-origin requests
- This is automatically configured when you create the RUM app

## Quick Checklist

- [ ] Create RUM application in Dynatrace
- [ ] Copy JavaScript snippet
- [ ] Add to `frontend/src/index.html` in `<head>`
- [ ] Commit and push changes
- [ ] Wait for Render deployment to complete
- [ ] Visit deployed app and interact with it
- [ ] Check Dynatrace after 2-3 minutes
- [ ] See user sessions and page loads
- [ ] Create performance dashboard
- [ ] Set up alerts for errors and slow pages

## Next Steps

1. **Session Replay** (requires license): Record user sessions for debugging
2. **Conversion Tracking**: Track business goals (inspections completed, etc.)
3. **A/B Testing**: Compare performance between features
4. **Synthetic Monitoring**: Set up automated tests to check availability

## Resources

- [Dynatrace RUM Documentation](https://www.dynatrace.com/support/help/how-to-use-dynatrace/real-user-monitoring)
- [Angular Monitoring Best Practices](https://www.dynatrace.com/support/help/technology-support/application-software/other-technologies/supported-technologies/angular)
- [Custom Events API](https://www.dynatrace.com/support/help/how-to-use-dynatrace/real-user-monitoring/setup-and-configuration/web-applications/additional-configuration/report-custom-events)
