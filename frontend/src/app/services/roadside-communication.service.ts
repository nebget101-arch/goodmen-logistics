import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Service for Twilio and SendGrid integration in roadside feature
 * Handles voice calls, call recordings, and email notifications
 */
@Injectable({
  providedIn: 'root'
})
export class RoadsideCommunicationService {
  private apiUrl = `${environment.apiUrl}/roadside`;

  constructor(private http: HttpClient) {}

  /**
   * Initiate an AI voice call to caller
   * @param callId - Roadside call ID
   * @param toPhone - Recipient phone number
   * @param message - Optional greeting message
   * @returns Promise with call SID and status
   */
  async initiateAiCall(
    callId: string,
    toPhone: string,
    message?: string
  ): Promise<{ success: boolean; twilio_call_sid?: string; error?: string }> {
    return firstValueFrom(
      this.http.post<any>(`${this.apiUrl}/calls/${callId}/ai-call`, {
        toPhone,
        message,
        autoAnswer: true
      })
    );
  }

  /**
   * Get call recording URL if available
   * @param callId - Roadside call ID
   * @returns Promise with recording URL
   */
  async getCallRecording(
    callId: string
  ): Promise<{ recording_url?: string; error?: string }> {
    return firstValueFrom(
      this.http.get<any>(`${this.apiUrl}/calls/${callId}/recording`)
    ).catch(() => ({ error: 'No recording found' }));
  }

  /**
   * Send notification email to dispatcher(s) when new call is created
   * @param callId - Roadside call ID
   * @param emails - Array of dispatcher email addresses
   * @param dispatcherUrl - Link to dispatcher console
   * @returns Promise with notification status
   */
  async notifyDispatcher(
    callId: string,
    emails: string[],
    dispatcherUrl?: string
  ): Promise<{ sent: boolean; results?: any[]; error?: string }> {
    return firstValueFrom(
      this.http.post<any>(`${this.apiUrl}/calls/${callId}/notify-dispatcher`, {
        emails,
        url: dispatcherUrl
      })
    );
  }

  /**
   * Send notification emails when dispatch is assigned
   * @param callId - Roadside call ID
   * @param config - Configuration with email addresses and portal URL
   * @returns Promise with notification status
   */
  async notifyDispatchAssigned(
    callId: string,
    config: {
      driverEmail?: string;
      driverPhone?: string;
      vendorEmail?: string;
      publicPortalUrl?: string;
    }
  ): Promise<{ driverEmail?: any; vendorEmail?: any; error?: string }> {
    return firstValueFrom(
      this.http.post<any>(
        `${this.apiUrl}/calls/${callId}/notify-dispatch-assigned`,
        config
      )
    );
  }

  /**
   * Send notification when roadside call is resolved
   * @param callId - Roadside call ID
   * @param config - Configuration with email and resolution notes
   * @returns Promise with notification status
   */
  async notifyCallResolved(
    callId: string,
    config: {
      driverEmail?: string;
      resolutionNotes?: string;
      dispatcherEmail?: string;
    }
  ): Promise<{ sent: boolean; error?: string }> {
    return firstValueFrom(
      this.http.post<any>(`${this.apiUrl}/calls/${callId}/notify-resolved`, config)
    );
  }

  /**
   * Send billing notification to payment contact
   * @param callId - Roadside call ID
   * @param config - Configuration with payment email, cost, and invoice
   * @returns Promise with notification status
   */
  async notifyPaymentContact(
    callId: string,
    config: {
      paymentEmail?: string;
      estimatedCost?: string;
      invoiceUrl?: string;
    }
  ): Promise<{ sent: boolean; error?: string }> {
    return firstValueFrom(
      this.http.post<any>(
        `${this.apiUrl}/calls/${callId}/notify-payment-contact`,
        config
      )
    );
  }

  /**
   * Check if Twilio is configured
   * @returns boolean
   */
  isTwilioConfigured(): boolean {
    return !!localStorage.getItem('twilio-configured');
  }

  /**
   * Check if SendGrid is configured
   * @returns boolean
   */
  isSendGridConfigured(): boolean {
    return !!localStorage.getItem('sendgrid-configured');
  }

  /**
   * Format phone number for display
   * @param phone - Phone number
   * @returns Formatted phone number
   */
  formatPhoneNumber(phone: string): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11) {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return phone;
  }

  /**
   * Validate phone number format
   * @param phone - Phone number
   * @returns boolean
   */
  isValidPhone(phone: string): boolean {
    const digits = phone.replace(/\D/g, '');
    return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
  }
}
