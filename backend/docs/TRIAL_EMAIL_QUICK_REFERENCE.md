# Trial Email System - Quick Reference

## File Structure
```
backend/
├── emails/
│   ├── trialEmailService.js          # Main email sending service
│   └── templates/trial/
│       ├── trial-started.html
│       ├── trial-ending-soon.html
│       ├── trial-ended.html
│       ├── payment-failed.html
│       ├── data-expiring-soon.html
│       ├── conversion-successful.html
│       ├── account-paused.html
│       └── account-reactivated.html
├── scripts/
│   └── sendTrialReminders.js         # Daily cron job (2 AM UTC)
├── utils/
│   └── trialEmailIntegration.js      # Event-driven email triggers
└── docs/
    └── TRIAL_EMAIL_IMPLEMENTATION.md # Full implementation guide
```

## Quick Integration Checklist

### 1. Service Integration Points
- [ ] Trial creation → `TrialEmailIntegration.onTrialStarted()`
- [ ] Payment failure → `TrialEmailIntegration.onPaymentFailed()`
- [ ] Trial conversion → `TrialEmailIntegration.onConversion()`
- [ ] Account pause → `TrialEmailIntegration.onAccountPaused()`
- [ ] Account reactivation → `TrialEmailIntegration.onAccountReactivated()`

### 2. Database Setup
```sql
-- Add columns to trial_status table
ALTER TABLE trial_status ADD COLUMN IF NOT EXISTS (
  last_reminder_7d TIMESTAMP,
  last_reminder_3d TIMESTAMP,
  last_reminder_1d TIMESTAMP,
  last_trial_ended_email_sent TIMESTAMP,
  last_data_expiring_email_sent TIMESTAMP,
  email_preferences JSONB DEFAULT '{"trial_notifications": true}'::jsonb
);

-- Create email_logs table for tracking
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  email_type VARCHAR(50),
  recipient_email VARCHAR(255),
  status VARCHAR(20),
  sent_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);
```

### 3. Environment Setup
```env
APP_URL=https://app.fleetneuron.com
SUPPORT_EMAIL=support@fleetneuron.com
ENABLE_TRIAL_EMAILS=true
```

### 4. Startup Code
```javascript
// In server.js or app initialization
const sendTrialReminders = require('./scripts/sendTrialReminders');

if (process.env.NODE_ENV === 'production' || process.env.RUN_CRON === 'true') {
  sendTrialReminders.start();
}
```

## Email Types & Triggers

| Email | Trigger | When | Template |
|-------|---------|------|----------|
| Trial Started | Trial creation | Immediately | trial-started.html |
| 7-Day Reminder | Cron job | 6-8 days before end | trial-ending-soon.html |
| 3-Day Reminder | Cron job | 2-4 days before end | trial-ending-soon.html |
| 1-Day Reminder | Cron job | 1-2 days before end | trial-ending-soon.html |
| Trial Ended | Cron job / Event | After trial expires | trial-ended.html |
| Payment Failed | Payment service | When charge fails | payment-failed.html |
| Data Expiring | Cron job | 1-3 days before expiry | data-expiring-soon.html |
| Conversion | Conversion service | After upgrade | conversion-successful.html |
| Account Paused | Payment service | After grace period | account-paused.html |
| Account Reactivated | Payment service | When payment succeeds | account-reactivated.html |

## API Reference

### Send Trial Started Email
```javascript
const trialEmailService = require('./emails/trialEmailService');

await trialEmailService.sendTrialStartedEmail(tenant, {
  trialDays: 14,
  trialEndDate: new Date('2024-02-14')
});
```

### Send Trial Ending Reminder
```javascript
await trialEmailService.sendTrialEndingSoonEmail(tenant, {
  daysRemaining: 7,
  trialDays: 14,
  daysUsed: 7,
  usedFeatures: 'core analytics'
});
```

### Send Payment Failed Notification
```javascript
await trialEmailService.sendPaymentFailedEmail(tenant, {
  gracePeriodDays: 7,
  gracePeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
});
```

### Send Conversion Email
```javascript
await trialEmailService.sendConversionSuccessfulEmail(tenant, subscription, {
  billingDate: 14,
  nextRenewalDate: new Date('2024-03-14')
});
```

### Check Email Preferences
```javascript
const TrialEmailIntegration = require('./utils/trialEmailIntegration');

const shouldSend = TrialEmailIntegration.shouldSendEmail(
  tenant, 
  'trial_reminders'
); // true/false
```

### Trigger Events
```javascript
const TrialEmailIntegration = require('./utils/trialEmailIntegration');

// Event-based triggers
await TrialEmailIntegration.onTrialStarted(tenant, config);
await TrialEmailIntegration.onPaymentFailed(tenant, error);
await TrialEmailIntegration.onConversion(tenant, subscription);
await TrialEmailIntegration.onAccountPaused(tenant, reason);
await TrialEmailIntegration.onAccountReactivated(tenant);
```

## Cron Job

**Schedule**: Daily at 2 AM UTC

**Processes**:
- 7-day trial ending reminders
- 3-day trial ending reminders
- 1-day trial ending reminders
- Trial ended notifications
- Data expiring notifications

**Start/Stop**:
```javascript
const sendTrialReminders = require('./scripts/sendTrialReminders');

// Start
sendTrialReminders.start();

// Stop
sendTrialReminders.stop();

// Manual trigger
await sendTrialReminders.processRemindersManual();
```

## Database Queries

### Check Email History
```sql
SELECT * FROM email_logs 
WHERE tenant_id = 'xxx' 
ORDER BY sent_at DESC 
LIMIT 20;
```

### Find Failed Emails
```sql
SELECT * FROM email_logs 
WHERE status = 'failed' 
ORDER BY sent_at DESC;
```

### Check Reminder Status
```sql
SELECT 
  t.name,
  ts.trial_end_date,
  EXTRACT(DAY FROM ts.trial_end_date - NOW()) as days_remaining,
  ts.last_reminder_7d,
  ts.last_reminder_3d,
  ts.last_reminder_1d
FROM trial_status ts
JOIN tenants t ON ts.tenant_id = t.id
ORDER BY ts.trial_end_date;
```

### View Communication Preferences
```sql
SELECT tenant_id, email_preferences 
FROM trial_status
WHERE email_preferences->>'trial_reminders' = 'false';
```

## Template Variables

### Common Variables (All Templates)
- `tenantName` - Company/account name
- `appUrl` - Base application URL
- `supportEmail` - Support contact email

### Trial Variables
- `trialDays` - Total trial duration (e.g., 14)
- `trialEndDate` - Trial expiration date
- `trialEndTime` - Trial expiration time (UTC)
- `daysRemaining` - Days left in trial
- `daysUsed` - Days used so far
- `usedFeatures` - Feature summary

### Data Variables
- `dataRetentionDays` - Data retention period
- `dataExpiryDate` - When data will be deleted
- `recordCount` - Number of records stored
- `historyDays` - Operational history length

### Payment Variables
- `gracePeriodDays` - Grace period length
- `gracePeriodEnd` - Grace period expiration date
- `monthlyPrice` - Subscription cost
- `attemptCount` - Payment attempt count

### Subscription Variables
- `planName` - Plan tier (e.g., "Professional")
- `apiCallLimit` - API call allowance
- `userCount` - Number of users
- `storageAmount` - Storage allocation
- `billingDate` - Day of month to bill
- `nextRenewalDate` - Next billing date

### URL Variables
- `dashboardUrl` - Link to dashboard
- `upgradeUrl` - Link to upgrade page
- `addCardUrl` - Link to add payment method
- `contactSalesUrl` - Link to sales contact
- `accountSettingsUrl` - Link to account settings

## Troubleshooting

### Email Not Sending
1. Verify tenant has email: `SELECT email FROM tenants WHERE id = 'xxx'`
2. Check preferences aren't disabled: `SELECT email_preferences FROM trial_status WHERE tenant_id = 'xxx'`
3. Check email service logs: `SELECT * FROM email_logs WHERE tenant_id = 'xxx' ORDER BY sent_at DESC`
4. Verify SMTP config in environment

### Reminders Not Running
1. Check cron is running: `SELECT * FROM email_logs WHERE email_type = 'trial_ending_soon' AND DATE(sent_at) = TODAY()`
2. Verify trial dates are in database
3. Check email preferences aren't set to false
4. Manually trigger: `await sendTrialReminders.processRemindersManual()`

### Template Not Rendering
1. Verify Handlebars syntax: `{{variable}}`
2. Check all required variables are passed
3. Test template: `const compiled = handlebars.compile(template); compiled(data)`
4. Check template file exists and is readable

## Common Tasks

### Send Test Email
```javascript
const trialEmailService = require('./emails/trialEmailService');

const testTenant = {
  id: 'test-1',
  name: 'Test Corp',
  email: 'you@example.com'
};

await trialEmailService.sendTrialStartedEmail(testTenant, {
  trialDays: 14,
  trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
});
```

### Disable Emails for Tenant
```sql
UPDATE trial_status 
SET email_preferences = jsonb_set(
  email_preferences, 
  '{trial_reminders}', 
  'false'
)
WHERE tenant_id = 'xxx';
```

### Re-enable Emails for Tenant
```sql
UPDATE trial_status 
SET email_preferences = jsonb_set(
  email_preferences, 
  '{trial_reminders}', 
  'true'
)
WHERE tenant_id = 'xxx';
```

### View Email Stats
```sql
SELECT 
  email_type,
  COUNT(*) as total,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
FROM email_logs
GROUP BY email_type;
```

## Dependencies

Required npm packages:
- `handlebars` - Template rendering
- `node-cron` - Scheduled jobs
- Your existing email service (SendGrid, Mailgun, etc.)

## Support

For issues or questions:
1. Check `/backend/docs/TRIAL_EMAIL_IMPLEMENTATION.md` for detailed docs
2. Review email logs: `SELECT * FROM email_logs WHERE tenant_id = 'xxx'`
3. Check template files for syntax errors
4. Verify environment variables are set
5. Test manually with `sendTrialReminders.processRemindersManual()`
