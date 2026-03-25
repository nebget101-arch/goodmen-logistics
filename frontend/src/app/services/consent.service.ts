import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ConsentTemplate {
  consentKey: string;
  title: string;
  version: string;
  effectiveDate: string;
  htmlContent: string;
  requiresSignature: boolean;
}

export interface ConsentCapturedFields {
  fullName?: string;
  dateOfBirth?: string;
  ssnLast4?: string;
  driversLicenseNumber?: string;
  stateOfIssue?: string;
}

export interface ConsentSignaturePayload {
  signerName: string;
  agreed: boolean;
  signedAt: string;
  capturedFields?: ConsentCapturedFields;
}

export interface ConsentStatus {
  consentKey: string;
  status: 'pending' | 'signed';
  signedAt?: string;
  signerName?: string;
  version?: string;
}

@Injectable({ providedIn: 'root' })
export class ConsentService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Load a consent template for a public onboarding packet.
   * GET /public/consents/:packetId/:consentKey?token=...
   */
  loadConsent(packetId: string, consentKey: string, token: string): Observable<ConsentTemplate> {
    const publicBase = this.baseUrl.replace(/\/api\/?$/, '/public/consents');
    return this.http.get<ConsentTemplate>(
      `${publicBase}/${encodeURIComponent(packetId)}/${encodeURIComponent(consentKey)}`,
      { params: { token } }
    );
  }

  /**
   * Sign a consent form for a public onboarding packet.
   * POST /public/consents/:packetId/:consentKey/sign?token=...
   */
  signConsent(
    packetId: string,
    consentKey: string,
    token: string,
    signatureData: ConsentSignaturePayload
  ): Observable<{ success: boolean }> {
    const publicBase = this.baseUrl.replace(/\/api\/?$/, '/public/consents');
    return this.http.post<{ success: boolean }>(
      `${publicBase}/${encodeURIComponent(packetId)}/${encodeURIComponent(consentKey)}/sign`,
      signatureData,
      { params: { token } }
    );
  }

  /**
   * Get all consent statuses for a driver (authenticated endpoint).
   * GET /api/consents/driver/:driverId
   */
  getDriverConsents(driverId: string): Observable<ConsentStatus[]> {
    return this.http.get<ConsentStatus[]>(
      `${this.baseUrl}/consents/driver/${encodeURIComponent(driverId)}`
    );
  }
}
