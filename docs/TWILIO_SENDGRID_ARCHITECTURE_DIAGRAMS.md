# Twilio & SendGrid Integration - Visual Architecture

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER BROWSERS                                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Dispatcher      │  │  Driver Portal   │  │  Admin Console   │  │
│  │  Web App         │  │  (Public)        │  │                  │  │
│  │  Angular         │  │  Token-based     │  │                  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
└───────────┼───────────────────────┼───────────────────┼─────────────┘
            │                       │                   │
            │ HTTPS REST API        │                   │
            │                       │                   │
┌───────────▼───────────────────────▼───────────────────▼─────────────┐
│                      API GATEWAY & ROUTING                           │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  /api/roadside/calls/:id                                      │ │
│  │  /api/roadside/calls/:id/ai-call          [NEW]               │ │
│  │  /api/roadside/calls/:id/notify-*         [NEW]               │ │
│  │  /webhooks/twilio/*                       [NEW]               │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                ┌──────────┼──────────┐
                │          │          │
                ▼          ▼          ▼
         ┌──────────┐  ┌────────┐  ┌──────────┐
         │Roadside  │  │Twilio  │  │SendGrid  │
         │Service   │  │Service │  │Service   │
         │(Database)│  │(Voice) │  │(Email)   │
         └──────────┘  └────┬───┘  └────┬─────┘
                            │           │
        ┌───────────────────┼───────────┼────────────────┐
        │                   │           │                │
        ▼                   ▼           ▼                ▼
   ┌─────────┐      ┌──────────────┐ ┌───────────┐  ┌────────┐
   │Database │      │Twilio API    │ │SendGrid   │  │Email   │
   │(Events, │      │(SIP Trunks,  │ │API        │  │Server  │
   │Calls)   │      │Recording)    │ │(SMTP)     │  │(SMTP)  │
   └─────────┘      └──────────────┘ └───────────┘  └────────┘
```

## Data Flow Diagrams

### Voice Call Flow

```
┌─────────────┐          ┌─────────────┐          ┌──────────────┐
│  Dispatcher │          │   Backend   │          │    Twilio    │
│  UI/Button  │          │   API       │          │   Service    │
└─────┬───────┘          └─────────────┘          └──────┬───────┘
      │                                                    │
      │ 1. Click "Initiate AI Call"                       │
      ├──────────────────────────────────────────────────►│
      │ POST /api/roadside/calls/123/ai-call              │
      │ { toPhone: "+1202..." }                           │
      │                                                    │
      │                  2. Create Twilio Call            │
      │                  ◄──────────────────────────────┤
      │                                                    │
      │                  3. Return Call SID               │
      │ ◄──────────────────────────────────────────────┤
      │ { success: true, twilio_call_sid: "CA..." }      │
      │                                                    │
      │ 4. Display Call SID in UI                        │
      │                                                    │
      │                  5. Twilio Calls Driver Phone
      │                  (Plays greeting, records)
      │
      │  6. Call Status Webhooks
      │     initiated → ringing → answered → completed
      │
      │  7. Recording Available (1-5 min later)
      │
      │ 8. Click "Fetch Recording"
      ├──────────────────────────────────────────────────►│
      │ GET /api/roadside/calls/123/recording              │
      │                                                    │
      │ ◄──────────────────────────────────────────────┤
      │ { recording_url: "https://api.twilio.com/...." }  │
      │                                                    │
      │ 9. Play Recording in Browser
      │
```

### Email Notification Flow

```
┌─────────────┐          ┌─────────────┐          ┌──────────────┐
│  Dispatcher │          │   Backend   │          │   SendGrid   │
│  UI/Button  │          │   API       │          │   Service    │
└─────┬───────┘          └─────────────┘          └──────┬───────┘
      │                                                    │
      │ 1. Click "Notify Dispatcher"                      │
      ├──────────────────────────────────────────────────►│
      │ POST /api/roadside/calls/123/notify-dispatcher    │
      │ { emails: ["d1@co.com", "d2@co.com"] }           │
      │                                                    │
      │                  2. Prepare Email HTML            │
      │                  - Call number, caller, urgency   │
      │                  - Dispatcher console link         │
      │                                                    │
      │                  3. Send via SendGrid             │
      │                  sgMail.send({ to, subject, html })
      │                                                    │
      │                  4. Return Message IDs            │
      │ ◄──────────────────────────────────────────────┤
      │ { sent: true, results: [...] }                    │
      │                                                    │
      │ 5. Display Success in UI                         │
      │                                                    │
      │  6. SendGrid Delivers Emails
      │     - Dispatcher receives "New Roadside Call"
      │     - Contains call details and action link
      │
```

### Complete Roadside Call Lifecycle

```
Driver Incident
       │
       ▼
┌──────────────────┐
│ Driver Calls 911 │
│ or Uses App      │
└────────┬─────────┘
         │
         ▼
┌────────────────────────┐
│ Roadside Call Created  │
│ in Database            │  ──► EVENT: CALL_CREATED
└────────┬───────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Dispatcher Notified            │  ──► EMAIL: sendCallCreatedNotification()
│ (email sent)                   │      To: dispatcher@co.com
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Dispatcher Reviews Call        │
│ • Caller info                  │
│ • Location                     │  ──► TRIAGE: AI Assessment
│ • Issue details                │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Dispatcher Initiates AI Call   │  ──► POST /ai-call
│ • Click "Initiate AI Call"     │      Twilio calls driver
│ • Custom greeting played       │      Call recorded
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Driver Receives AI Call        │  ──► Twilio Voice API
│ • Listens to options           │      Recording starts
│ • Responds to prompts          │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Dispatcher Assigns Dispatch    │  ──► DATABASE: Dispatch Assignment
│ • Select vendor/service        │      EVENT: DISPATCH_ASSIGNED
│ • Set ETA                      │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Driver & Vendor Notified       │  ──► EMAIL: sendDispatchAssignedNotification()
│ • Driver: "Help on the way"    │      To: driver@email.com
│ • Vendor: "New assignment"     │      To: vendor@email.com
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Vendor Arrives & Fixes Issue   │
│ • Driver provides details      │
│ • Issue resolved               │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Dispatcher Marks Call Resolved │  ──► DATABASE: Status = RESOLVED
│ • Enter resolution notes       │      EVENT: CALL_RESOLVED
│ • Payment details (optional)   │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Driver Notified of Resolution  │  ──► EMAIL: sendCallResolvedNotification()
│ • Thank you message            │      To: driver@email.com
│ • Rating request (optional)    │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Payment Contact Notified       │  ──► EMAIL: sendPaymentContactNotification()
│ • Invoice attached             │      To: billing@company.com
│ • Service details              │      With estimated cost
│ • Payment link                 │
└────────────────────────────────┘
```

## Component Structure

```
RoadsideBoardComponent
├── leftPanel
│   ├── callListPanel
│   ├── triageFormPanel
│   └── dispatchFormPanel
└── rightPanel
    ├── callerProfileCard
    ├── driverDetailsCard
    ├── timelinePanel
    └── RoadsideAiCallerComponent [NEW]
        ├── aiCallPanel
        │   ├── callerInfo
        │   ├── greetingMessageForm
        │   ├── initiateCallButton
        │   ├── callSidDisplay
        │   └── recordingSection
        │       ├── fetchRecordingButton
        │       └── playRecordingButton
        │
        └── notificationsPanel
            ├── notifyDispatcherSection
            │   ├── dispatcherEmailsInput
            │   └── notifyButton
            │
            ├── notifyDispatchAssignedSection
            │   └── notifyButton
            │
            ├── notifyResolvedSection
            │   └── notifyButton
            │
            └── notifyPaymentSection
                ├── paymentEmailInput
                ├── costInput
                ├── invoiceUrlInput
                └── notifyButton
```

## Service Dependency Graph

```
Angular App
    │
    ├─► RoadsideCommunicationService
    │   └─► HttpClient
    │       └─► Backend API
    │
    ├─► RoadsideService (existing)
    │   ├─► HttpClient
    │   └─► Database
    │
    └─► AccessControlService (existing)

Backend API
    │
    ├─► roadsideService.js
    │   ├─► twilioService.js
    │   │   └─► Twilio SDK
    │   │       └─► Twilio API
    │   │
    │   ├─► roadsideEmailService.js
    │   │   └─► SendGrid SDK
    │   │       └─► SendGrid API
    │   │
    │   └─► Database (roadside_event_logs, etc.)
    │
    └─► Routes
        ├─► /api/roadside/calls/:id
        ├─► /webhooks/twilio
        │
        └─► [Request Flow]
            ├─► Authentication
            ├─► Authorization
            ├─► Service Call
            ├─► Database Transaction
            ├─► Webhook Processing
            └─► Response
```

## Email Template Flow

```
┌─────────────────────────────────────────────────────┐
│  roadsideEmailService.js                            │
├─────────────────────────────────────────────────────┤
│                                                      │
│ ┌──────────────────────────────────────────────┐   │
│ │ sendCallCreatedNotification()                │   │
│ │                                              │   │
│ │ Subject: 🚨 New Roadside Call [URGENT]      │   │
│ │                                              │   │
│ │ HTML Template:                               │   │
│ │  ┌────────────────────────────────────────┐ │   │
│ │  │ New Roadside Incident Call             │ │   │
│ │  │ ─────────────────────────────────      │ │   │
│ │  │ Call #: RS-20260312-0001               │ │   │
│ │  │ Caller: John Doe (+1202-555-1234)      │ │   │
│ │  │ Issue: Flat Tire                       │ │   │
│ │  │ Urgency: 🔴 CRITICAL                   │ │   │
│ │  │ Location: Highway 101, Mile 42         │ │   │
│ │  │                                         │ │   │
│ │  │ [View in Dispatcher Console]            │ │   │
│ │  └────────────────────────────────────────┘ │   │
│ └──────────────────────────────────────────────┘   │
│                                                      │
│ ┌──────────────────────────────────────────────┐   │
│ │ sendDispatchAssignedNotification()           │   │
│ │                                              │   │
│ │ [To Driver]:                                 │   │
│ │ Subject: Help is on the Way! 🚗              │   │
│ │                                              │   │
│ │ [To Vendor]:                                 │   │
│ │ Subject: New Assignment: Roadside Call ...   │   │
│ └──────────────────────────────────────────────┘   │
│                                                      │
│ ┌──────────────────────────────────────────────┐   │
│ │ sendCallResolvedNotification()               │   │
│ │                                              │   │
│ │ Subject: Your Roadside Call is Resolved ✓   │   │
│ │ Message: Thank you for using our service    │   │
│ └──────────────────────────────────────────────┘   │
│                                                      │
│ ┌──────────────────────────────────────────────┐   │
│ │ sendPaymentContactNotification()             │   │
│ │                                              │   │
│ │ Subject: Invoice for Roadside Service       │   │
│ │ Message: Billing details attached           │   │
│ └──────────────────────────────────────────────┘   │
│                                                      │
└─────────────────────────────────────────────────────┘
         │
         ▼
    SendGrid API
         │
         ▼
    Email Delivery
    (SMTP to recipient)
```

## Webhook Processing Flow

```
Twilio Service
    │
    ├─► Initiates Call
    │   └─► URL: /webhooks/twilio/call?callId=123
    │
    ├─► Call Status Changes
    │   └─► POST /webhooks/twilio/status?callId=123
    │       Payload: CallSid, CallStatus, CallDuration
    │
    └─► Recording Completes
        └─► POST /webhooks/twilio/recording?callId=123
            Payload: RecordingSid, RecordingUrl, RecordingDuration


Backend Webhook Handler
    │
    ├─► 1. Parse webhook data
    │   └─► Extract callId, callSid, status, recording info
    │
    ├─► 2. Log event
    │   └─► INSERT INTO roadside_event_logs
    │       { call_id, event_type, details }
    │
    ├─► 3. Update call status (optional)
    │   └─► UPDATE roadside_calls SET status = ...
    │
    ├─► 4. Process recording (optional)
    │   └─► INSERT INTO roadside_media
    │       { call_id, storage_key, mime_type }
    │
    └─► 5. Return 200 OK
        └─► Acknowledge to Twilio
```

## State Diagram - Roadside Call

```
     ┌─────────┐
     │  START  │
     └────┬────┘
          │ createCall()
          ▼
     ┌─────────┐
     │  OPEN   │ ◄─────────────────┐
     └────┬────┘                   │
          │                        │ (retry)
          │ triage()               │
          ▼                        │
     ┌──────────┐                  │
     │ TRIAGED  │ ─────────────────┘
     └────┬─────┘
          │ initiateAiCall()
          ▼
     ┌────────────┐
     │  AI_CALL   │
     │ INITIATED  │
     └────┬───────┘
          │
          ├─► webhook: call status updates
          ├─► webhook: call recording ready
          │
          │ assignDispatch()
          ▼
     ┌────────────┐
     │ DISPATCHED │ ◄──────────────┐
     └────┬───────┘                │
          │                        │ (reassign)
          │ notifyDispatchAssigned()
          │ (email sent)
          │
          │ resolveCall()
          ▼
     ┌────────────┐
     │ RESOLVED   │
     └────┬───────┘
          │ notifyCallResolved()
          │ notifyPaymentContact()
          │ (emails sent)
          │
          ▼
     ┌─────────┐
     │   END   │
     └─────────┘
```

---

**These diagrams show**:
1. Complete system architecture
2. Data flow for voice calls
3. Data flow for email notifications
4. Full call lifecycle
5. Component hierarchy
6. Service dependencies
7. Email template structure
8. Webhook processing
9. Call state transitions

Use these for architectural discussions, onboarding, and system documentation.
