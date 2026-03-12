# Twilio & SendGrid Configuration Guide

## Overview
This guide explains how to configure Twilio for voice calls and SendGrid for email notifications in the FleetNeuron Roadside AI system.

## Environment Variables

### Twilio Configuration (Voice Calls)

Add these to your `.env` or Docker environment:

```bash
# Twilio Account Settings
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890          # Your Twilio phone number (e.164 format)

# Webhook URLs for Twilio callbacks
TWILIO_TWIML_URL=https://your-domain.com/webhooks/twilio/call
```

### SendGrid Configuration (Email Notifications)

Add these to your `.env` or Docker environment:

```bash
# SendGrid API Settings
SENDGRID_API_KEY=your_sendgrid_api_key
SENDGRID_FROM_EMAIL=FleetNeuron AI <alerts@your-domain.com>
```

### Optional Configuration

```bash
# Public app base URL for email links
PUBLIC_APP_BASE_URL=https://your-app.com

# Dispatcher email configuration (JSON)
ROADSIDE_DISPATCHER_EMAILS=["dispatcher1@company.com", "dispatcher2@company.com"]
```

## Setup Instructions

### 1. Twilio Setup

1. **Create a Twilio Account**
   - Go to https://www.twilio.com/console
   - Sign up for a free trial account

2. **Get Your Credentials**
   - Account SID: Found in Twilio Console dashboard
   - Auth Token: Found in Twilio Console dashboard
   - Phone Number: Purchase a Twilio phone number from the console

3. **Configure Webhook URLs**
   - In Twilio Console, go to Phone Numbers > Manage Numbers
   - Select your number
   - Set Webhook URLs:
     - Voice: Calls: `https://your-domain.com/webhooks/twilio/call`
     - Fallback URL: `https://your-domain.com/webhooks/twilio/call`
     - Status Callback URL: `https://your-domain.com/webhooks/twilio/status`

4. **Enable Recording** (Optional)
   - Call recording is enabled by default in the SDK
   - Recordings are saved to Twilio's servers
   - Access recordings via the Twilio API or console

### 2. SendGrid Setup

1. **Create a SendGrid Account**
   - Go to https://sendgrid.com/
   - Sign up for a free account

2. **Create an API Key**
   - Go to Settings > API Keys
   - Create a new API key with "Mail Send" permissions
   - Copy the key and add to environment variables

3. **Verify Sender Email**
   - Go to Settings > Sender Authentication
   - Verify your sender email address or domain
   - Use verified email in `SENDGRID_FROM_EMAIL`

## API Endpoints

### Voice Call Endpoints

#### Initiate AI Call
```
POST /api/roadside/calls/:id/ai-call
Content-Type: application/json

{
  "toPhone": "+12025551234",
  "message": "Custom greeting message (optional)",
  "autoAnswer": true
}

Response:
{
  "success": true,
  "twilio_call_sid": "CA1234567890abcdef"
}
```

#### Get Call Recording
```
GET /api/roadside/calls/:id/recording

Response:
{
  "recording_url": "https://api.twilio.com/2010-04-01/Accounts/AC.../Recordings/RE....wav"
}
```

### Email Notification Endpoints

#### Notify Dispatcher (New Call)
```
POST /api/roadside/calls/:id/notify-dispatcher
Content-Type: application/json

{
  "emails": ["dispatcher@company.com"],
  "url": "https://your-app.com/roadside"
}

Response:
{
  "sent": true,
  "results": [
    {
      "email": "dispatcher@company.com",
      "sent": true
    }
  ]
}
```

#### Notify Dispatch Assigned
```
POST /api/roadside/calls/:id/notify-dispatch-assigned
Content-Type: application/json

{
  "driverEmail": "driver@company.com",
  "driverPhone": "+12025551234",
  "vendorEmail": "vendor@company.com",
  "publicPortalUrl": "https://your-app.com/roadside/..."
}

Response:
{
  "driverEmail": { "sent": true },
  "vendorEmail": { "sent": true }
}
```

#### Notify Call Resolved
```
POST /api/roadside/calls/:id/notify-resolved
Content-Type: application/json

{
  "driverEmail": "driver@company.com",
  "resolutionNotes": "Issue resolved: Tow service completed",
  "dispatcherEmail": "dispatcher@company.com"
}

Response:
{
  "sent": true
}
```

#### Notify Payment Contact
```
POST /api/roadside/calls/:id/notify-payment-contact
Content-Type: application/json

{
  "paymentEmail": "billing@company.com",
  "estimatedCost": "$150.00",
  "invoiceUrl": "https://your-app.com/invoices/..."
}

Response:
{
  "sent": true
}
```

## Testing

### Test Environment Variables

```bash
# In Docker Compose
docker compose exec -e TWILIO_ACCOUNT_SID=test services bash
```

### Test Twilio Integration

```bash
# Using curl to test webhook
curl -X POST http://localhost:3000/webhooks/twilio/call \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=CA1234567890&CallStatus=ringing"
```

### Test SendGrid Integration

```bash
# Using Node.js
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

await sgMail.send({
  to: 'test@example.com',
  from: 'alerts@fleetneuron.ai',
  subject: 'Test Email',
  text: 'This is a test'
});
```

## Troubleshooting

### Twilio Calls Not Going Through

1. **Check Phone Number Format**
   - Must be E.164 format: +1XXXXXXXXXX
   - Validate with: https://www.twilio.com/lookup

2. **Check Webhook Configuration**
   - Ensure TWILIO_TWIML_URL is publicly accessible
   - Verify SSL certificate is valid
   - Check logs for webhook responses

3. **Check Account Balance**
   - Free trial accounts have limited minutes
   - Add credits if trial expired

### Emails Not Sending

1. **Check API Key**
   - Verify key has "Mail Send" permissions
   - Check if key is still valid

2. **Check Sender Email**
   - Must be verified in SendGrid console
   - Use exact email from SENDGRID_FROM_EMAIL

3. **Check Recipient Email**
   - Verify email format is valid
   - Check spam/junk folder
   - Review SendGrid Activity Feed for errors

4. **Check Email Content**
   - Verify HTML/text content doesn't have special characters
   - Check subject line isn't too long

## Monitoring

### Check Twilio Logs

```javascript
// In your service
const twilioClient = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
const calls = await twilioClient.calls.list({ limit: 20 });
calls.forEach(call => console.log(call.status));
```

### Check SendGrid Logs

```bash
# Via SendGrid Dashboard
- Go to Mail Send > Logs
- Filter by timestamp or recipient
- Check status (Sent, Bounced, Dropped, etc.)
```

### Application Logging

Logs are written to `dtLogger.info()` and `dtLogger.error()`:

```javascript
// In roadside.service.js and related files
dtLogger.info(`Twilio: Initiated call ${callSid} to ${toPhone}`);
dtLogger.error(`SendGrid send error: ${errorMsg}`);
```

## Security Considerations

1. **Never log sensitive credentials**
   - Don't log TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SENDGRID_API_KEY
   - Only log call SIDs and message IDs

2. **Validate webhook signatures** (Optional but recommended)
   - Twilio provides X-Twilio-Signature header
   - Validate before processing webhook

3. **Rate limiting**
   - Implement rate limiting on webhook endpoints
   - Limit calls to 1 per second per user

4. **HTTPS only**
   - All webhook URLs must be HTTPS in production
   - Self-signed certificates not accepted

## Cost Estimates (2024)

### Twilio
- Inbound SMS: $0.0075 per message
- Outbound SMS: $0.0075 per message
- Voice calls: $0.02 per minute inbound, $0.013 per minute outbound
- Recording storage: $0.0001 per minute stored

### SendGrid
- Free tier: 100 emails/day
- Pro tier: $29.95/month for up to 500,000 emails/month
- Enterprise: Custom pricing

## Additional Resources

- **Twilio Documentation**: https://www.twilio.com/docs
- **SendGrid Documentation**: https://docs.sendgrid.com
- **Twilio Node.js SDK**: https://github.com/twilio/twilio-node
- **SendGrid Node.js SDK**: https://github.com/sendgrid/sendgrid-nodejs
