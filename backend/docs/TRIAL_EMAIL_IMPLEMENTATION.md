# Trial Email System Implementation Guide

## Overview
Comprehensive email system for trial account lifecycle management in FleetNeuron. Handles onboarding, reminders, conversions, payment failures, and account management communications.

## Architecture

### Components

1. **Email Templates** (`backend/emails/templates/trial/`)
   - 8 HTML email templates with consistent branding
   - Handlebars template support for dynamic content
   - Mobile-responsive design

2. **Trial Email Service** (`backend/emails/trialEmailService.js`)
   - Central service for sending trial-related emails
   - 8 email sending methods
   - Template variable interpolation
   - Metadata tracking for analytics

3. **Trial Reminders Cron** (`backend/scripts/sendTrialReminders.js`)
   - Daily cron job (2 AM UTC)
   - Intelligent reminder logic
   - Rate limiting to prevent duplicate emails
   - Respects user communication preferences

4. **Trial Email Integration** (`backend/utils/trialEmailIntegration.js`)
   - Event-driven email triggers
   - Communication preference validation
   - Lifecycle hooks for email sending

## Email Types

### 1. Trial Started
- **Trigger**: When trial account is created
- **Template**: `trial-started.html`
- **Key Variables**:
  - Trial duration (days)
  - Trial end date/time
  - Getting started resources
  - Dashboard link

### 2. Trial Ending Soon (7-day, 3-day, 1-day)
- **Trigger**: Automatic cron job (daily at 2 AM UTC)
- **Template**: `trial-ending-soon.html`
- **Logic**:
  - Sent 7-8 days before trial end
  - Sent 3-4 days before trial end
  - Sent 1-2 days before trial end
  - Maximum 1 email per reminder type per tenant per day
- **Key Variables**:
  - Days remaining
  - Features used
  - Account status
  - Upgrade link

### 3. Trial Ended
- **Trigger**: Automatic when trial expires
- **Template**: `trial-ended.html`
- **Key Variables**:
  - Data retention period (30 days)
  - Data expiry date
  - Read-only access notification

### 4. Payment Failed
- **Trigger**: When payment collection fails
- **Template**: `payment-failed.html`
- **Key Variables**:
  - Grace period (default 7 days)
  - Grace period end date
  - Payment update link

### 5. Data Expiring Soon
- **Trigger**: Automatic cron job (1-3 days before expiry)
- **Template**: `data-expiring-soon.html`
- **Key Variables**:
  - Days until expiry
  - Record count
  - Upgrade link

### 6. Conversion Successful
- **Trigger**: After trial conversion to paid plan
- **Template**: `conversion-successful.html`
- **Key Variables**:
  - Plan name
  - Monthly price
  - Billing date
  - API limits and features

### 7. Account Paused
- **Trigger**: When account paused due to payment failure
- **Template**: `account-paused.html`
- **Key Variables**:
  - Payment attempt count
  - Grace period
  - Deactivation date

### 8. Account Reactivated
- **Trigger**: When payment succeeds after pause
- **Template**: `account-reactivated.html`
- **Key Variables**:
  - Service restoration confirmation
  - Dashboard access

## Integration Steps

### 1. Add to Trial Service

In your existing trial service (e.g., `trialService.js`):

```javascript
const TrialEmailIntegration = require('../utils/trialEmailIntegration');

// When creating trial
async createTrial(tenantData) {
  const trial = await db.query('INSERT INTO trials...');
  
  // Send welcome email
  await TrialEmailIntegration.onTrialStarted(tenant, {
    trialDays: 14,
    trialEndDate: trial.endDate
  });
  
  return trial;
}

// When trial expires
async expireTrial(tenantId) {
  const trial = await db.query('UPDATE trials SET status = "expired"...');
  
  await TrialEmailIntegration.onTrialEnded(tenant, trial);
}
```

### 2. Add to Payment Service

In your payment/billing service:

```javascript
const TrialEmailIntegration = require('../utils/trialEmailIntegration');

// When payment fails
async handlePaymentFailure(subscription, error) {
  await db.query('UPDATE subscriptions SET failed_attempts = ....');
  
  await TrialEmailIntegration.onPaymentFailed(tenant, {
    reason: error.message,
    paymentAttempts: subscription.failedAttempts
  });
}

// When payment succeeds after failures
async handlePaymentSuccess(subscription) {
  if (subscription.wasPaused) {
    await TrialEmailIntegration.onAccountReactivated(tenant);
  }
}
```

### 3. Add to Conversion Service

In your trial conversion service:

```javascript
const TrialEmailIntegration = require('../utils/trialEmailIntegration');

// When converting trial to paid
async convertTrial(tenantId, plan) {
  const subscription = await db.query('INSERT INTO subscriptions...');
  
  await TrialEmailIntegration.onConversion(tenant, {
    planName: plan.name,
    monthlyPrice: plan.monthlyPrice,
    billingDate: subscription.billingDate,
    nextRenewalDate: subscription.nextRenewalDate
  });
  
  return subscription;
}
```

### 4. Initialize Cron in App Startup

In your main `server.js` or initialization file:

```javascript
const sendTrialReminders = require('./scripts/sendTrialReminders');

// Start the cron job
if (process.env.NODE_ENV === 'production' || process.env.RUN_CRON === 'true') {
  sendTrialReminders.start();
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    sendTrialReminders.stop();
    process.exit(0);
  });
}
```

### 5. Add Environment Variables

Add to your `.env` file:

```env
# Email Configuration
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-email@company.com
SMTP_PASSWORD=your-password
SMTP_FROM=noreply@fleetneuron.com

# Application URLs
APP_URL=https://app.fleetneuron.com
SUPPORT_EMAIL=support@fleetneuron.com
SUPPORT_HOURS=24/7

# Trial Configuration
TRIAL_DAYS=14
TRIAL_GRACE_PERIOD_DAYS=7
DATA_RETENTION_DAYS=30

# Email Service
ENABLE_TRIAL_EMAILS=true
CRON_TIMEZONE=UTC
```

## Database Schema Updates

Add these tables/columns if not already present:

```sql
-- Email tracking
CREATE TABLE email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email_type VARCHAR(50) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  subject TEXT,
  status VARCHAR(20), -- sent, failed, bounced
  sent_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Trial status
ALTER TABLE trial_status ADD COLUMN IF NOT EXISTS (
  last_reminder_7d TIMESTAMP,
  last_reminder_3d TIMESTAMP,
  last_reminder_1d TIMESTAMP,
  last_trial_ended_email_sent TIMESTAMP,
  last_data_expiring_email_sent TIMESTAMP,
  email_preferences JSONB DEFAULT '{
    "trial_notifications": true,
    "trial_reminders": true,
    "payment_notifications": true
  }'::jsonb
);

-- Communication preferences
CREATE TABLE communication_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id),
  trial_notifications BOOLEAN DEFAULT true,
  trial_reminders BOOLEAN DEFAULT true,
  payment_notifications BOOLEAN DEFAULT true,
  marketing_emails BOOLEAN DEFAULT true,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Cron Job Query Examples

### 7-Day Reminder Query
```sql
SELECT t.*, ts.trial_end_date
FROM tenants t
JOIN trial_status ts ON t.id = ts.tenant_id
WHERE ts.status = 'active'
  AND ts.trial_end_date > NOW()
  AND ts.trial_end_date <= NOW() + INTERVAL '8 days'
  AND ts.trial_end_date >= NOW() + INTERVAL '6 days'
  AND (ts.last_reminder_7d IS NULL 
       OR ts.last_reminder_7d < DATE(NOW() - INTERVAL '1 day'))
  AND ts.email_preferences->>'trial_reminders' != 'false'
```

## Testing

### Test Trial Started Email
```javascript
const trialEmailService = require('./backend/emails/trialEmailService');

const testTenant = {
  id: 'test-tenant-1',
  name: 'Test Company',
  email: 'test@example.com'
};

await trialEmailService.sendTrialStartedEmail(testTenant, {
  trialDays: 14,
  trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
});
```

### Test Cron Job Manually
```javascript
const sendTrialReminders = require('./backend/scripts/sendTrialReminders');

// Process reminders immediately
await sendTrialReminders.processRemindersManual();
```

### Test Email Preferences
```javascript
const TrialEmailIntegration = require('./backend/utils/trialEmailIntegration');

const tenant = {
  email: 'user@example.com',
  email_preferences: {
    trial_reminders: false,
    trial_notifications: true
  }
};

// Will skip reminders
const result = TrialEmailIntegration.shouldSendEmail(tenant, 'trial_reminders');
// result = false
```

## Monitoring & Debugging

### Check Email Logs
```sql
SELECT * FROM email_logs 
WHERE tenant_id = 'your-tenant-id'
ORDER BY created_at DESC 
LIMIT 10;
```

### Monitor Failed Emails
```sql
SELECT email_type, COUNT(*) as failed_count
FROM email_logs
WHERE status = 'failed'
GROUP BY email_type
ORDER BY failed_count DESC;
```

### Verify Reminder Schedules
```sql
SELECT 
  t.name,
  ts.trial_end_date,
  DATEDIFF(DAY, NOW(), ts.trial_end_date) as days_remaining,
  ts.last_reminder_7d,
  ts.last_reminder_3d,
  ts.last_reminder_1d
FROM trial_status ts
JOIN tenants t ON ts.tenant_id = t.id
WHERE ts.status = 'active'
ORDER BY ts.trial_end_date ASC;
```

## Email Template Variables Reference

All templates support these variables:

```javascript
{
  tenantName: 'Company Name',
  appUrl: 'https://app.fleetneuron.com',
  supportEmail: 'support@fleetneuron.com',
  
  // Trial variables
  trialDays: 14,
  trialEndDate: '2024-02-14',
  daysRemaining: 7,
  daysUsed: 7,
  usedFeatures: 'core analytics',
  
  // Data variables
  dataRetentionDays: 30,
  dataExpiryDate: '2024-03-14',
  recordCount: 1250,
  
  // Payment variables
  gracePeriodDays: 7,
  gracePeriodEnd: '2024-02-21',
  monthlyPrice: '$99.00',
  
  // Subscription variables
  planName: 'Professional',
  apiCallLimit: '10,000',
  userCount: 5,
  storageAmount: '500 GB',
  billingDate: 14,
  nextRenewalDate: '2024-03-14',
  
  // URLs
  dashboardUrl: 'https://app.fleetneuron.com/dashboard',
  upgradeUrl: 'https://app.fleetneuron.com/billing/upgrade',
  contactSalesUrl: 'https://app.fleetneuron.com/contact-sales',
  accountSettingsUrl: 'https://app.fleetneuron.com/account/settings'
}
```

## Best Practices

1. **Always respect communication preferences** before sending emails
2. **Rate limit reminders** - don't send more than 1 per day per tenant
3. **Monitor email deliverability** - track bounces and failures
4. **Test emails** in development before production deployment
5. **Use descriptive subjects** to improve open rates
6. **Include clear CTAs** - make action links obvious
7. **Track email analytics** to measure engagement
8. **Handle failures gracefully** - don't block main processes on email errors
9. **Set up email templates** in email provider (SendGrid, Mailgun, etc.)
10. **Keep sending frequency moderate** - avoid email fatigue

## Troubleshooting

### Emails Not Sending

1. Check environment variables are set correctly
2. Verify SMTP credentials
3. Check email logs for errors: `SELECT * FROM email_logs WHERE status = 'failed'`
4. Verify tenant has email on file
5. Check communication preferences aren't disabled

### Reminders Not Triggering

1. Verify cron job is running: `console.log('Is running:', sendTrialReminders.isRunning)`
2. Check trial_status table has correct dates
3. Verify email_preferences are not explicitly false
4. Check last_reminder columns for recent timestamps
5. Manually trigger: `await sendTrialReminders.processRemindersManual()`

### Template Rendering Issues

1. Verify Handlebars syntax in templates
2. Ensure all required variables are passed to template
3. Check for special characters that need escaping
4. Test template rendering in isolation

## Future Enhancements

- [ ] SMS reminders for critical events (payment failures, trial ending)
- [ ] Push notifications via browser
- [ ] Email template versioning and A/B testing
- [ ] Personalization based on user behavior
- [ ] Multi-language email support
- [ ] Dynamic content based on plan tier
- [ ] Email preference center UI
- [ ] Integration with marketing automation platform
