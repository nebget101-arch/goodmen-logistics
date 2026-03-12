import { Component, Input, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RoadsideCommunicationService } from '../../services/roadside-communication.service';

/**
 * Component for AI call initiation and notification management
 * Allows dispatchers to call driver, send notifications, and manage communications
 */
@Component({
  selector: 'app-roadside-ai-caller',
  templateUrl: './roadside-ai-caller.component.html',
  styleUrls: ['./roadside-ai-caller.component.css']
})
export class RoadsideAiCallerComponent implements OnInit {
  @Input() callId: string = '';
  @Input() callerPhone: string = '';
  @Input() callerName: string = '';
  @Input() callerEmail: string = '';
  @Input() dispatcherEmails: string[] = [];
  @Input() dispatcherUrl: string = '';

  // Call control
  initiatingCall = false;
  callInitiated = false;
  callSid: string = '';
  callError: string = '';

  // Recording
  recordingUrl: string = '';
  fetchingRecording = false;

  // Notifications
  notifyingDispatcher = false;
  dispatcherNotified = false;
  dispatcherNotifyError: string = '';

  notifyingDispatchAssigned = false;
  dispatchAssignedError: string = '';

  notifyingResolved = false;
  callResolvedError: string = '';

  notifyingPayment = false;
  paymentNotifyError: string = '';

  // Forms
  greetingMessage = '';
  dispatcherEmailsText = '';
  estimatedCost = '';
  paymentEmail = '';
  invoiceUrl = '';

  constructor(private communicationService: RoadsideCommunicationService) {}

  ngOnInit(): void {
    this.dispatcherEmailsText = this.dispatcherEmails.join(', ');
  }

  /**
   * Initiate AI voice call to driver
   */
  async initiateAiCall(): Promise<void> {
    if (!this.callId || !this.callerPhone) {
      alert('Call ID and phone number are required');
      return;
    }

    if (!this.communicationService.isValidPhone(this.callerPhone)) {
      alert('Invalid phone number format');
      return;
    }

    this.initiatingCall = true;
    this.callError = '';

    try {
      const result = await this.communicationService.initiateAiCall(
        this.callId,
        this.callerPhone,
        this.greetingMessage || undefined
      );

      if (result.success) {
        this.callSid = result.twilio_call_sid || '';
        this.callInitiated = true;
      } else {
        this.callError = result.error || 'Failed to initiate call';
      }
    } catch (error: any) {
      this.callError = error.message || 'Error initiating call';
    } finally {
      this.initiatingCall = false;
    }
  }

  /**
   * Get call recording URL
   */
  async fetchRecording(): Promise<void> {
    if (!this.callId) return;

    this.fetchingRecording = true;

    try {
      const result = await this.communicationService.getCallRecording(
        this.callId
      );

      if (result.recording_url) {
        this.recordingUrl = result.recording_url;
      } else {
        alert('No recording available yet. Recordings may take a few minutes to process.');
      }
    } catch (error: any) {
      alert('Error fetching recording: ' + error.message);
    } finally {
      this.fetchingRecording = false;
    }
  }

  /**
   * Notify dispatcher(s) of new call
   */
  async notifyDispatcher(): Promise<void> {
    if (!this.callId) return;

    const emails = this.dispatcherEmailsText
      .split(',')
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (emails.length === 0) {
      alert('Please enter at least one dispatcher email');
      return;
    }

    this.notifyingDispatcher = true;
    this.dispatcherNotifyError = '';

    try {
      const result = await this.communicationService.notifyDispatcher(
        this.callId,
        emails,
        this.dispatcherUrl
      );

      if (result.sent) {
        this.dispatcherNotified = true;
      } else {
        this.dispatcherNotifyError =
          result.error || 'Failed to notify dispatcher';
      }
    } catch (error: any) {
      this.dispatcherNotifyError = error.message || 'Error notifying dispatcher';
    } finally {
      this.notifyingDispatcher = false;
    }
  }

  /**
   * Notify driver and vendor when dispatch is assigned
   */
  async notifyDispatchAssigned(): Promise<void> {
    if (!this.callId) return;

    this.notifyingDispatchAssigned = true;
    this.dispatchAssignedError = '';

    try {
      const result = await this.communicationService.notifyDispatchAssigned(
        this.callId,
        {
          driverEmail: this.callerEmail,
          driverPhone: this.callerPhone,
          publicPortalUrl: this.dispatcherUrl
        }
      );

      if (result.driverEmail?.sent) {
        alert('Dispatch notification sent to driver');
      } else {
        this.dispatchAssignedError = 'Failed to notify dispatch assignment';
      }
    } catch (error: any) {
      this.dispatchAssignedError = error.message;
    } finally {
      this.notifyingDispatchAssigned = false;
    }
  }

  /**
   * Notify driver when call is resolved
   */
  async notifyCallResolved(): Promise<void> {
    if (!this.callId) return;

    this.notifyingResolved = true;
    this.callResolvedError = '';

    try {
      const result = await this.communicationService.notifyCallResolved(
        this.callId,
        {
          driverEmail: this.callerEmail,
          resolutionNotes: 'Your roadside incident has been resolved'
        }
      );

      if (result.sent) {
        alert('Resolution notification sent to driver');
      } else {
        this.callResolvedError = result.error || 'Failed to send notification';
      }
    } catch (error: any) {
      this.callResolvedError = error.message;
    } finally {
      this.notifyingResolved = false;
    }
  }

  /**
   * Notify payment contact about billing
   */
  async notifyPayment(): Promise<void> {
    if (!this.callId || !this.paymentEmail) {
      alert('Payment email is required');
      return;
    }

    this.notifyingPayment = true;
    this.paymentNotifyError = '';

    try {
      const result = await this.communicationService.notifyPaymentContact(
        this.callId,
        {
          paymentEmail: this.paymentEmail,
          estimatedCost: this.estimatedCost || undefined,
          invoiceUrl: this.invoiceUrl || undefined
        }
      );

      if (result.sent) {
        alert('Payment notification sent');
      } else {
        this.paymentNotifyError = result.error || 'Failed to send notification';
      }
    } catch (error: any) {
      this.paymentNotifyError = error.message;
    } finally {
      this.notifyingPayment = false;
    }
  }

  /**
   * Format phone for display
   */
  getFormattedPhone(phone: string): string {
    return this.communicationService.formatPhoneNumber(phone);
  }

  /**
   * Open recording in new window
   */
  openRecording(): void {
    if (this.recordingUrl) {
      window.open(this.recordingUrl, '_blank');
    }
  }

  /**
   * Copy call SID to clipboard
   */
  copyCallSid(): void {
    if (this.callSid) {
      navigator.clipboard.writeText(this.callSid).then(() => {
        alert('Call SID copied to clipboard');
      });
    }
  }
}
