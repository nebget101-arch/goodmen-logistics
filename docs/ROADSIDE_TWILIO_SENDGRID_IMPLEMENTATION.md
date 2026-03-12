# Twilio & SendGrid Integration for Roadside AI - Implementation Summary

## Overview

This document summarizes the implementation of Twilio voice calls and SendGrid email notifications for the FleetNeuron Roadside AI feature. The integration enables dispatchers to:

- **Initiate AI voice calls** to drivers using Twilio
- **Record and retrieve** call recordings
- **Send automated email notifications** at key stages:
  - New call creation → Dispatcher(s)
  - Dispatch assigned → Driver & Vendor
  - Call resolved → Driver
  - Billing details → Payment contact

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       FRONTEND (Angular)                         │
├─────────────────────────────────────────────────────────────────┤
│ • RoadsideCommunicationService                                   │
│ • RoadsideAiCallerComponent (new UI panel)                      │
│ • Integration with existing RoadsideBoardComponent              │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP REST API
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                      BACKEND (Node.js/Express)                   │
├─────────────────────────────────────────────────────────────────┤
│ Routes:                                                          │
│ • POST /api/roadside/calls/:id/ai-call                          │
│ • POST /api/roadside/calls/:id/notify-dispatcher               │
│ • POST /api/roadside/calls/:id/notify-dispatch-assigned        │
│ • POST /api/roadside/calls/:id/notify-resolved                 │
│ • POST /api/roadside/calls/:id/notify-payment-contact          │
│ • GET /api/roadside/calls/:id/recording                        │
│ • POST /webhooks/twilio/call                                    │
│ • POST /webhooks/twilio/status                                  │
│ • POST /webhooks/twilio/recording                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
        ▼                                         ▼
┌──────────────────────┐                ┌──────────────────────┐
│   Twilio API         │                │   SendGrid API       │
│  • Voice Calls       │                │  • Email Sending     │
│  • Recordings        │                │  • Templates         │
│  • Status Webhooks   │                │  • Delivery Tracking │
└──────────────────────┘                └──────────────────────┘
```

## Files Created

### Backend Services

#### 1. **twilio.service.js** (New)
```
Location: backend/packages/goodmen-shared/services/twilio.service.js
Purpose: Twilio integration for voice calls
Key Functions:
  - initiateCall() - Start outbound call with TwiML
  - getCallDetails() - Fetch call status from Twilio
  - getCallRecordingUrl() - Retrieve recording URL
  - generateAiTwiml() - Create TwiML response XML
  - parseIncomingCallWebhook() - Parse Twilio webhook data
  - parseCallStatusWebhook() - Parse call status updates
  - parseRecordingWebhook() - Parse recording metadata
```

#### 2. **roadside-email.service.js** (New)
```
Location: backend/packages/goodmen-shared/services/roadside-email.service.js
Purpose: SendGrid integration for email notifications
Key Functions:
  - sendEmail() - Generic email sender
  - sendCallCreatedNotification() - New call alert to dispatcher
  - sendDispatchAssignedNotification() - Dispatch confirmation
  - sendCallResolvedNotification() - Resolution confirmation
  - sendPaymentContactNotification() - Billing alert
```

### Backend Routes

#### 3. **roadside.js** (Modified)
```
Location: backend/packages/goodmen-shared/routes/roadside.js
Added Endpoints:
  POST /api/roadside/calls/:id/ai-call - Initiate call
  POST /api/roadside/calls/:id/notify-dispatcher - Notify dispatcher
  POST /api/roadside/calls/:id/notify-dispatch-assigned - Notify dispatch
  POST /api/roadside/calls/:id/notify-resolved - Notify resolution
  POST /api/roadside/calls/:id/notify-payment-contact - Notify billing
  GET /api/roadside/calls/:id/recording - Get recording URL
```

#### 4. **public-roadside.js** (Modified)
```
Location: backend/packages/goodmen-shared/routes/public-roadside.js
Added Webhook Endpoints:
  POST /webhooks/twilio/call - Handle call instructions
  POST /webhooks/twilio/status - Handle status updates
  POST /webhooks/twilio/recording - Handle recording completion
```

### Backend Service Integration

#### 5. **roadside.service.js** (Modified)
```
Location: backend/packages/goodmen-shared/services/roadside.service.js
Imports:
  - require('./twilio.service')
  - require('./roadside-email.service')
  
New Functions:
  - initiateAiCall() - Call driver with AI
  - notifyDispatcherNewCall() - Email dispatcher(s)
  - notifyDispatchAssigned() - Email when dispatch assigned
  - notifyCallResolved() - Email when call resolved
  - notifyPaymentContact() - Email billing contact
  - getTwilioCallRecording() - Get recording URL
```

### Frontend Services

#### 6. **roadside-communication.service.ts** (New)
```
Location: frontend/src/app/services/roadside-communication.service.ts
Purpose: Angular service for Twilio/SendGrid API calls
Key Methods:
  - initiateAiCall() - Call driver
  - getCallRecording() - Fetch recording
  - notifyDispatcher() - Alert dispatcher(s)
  - notifyDispatchAssigned() - Alert on dispatch
  - notifyCallResolved() - Alert on resolution
  - notifyPaymentContact() - Alert payment contact
  - isValidPhone() - Phone validation
  - formatPhoneNumber() - Format for display
```

### Frontend Components

#### 7. **roadside-ai-caller.component.ts** (New)
```
Location: frontend/src/app/components/roadside-ai-caller/
Purpose: UI for managing AI calls and notifications
Features:
  - Initiate voice call to driver
  - View call SID and status
  - Fetch call recordings
  - Send dispatcher notifications
  - Send dispatch assigned alert
  - Send resolution confirmation
  - Send billing notifications
```

#### 8. **roadside-ai-caller.component.html** (New)
```
Template with two panels:
Left: AI Voice Call Control
  - Caller info
  - Custom greeting message
  - Call initiation button
  - Recording retrieval
  - Call SID display
  
Right: Notifications & Alerts
  - Dispatcher notification
  - Dispatch assigned alert
  - Resolution confirmation
  - Billing notification
```

#### 9. **roadside-ai-caller.component.css** (New)
```
Dark AI theme styling:
  - Glass-morphism panels
  - Gradient backgrounds (indigo/cyan)
  - Neon blue accents (#93c5fd)
  - Dark input fields
  - Responsive grid layout
  - Mobile breakpoints at 1200px, 768px
```

### Documentation

#### 10. **TWILIO_SENDGRID_CONFIGURATION.md** (New)
```
Location: docs/TWILIO_SENDGRID_CONFIGURATION.md
Contents:
  - Environment variable setup
  - Twilio account creation & configuration
  - SendGrid API key setup
  - All API endpoint examples
  - Testing procedures
  - Troubleshooting guide
  - Webhook signature validation
  - Cost estimates
  - Resource links
```

#### 11. **.env.example** (Created/Updated)
```
Location: .env.example
Contains:
  - TWILIO_ACCOUNT_SID
  - TWILIO_AUTH_TOKEN
  - TWILIO_PHONE_NUMBER
  - TWILIO_TWIML_URL
  - SENDGRID_API_KEY
  - SENDGRID_FROM_EMAIL
  - All other app configuration
```

## Setup Checklist

### Prerequisites
- [ ] Twilio account created (https://www.twilio.com)
- [ ] SendGrid account created (https://sendgrid.com)
- [ ] Twilio phone number purchased
- [ ] Twilio API credentials obtained
- [ ] SendGrid API key generated
- [ ] Sender email verified in SendGrid

### Environment Configuration
- [ ] Copy `.env.example` to `.env`
- [ ] Fill in Twilio credentials:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_PHONE_NUMBER`
  - `TWILIO_TWIML_URL`
- [ ] Fill in SendGrid credentials:
  - `SENDGRID_API_KEY`
  - `SENDGRID_FROM_EMAIL`
- [ ] Update dispatcher emails if needed
- [ ] Set `PUBLIC_APP_BASE_URL` for email links

### Backend Deployment
- [ ] Run `npm install` (twilio and @sendgrid/mail already in package.json)
- [ ] Verify database migrations applied
- [ ] Restart API servers (gateway, drivers-compliance-service)
- [ ] Test webhook endpoints are accessible:
  - `/webhooks/twilio/call`
  - `/webhooks/twilio/status`
  - `/webhooks/twilio/recording`

### Frontend Integration
- [ ] Create `roadside-ai-caller.component.ts`
- [ ] Create `roadside-ai-caller.component.html`
- [ ] Create `roadside-ai-caller.component.css`
- [ ] Create `roadside-communication.service.ts`
- [ ] Import component in roadside board module
- [ ] Add component selector to roadside-board template:
  ```html
  <app-roadside-ai-caller
    [callId]="selectedCall?.id"
    [callerPhone]="selectedCall?.caller_phone"
    [callerName]="selectedCall?.caller_name"
    [callerEmail]="selectedCall?.caller_email"
    [dispatcherEmails]="['dispatcher@company.com']"
    [dispatcherUrl]="dispatcherConsoleUrl"
  ></app-roadside-ai-caller>
  ```

### Testing
- [ ] Test Twilio call initiation:
  - POST to `/api/roadside/calls/{id}/ai-call`
  - Verify phone call received
  - Check call SID in response
- [ ] Test SendGrid notifications:
  - POST to `/api/roadside/calls/{id}/notify-dispatcher`
  - Verify email received
  - Check HTML formatting
- [ ] Test webhooks:
  - Trigger call status webhook
  - Verify event logging
  - Check recording completion webhook
- [ ] Test recording retrieval:
  - GET `/api/roadside/calls/{id}/recording`
  - Verify URL works
  - Test audio playback
- [ ] Test mobile UI:
  - Check responsive layout
  - Verify form inputs on small screens
  - Test button clicks/interactions

## API Usage Examples

### 1. Initiate AI Call

```bash
curl -X POST http://localhost:3000/api/roadside/calls/call123/ai-call \
  -H "Content-Type: application/json" \
  -d '{
    "toPhone": "+12025551234",
    "message": "Hello, help is on the way"
  }'

# Response
{
  "success": true,
  "twilio_call_sid": "CA1234567890abcdef"
}
```

### 2. Notify Dispatcher

```bash
curl -X POST http://localhost:3000/api/roadside/calls/call123/notify-dispatcher \
  -H "Content-Type: application/json" \
  -d '{
    "emails": ["dispatcher@company.com"],
    "url": "https://app.fleetneuron.com/roadside"
  }'

# Response
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

### 3. Notify Dispatch Assigned

```bash
curl -X POST http://localhost:3000/api/roadside/calls/call123/notify-dispatch-assigned \
  -H "Content-Type: application/json" \
  -d '{
    "driverEmail": "driver@company.com",
    "driverPhone": "+12025551234",
    "vendorEmail": "vendor@company.com",
    "publicPortalUrl": "https://app.fleetneuron.com/roadside/..."
  }'

# Response
{
  "driverEmail": { "sent": true },
  "vendorEmail": { "sent": true }
}
```

### 4. Get Call Recording

```bash
curl -X GET http://localhost:3000/api/roadside/calls/call123/recording

# Response
{
  "recording_url": "https://api.twilio.com/2010-04-01/Accounts/.../Recordings/RE....wav"
}
```

## Integration with Existing Features

### With Roadside Board Component

The `RoadsideAiCallerComponent` should be embedded in the `roadside-board.component.html`:

```html
<div class="bottom-panels">
  <div class="panel">
    <!-- Existing dispatch form -->
  </div>
  
  <!-- New AI Caller Panel -->
  <app-roadside-ai-caller
    [callId]="selectedCall?.id"
    [callerPhone]="selectedCall?.caller_phone"
    [callerName]="selectedCall?.caller_name"
    [callerEmail]="selectedCall?.caller_email"
    [dispatcherEmails]="dispatcherEmails"
    [dispatcherUrl]="dispatcherConsoleUrl"
  ></app-roadside-ai-caller>
</div>
```

### Event Logging

All AI calls and email notifications are logged to `roadside_event_logs`:

```javascript
{
  call_id: 'uuid',
  event_type: 'AI_CALL_INITIATED',
  actor_type: 'USER',
  actor_id: 'user-uuid',
  occurred_at: '2026-03-12T...',
  details: {
    twilio_call_sid: 'CA...',
    to_phone: '+1202...',
    auto_answer: true
  }
}
```

### Data Flow

1. **Dispatcher initiates call** → Frontend sends POST to `/ai-call`
2. **Backend creates Twilio call** → Twilio calls driver's phone
3. **TwiML response generated** → Plays greeting, records call
4. **Call status webhook** → Twilio sends status updates
5. **Recording webhook** → Twilio provides recording URL
6. **Frontend fetches recording** → GET `/recording` returns URL
7. **Email notifications sent** → Backend calls SendGrid API
8. **Driver receives email** → Confirmation of dispatch/resolution

## Security Considerations

### Twilio Security
- ✅ Webhook signature validation (optional but recommended)
- ✅ Phone number validation (E.164 format)
- ✅ Token-based access for public endpoints
- ✅ Rate limiting on call initiation

### SendGrid Security
- ✅ API key never logged
- ✅ Email content HTML-escaped
- ✅ Recipient validation
- ✅ TLS encryption for email transmission

### General
- ✅ All webhook endpoints require authentication
- ✅ Context-based authorization (dispatcher access only)
- ✅ Audit logging of all communications
- ✅ HTTPS-only in production

## Monitoring & Alerts

### Key Metrics to Monitor
- Call success rate
- Average call duration
- Email delivery rate
- Recording availability
- API response times

### Log Locations
- Application logs: `dtLogger.info()`, `dtLogger.error()`
- Twilio logs: Twilio Console > Monitor > Logs
- SendGrid logs: SendGrid Dashboard > Mail Send > Logs

### Alert Thresholds
- Call failure rate > 10%
- Email bounce rate > 5%
- Webhook response time > 2s
- Recording processing > 10 min delay

## Troubleshooting Common Issues

### Calls Not Connecting
1. Check phone number format (E.164)
2. Verify Twilio account has credits
3. Check webhook URL is publicly accessible
4. Review Twilio logs for errors

### Emails Not Sending
1. Verify SendGrid API key is valid
2. Check sender email is verified
3. Review SendGrid activity feed
4. Check recipient email format

### Recording Not Available
1. Wait 1-5 minutes after call completes
2. Verify call was recorded (record: true in SDK)
3. Check Twilio recordings in console
4. Verify webhook was received

## Future Enhancements

### Planned Features
- [ ] SMS notifications via Twilio SMS
- [ ] Two-way calling (connect dispatcher to driver)
- [ ] Real-time call transcription
- [ ] AI triage during call
- [ ] Multi-party conference calls
- [ ] Call quality metrics
- [ ] Custom call routing rules
- [ ] Integration with CRM systems

### Performance Optimizations
- [ ] Call initiation timeout optimization
- [ ] Batch email sending
- [ ] Recording file format conversion
- [ ] Webhook retry logic with exponential backoff
- [ ] Caching of call metadata

## Cost Management

### Estimated Monthly Costs (100 calls/month)
- **Twilio**: ~$2-5 (outbound calls + recording)
- **SendGrid**: Free tier (100 emails/day) or Pro (~$30)
- **Total**: ~$2-35/month depending on scale

### Cost Optimization
- Use Twilio free trial for development
- SendGrid free tier for < 100 emails/day
- Consider call duration limits
- Archive recordings periodically
- Use SendGrid templates for batch sends

## References

- [Twilio Node.js SDK](https://github.com/twilio/twilio-node)
- [Twilio Voice API](https://www.twilio.com/docs/voice)
- [Twilio TwiML](https://www.twilio.com/docs/voice/twiml)
- [SendGrid Node.js SDK](https://github.com/sendgrid/sendgrid-nodejs)
- [SendGrid Email API](https://docs.sendgrid.com/api-reference/mail-send/mail-send)
- [SendGrid Email Templates](https://docs.sendgrid.com/for-developers/sending-email/using-handlebars)

---

**Last Updated**: March 12, 2026
**Status**: Implementation Complete, Ready for Testing
**Next Steps**: Deploy to staging, run integration tests, enable in production
