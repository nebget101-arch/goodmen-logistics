# Frontend Integration Guide - Roadside AI Caller Component

## Quick Start

### 1. Add Component to Module

In your roadside or shared module (`*.module.ts`):

```typescript
import { RoadsideAiCallerComponent } from './components/roadside-ai-caller/roadside-ai-caller.component';
import { RoadsideCommunicationService } from './services/roadside-communication.service';

@NgModule({
  declarations: [
    RoadsideAiCallerComponent,
    // ... other components
  ],
  imports: [
    CommonModule,
    FormsModule, // Required for ngModel
    HttpClientModule,
    // ... other imports
  ],
  providers: [
    RoadsideCommunicationService,
    // ... other services
  ]
})
export class RoadsideModule { }
```

### 2. Add Material Symbols Icons

Ensure Material Symbols are imported in your `index.html`:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
```

Or in your `angular.json`:

```json
{
  "styles": [
    "node_modules/@angular/material/prebuilt-themes/indigo-pink.css",
    "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0"
  ]
}
```

### 3. Integrate into Roadside Board

In `roadside-board.component.html`, add the component to the dispatcher panel:

```html
<div class="roadside-board-container">
  <!-- Existing panels -->
  <div class="left-column">
    <!-- Existing call list, triage, dispatch panels -->
  </div>

  <div class="right-column">
    <!-- Add AI Caller Component -->
    <app-roadside-ai-caller
      *ngIf="selectedCall"
      [callId]="selectedCall.id"
      [callerPhone]="selectedCall.caller_phone"
      [callerName]="selectedCall.caller_name"
      [callerEmail]="selectedCall.caller_email"
      [dispatcherEmails]="dispatcherEmails"
      [dispatcherUrl]="dispatcherConsoleUrl"
    ></app-roadside-ai-caller>

    <!-- Existing timeline and other panels -->
  </div>
</div>
```

### 4. Update Roadside Board Component

In `roadside-board.component.ts`:

```typescript
import { RoadsideCommunicationService } from '../../services/roadside-communication.service';

export class RoadsideBoardComponent implements OnInit {
  selectedCall: any = null;
  dispatcherEmails = ['dispatcher@company.com']; // Or load from config
  dispatcherConsoleUrl = window.location.origin + '/roadside';

  constructor(
    private roadsideService: RoadsideService,
    private communicationService: RoadsideCommunicationService
  ) {}

  selectCall(call: any): void {
    this.selectedCall = call;
    // Component will automatically display with inputs
  }
}
```

## Component Inputs

```typescript
@Input() callId: string;              // Roadside call UUID
@Input() callerPhone: string;         // Driver phone number
@Input() callerName: string;          // Driver name
@Input() callerEmail: string;         // Driver email
@Input() dispatcherEmails: string[]; // Dispatcher email list
@Input() dispatcherUrl: string;       // Link to dispatcher console
```

## Component Features

### AI Voice Call Section
- **Initiate Call**: Click button to start voice call
- **Custom Message**: Optional greeting message to play
- **Call SID**: Unique Twilio identifier for the call
- **Recording**: Fetch and play call recording (after call ends)

### Notifications Section
- **Notify Dispatcher**: Email dispatcher(s) about new call
- **Dispatch Assigned**: Email driver and vendor when dispatch assigned
- **Call Resolved**: Email driver when incident is resolved
- **Billing Notification**: Email payment contact with invoice

## Service Methods

### RoadsideCommunicationService

```typescript
// Initiate call
await communicationService.initiateAiCall(
  callId: string,
  toPhone: string,
  message?: string
): Promise<{ success: boolean; twilio_call_sid?: string; error?: string }>

// Get recording
await communicationService.getCallRecording(
  callId: string
): Promise<{ recording_url?: string; error?: string }>

// Send notifications
await communicationService.notifyDispatcher(
  callId: string,
  emails: string[],
  dispatcherUrl?: string
): Promise<{ sent: boolean; results?: any[] }>

await communicationService.notifyDispatchAssigned(
  callId: string,
  config: {
    driverEmail?: string;
    driverPhone?: string;
    vendorEmail?: string;
    publicPortalUrl?: string;
  }
): Promise<{ driverEmail?: any; vendorEmail?: any }>

// Validation utilities
communicationService.isValidPhone(phone: string): boolean
communicationService.formatPhoneNumber(phone: string): string
```

## Environment Setup

Add to `environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  twilioEnabled: true,
  sendGridEnabled: true
};
```

Add to `environment.prod.ts`:

```typescript
export const environment = {
  production: true,
  apiUrl: 'https://api.fleetneuron.com/api',
  twilioEnabled: true,
  sendGridEnabled: true
};
```

## Styling Integration

The component uses the dark AI theme consistent with the roadside board:

```css
/* Panel styling */
.panel {
  background: linear-gradient(165deg, rgba(15, 23, 42, 0.96) 0%, rgba(2, 6, 23, 0.94) 100%);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  box-shadow: 0 4px 34px rgba(13, 110, 253, 0.15);
}

/* Color scheme */
Primary Blue: #3b82f6
Accent Blue: #93c5fd
Dark Background: #0f172a
Text: #e2e8f0
Muted Text: #cbd5e1
```

## Example Usage

### In a Parent Component

```typescript
export class RoadsideBoardComponent implements OnInit {
  selectedCall: any;
  dispatcherEmails = ['dispatcher1@company.com', 'dispatcher2@company.com'];

  selectCall(call: any): void {
    this.selectedCall = call;
    
    // Optional: Auto-notify dispatcher on call selection
    if (call.status === 'OPEN') {
      // User can manually click "Notify Dispatcher" button
    }
  }

  onDispatchAssigned(): void {
    // Called after dispatch assignment
    // User can click "Notify Driver & Vendor" button
  }

  onCallResolved(): void {
    // Called when marking call resolved
    // User can click "Notify Resolution" button
  }
}
```

### In Template

```html
<app-roadside-ai-caller
  *ngIf="selectedCall"
  [callId]="selectedCall.id"
  [callerPhone]="selectedCall.caller_phone"
  [callerName]="selectedCall.caller_name"
  [callerEmail]="selectedCall.caller_email"
  [dispatcherEmails]="dispatcherEmails"
  [dispatcherUrl]="dispatcherConsoleUrl"
></app-roadside-ai-caller>
```

## Testing

### Unit Tests

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RoadsideAiCallerComponent } from './roadside-ai-caller.component';
import { RoadsideCommunicationService } from '../../services/roadside-communication.service';

describe('RoadsideAiCallerComponent', () => {
  let component: RoadsideAiCallerComponent;
  let fixture: ComponentFixture<RoadsideAiCallerComponent>;
  let communicationService: jasmine.SpyObj<RoadsideCommunicationService>;

  beforeEach(async () => {
    const spy = jasmine.createSpyObj('RoadsideCommunicationService', [
      'initiateAiCall',
      'getCallRecording',
      'notifyDispatcher',
      'notifyDispatchAssigned',
      'notifyCallResolved',
      'notifyPaymentContact',
      'isValidPhone',
      'formatPhoneNumber'
    ]);

    await TestBed.configureTestingModule({
      declarations: [RoadsideAiCallerComponent],
      providers: [
        { provide: RoadsideCommunicationService, useValue: spy }
      ]
    }).compileComponents();

    communicationService = TestBed.inject(
      RoadsideCommunicationService
    ) as jasmine.SpyObj<RoadsideCommunicationService>;
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(RoadsideAiCallerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initiate AI call with valid phone', async () => {
    component.callId = 'test-call-id';
    component.callerPhone = '+12025551234';

    communicationService.initiateAiCall.and.returnValue(
      Promise.resolve({
        success: true,
        twilio_call_sid: 'CA1234567890'
      })
    );

    await component.initiateAiCall();

    expect(communicationService.initiateAiCall).toHaveBeenCalledWith(
      'test-call-id',
      '+12025551234',
      undefined
    );
    expect(component.callInitiated).toBe(true);
  });
});
```

### Integration Testing

```bash
# Start the app
ng serve

# Navigate to roadside board
http://localhost:4200/roadside

# Test flow:
1. Select a call from the list
2. Click "Initiate AI Call" button
3. Wait for call to connect
4. Verify phone receives call
5. Click "Fetch Recording" after call ends
6. Send dispatcher notifications
7. Test other notification buttons
```

## Troubleshooting

### Component Not Displaying
- Verify component is declared in module
- Check if condition: `*ngIf="selectedCall"`
- Verify all @Input properties are bound
- Check browser console for errors

### Calls Not Going Through
- Verify Twilio credentials in environment
- Check phone number format (E.164)
- Verify network connectivity
- Check Twilio logs in console

### Notifications Not Sending
- Verify SendGrid API key is set
- Check sender email is verified
- Verify recipient email format
- Check SendGrid activity feed

### Styling Issues
- Ensure Material Symbols fonts loaded
- Verify CSS variables are set
- Check for conflicting CSS
- Use browser DevTools to inspect styles

## API Response Handling

The component handles API responses with built-in error display:

```typescript
// Errors are displayed in red alert boxes
.alert-error {
  background: rgba(127, 29, 29, 0.9);
  color: #fecaca;
  border: 1px solid rgba(220, 38, 38, 0.5);
}

// Success states show confirmation
callInitiated = true;  // Button changes to "Call Initiated"
dispatcherNotified = true;  // Button shows confirmation
```

## Performance Optimization

The component is optimized for performance:

1. **Lazy Loading**: Only renders when selectedCall is available
2. **Change Detection**: Uses OnPush strategy (when available)
3. **API Caching**: Recording URLs are cached locally
4. **Debouncing**: Button clicks are debounced to prevent double-submission
5. **Responsive**: CSS media queries for mobile devices

## Security Considerations

- Phone numbers are validated before API calls
- Email addresses are validated
- API requests use authenticated HTTP interceptors
- Sensitive data (call SID) is displayed read-only
- HTTPS enforced in production

## Accessibility Features

- Material Symbols icons with fallback text
- Semantic HTML structure
- Form labels associated with inputs
- Color contrast meets WCAG AA standards
- Keyboard navigation support
- Screen reader friendly

---

**Last Updated**: March 12, 2026
**Status**: Ready for Integration
**Next Steps**: Add to module, integrate with roadside board, test in development
