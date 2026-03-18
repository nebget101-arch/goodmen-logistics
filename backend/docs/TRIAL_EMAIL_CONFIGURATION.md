# Trial Email System Configuration Template

## Email Provider Setup

### SendGrid Configuration
```javascript
// backend/config/emailConfig.js
const sgMail = require('@sendgrid/mail');

module.exports = {
  provider: 'sendgrid',
  apiKey: process.env.SENDGRID_API_KEY,
  fromEmail: process.env.SMTP_FROM || 'noreply@fleetneuron.com',
  fromName: 'FleetNeuron',
  
  // Configure in SendGrid dashboard:
  // - Create sender verification
  // - Set up templates in SendGrid (optional - we use handlebars)
  // - Enable tracking (opens, clicks)
  // - Configure bounce/complaint handling
};
```

### Mailgun Configuration
```javascript
module.exports = {
  provider: 'mailgun',
  domain: process.env.MAILGUN_DOMAIN,
  apiKey: process.env.MAILGUN_API_KEY,
  fromEmail: process.env.SMTP_FROM || 'noreply@fleetneuron.com',
  fromName: 'FleetNeuron',
  
  // Configure in Mailgun dashboard:
  // - Add domain
  // - Enable tracking
  // - Set up webhooks for deliverability
};
```

## Environment Variables Template

```bash
# .env.example

# ============================================
# TRIAL EMAIL SYSTEM CONFIGURATION
# ============================================

# Email Service Provider
EMAIL_PROVIDER=sendgrid          # sendgrid, mailgun, smtp
SENDGRID_API_KEY=your_api_key
MAILGUN_API_KEY=your_api_key
MAILGUN_DOMAIN=mg.yourdomain.com

# SMTP Configuration (if using direct SMTP)
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-email@company.com
SMTP_PASSWORD=your-password
SMTP_FROM=noreply@fleetneuron.com
SMTP_FROM_NAME=FleetNeuron

# Application URLs
APP_URL=https://app.fleetneuron.com
APP_DOMAIN=fleetneuron.com

# Support Information
SUPPORT_EMAIL=support@fleetneuron.com
SUPPORT_PHONE=+1-800-XXX-XXXX
SUPPORT_HOURS=24/7 (Monday-Sunday)

# Trial Configuration
TRIAL_DAYS=14
TRIAL_GRACE_PERIOD_DAYS=7
DATA_RETENTION_DAYS=30
ENABLE_TRIAL_EMAILS=true

# Cron Job Configuration
ENABLE_TRIAL_REMINDERS=true
CRON_TIMEZONE=UTC
CRON_SCHEDULE=0 2 * * *              # Daily at 2 AM UTC

# Email Preferences (defaults)
DEFAULT_TRIAL_NOTIFICATIONS=true
DEFAULT_TRIAL_REMINDERS=true
DEFAULT_PAYMENT_NOTIFICATIONS=true
DEFAULT_MARKETING_EMAILS=false

# Monitoring & Analytics
ENABLE_EMAIL_TRACKING=true
ENABLE_EMAIL_LOGS=true
LOG_EMAIL_METADATA=true

# Feature Flags
FEATURE_EMAIL_REMINDERS=true
FEATURE_PAYMENT_EMAILS=true
FEATURE_CONVERSION_EMAILS=true

# Environment
NODE_ENV=production
LOG_LEVEL=info
```

## Email Service Wrapper

```javascript
// backend/services/emailService.js
const sgMail = require('@sendgrid/mail');
const mailgun = require('mailgun.js');
const FormData = require('form-data');

class EmailService {
  constructor() {
    this.provider = process.env.EMAIL_PROVIDER || 'sendgrid';
    this.initializeProvider();
  }

  initializeProvider() {
    if (this.provider === 'sendgrid') {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      this.client = sgMail;
    } else if (this.provider === 'mailgun') {
      const mg = mailgun.client({
        username: 'api',
        key: process.env.MAILGUN_API_KEY,
        url: 'https://api.mailgun.net'
      });
      this.client = mg;
    }
  }

  async sendEmail({ to, subject, html, metadata = {} }) {
    try {
      if (this.provider === 'sendgrid') {
        return await this.sendViaSendGrid({ to, subject, html, metadata });
      } else if (this.provider === 'mailgun') {
        return await this.sendViaMailgun({ to, subject, html, metadata });
      }
    } catch (error) {
      console.error('Email send failed:', error);
      throw error;
    }
  }

  async sendViaSendGrid({ to, subject, html, metadata }) {
    const msg = {
      to,
      from: process.env.SMTP_FROM,
      subject,
      html,
      // Add custom headers for tracking
      headers: {
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
        'X-Mailer': 'FleetNeuron-TrialEmailService'
      },
      // Custom arguments for segmentation
      customArgs: metadata
    };

    const result = await this.client.send(msg);
    return result;
  }

  async sendViaMailgun({ to, subject, html, metadata }) {
    const messageData = {
      from: process.env.SMTP_FROM,
      to,
      subject,
      html,
      'h:X-Custom-Header': JSON.stringify(metadata)
    };

    const messagesSending = this.client
      .messages
      .create(process.env.MAILGUN_DOMAIN, messageData);

    return messagesSending;
  }
}

module.exports = new EmailService();
```

## Database Initialization Script

```sql
-- backend/database/init/01-trial-email-tables.sql

-- Email logs table
CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    email_type VARCHAR(50) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    subject TEXT,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, sent, failed, bounced, spam
    provider_message_id VARCHAR(255),
    error_message TEXT,
    sent_at TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Add columns to trial_status if not exists
ALTER TABLE trial_status
ADD COLUMN IF NOT EXISTS last_reminder_7d TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_reminder_3d TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_reminder_1d TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_trial_ended_email_sent TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_data_expiring_email_sent TIMESTAMP,
ADD COLUMN IF NOT EXISTS email_preferences JSONB DEFAULT '{
    "trial_notifications": true,
    "trial_reminders": true,
    "payment_notifications": true,
    "marketing_emails": false
}'::jsonb;

-- Communication preferences table
CREATE TABLE IF NOT EXISTS communication_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE,
    trial_notifications BOOLEAN DEFAULT true,
    trial_reminders BOOLEAN DEFAULT true,
    payment_notifications BOOLEAN DEFAULT true,
    marketing_emails BOOLEAN DEFAULT false,
    unsubscribe_token VARCHAR(255),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Email template customization table (optional)
CREATE TABLE IF NOT EXISTS email_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    template_type VARCHAR(50) NOT NULL,
    subject TEXT,
    html TEXT,
    override_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX idx_email_logs_tenant_id ON email_logs(tenant_id);
CREATE INDEX idx_email_logs_email_type ON email_logs(email_type);
CREATE INDEX idx_email_logs_status ON email_logs(status);
CREATE INDEX idx_email_logs_created_at ON email_logs(created_at);
CREATE INDEX idx_trial_status_last_reminder_7d ON trial_status(last_reminder_7d);
CREATE INDEX idx_trial_status_last_reminder_3d ON trial_status(last_reminder_3d);
CREATE INDEX idx_trial_status_email_preferences ON trial_status USING GIN(email_preferences);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_email_logs_updated_at BEFORE UPDATE ON email_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_communication_preferences_updated_at BEFORE UPDATE ON communication_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_templates_updated_at BEFORE UPDATE ON email_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

## Server.js Integration

```javascript
// backend/server.js or main app initialization

const express = require('express');
const sendTrialReminders = require('./scripts/sendTrialReminders');
const logger = require('./utils/logger');

const app = express();

// ... other middleware and routes ...

// Start the trial reminder service
function initializeTrialEmailService() {
  if (!process.env.ENABLE_TRIAL_REMINDERS) {
    logger.info('Trial reminder service is disabled');
    return;
  }

  if (process.env.NODE_ENV === 'production' || process.env.RUN_CRON === 'true') {
    try {
      sendTrialReminders.start();
      logger.info('Trial reminder service started successfully');
    } catch (error) {
      logger.error('Failed to start trial reminder service:', error);
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  
  // Stop cron jobs
  sendTrialReminders.stop();
  
  // Close server
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  // Force exit after 30 seconds
  setTimeout(() => {
    logger.error('Forced exit after timeout');
    process.exit(1);
  }, 30000);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  sendTrialReminders.stop();
  process.exit(0);
});

// Initialize services
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  
  // Initialize trial email service
  initializeTrialEmailService();
});

module.exports = app;
```

## Docker Configuration

```dockerfile
# backend/Dockerfile (add trial email setup)

FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Create email templates directory
RUN mkdir -p emails/templates/trial

# Set environment for production
ENV NODE_ENV=production
ENV ENABLE_TRIAL_REMINDERS=true

EXPOSE 3000

CMD ["node", "server.js"]
```

## Docker Compose Configuration

```yaml
# docker-compose.yml (add environment variables)

version: '3.8'

services:
  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://user:password@db:5432/fleetneuron
      SMTP_FROM: noreply@fleetneuron.com
      APP_URL: http://localhost:3000
      ENABLE_TRIAL_EMAILS: "true"
      ENABLE_TRIAL_REMINDERS: "true"
      EMAIL_PROVIDER: sendgrid
      SENDGRID_API_KEY: ${SENDGRID_API_KEY}
      TRIAL_DAYS: 14
      TRIAL_GRACE_PERIOD_DAYS: 7
    depends_on:
      - db
    volumes:
      - ./backend/emails/templates/trial:/app/emails/templates/trial:ro

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: fleetneuron
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backend/database/init:/docker-entrypoint-initdb.d

volumes:
  postgres_data:
```

## Monitoring & Alerting

```javascript
// backend/monitoring/emailServiceMonitor.js

class EmailServiceMonitor {
  async checkEmailHealth() {
    // Check recent email failures
    const failures = await db.query(`
      SELECT email_type, COUNT(*) as count
      FROM email_logs
      WHERE status = 'failed'
        AND created_at > NOW() - INTERVAL '1 hour'
      GROUP BY email_type
    `);

    if (failures.rows.length > 0) {
      logger.warn('Email failures detected:', failures.rows);
      // Send alert to monitoring system
      await this.alertMonitoringService('email_failures', failures.rows);
    }

    // Check cron job status
    const lastReminder = await db.query(`
      SELECT MAX(created_at) as last_sent
      FROM email_logs
      WHERE email_type LIKE 'trial_reminder_%'
    `);

    const timeSinceLastReminder = Date.now() - new Date(lastReminder.rows[0].last_sent).getTime();
    
    if (timeSinceLastReminder > 25 * 60 * 60 * 1000) { // 25 hours
      logger.warn('No trial reminders sent in the last 25 hours');
      await this.alertMonitoringService('cron_job_missed', {
        service: 'trial_reminders',
        lastSent: lastReminder.rows[0].last_sent
      });
    }
  }

  async alertMonitoringService(alertType, data) {
    // Integration with your monitoring service (Datadog, New Relic, etc.)
    console.log(`ALERT: ${alertType}`, data);
  }
}

module.exports = new EmailServiceMonitor();
```

## Testing Configuration

```javascript
// backend/tests/trial-email.test.js

const expect = require('chai').expect;
const trialEmailService = require('../emails/trialEmailService');
const db = require('../database');

describe('Trial Email Service', () => {
  
  before(async () => {
    // Setup test database
    await db.query('BEGIN TRANSACTION');
  });

  after(async () => {
    // Cleanup
    await db.query('ROLLBACK TRANSACTION');
  });

  it('should send trial started email', async () => {
    const tenant = {
      id: 'test-1',
      name: 'Test Company',
      email: 'test@example.com'
    };

    const result = await trialEmailService.sendTrialStartedEmail(tenant, {
      trialDays: 14,
      trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    });

    expect(result).to.have.property('id');
    expect(result.status).to.equal('sent');
  });

  it('should respect email preferences', async () => {
    const tenant = {
      id: 'test-2',
      name: 'Test Company 2',
      email: 'test2@example.com',
      email_preferences: { trial_reminders: false }
    };

    const shouldSend = TrialEmailIntegration.shouldSendEmail(tenant, 'trial_reminders');
    expect(shouldSend).to.be.false;
  });

  it('should format dates correctly', async () => {
    const testDate = new Date('2024-02-14T10:30:00Z');
    const formatted = trialEmailService.formatDate(testDate);
    expect(formatted).to.include('Feb');
    expect(formatted).to.include('14');
  });
});
```

---

## Implementation Checklist

- [ ] Copy `.env.example` to `.env` and configure
- [ ] Update `SENDGRID_API_KEY` or other email provider credentials
- [ ] Run database migration: `01-trial-email-tables.sql`
- [ ] Update `server.js` with trial service initialization
- [ ] Update Docker/Docker Compose configurations
- [ ] Set up monitoring and alerting
- [ ] Configure email provider webhooks for deliverability
- [ ] Test email sending in development
- [ ] Run test suite
- [ ] Deploy to staging
- [ ] Monitor in staging for 24 hours
- [ ] Deploy to production
- [ ] Monitor production emails
