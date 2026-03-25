import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface ConsentTemplate {
  consentKey: string;
  title: string;
  version: string;
  effectiveDate: string;
  htmlContent: string;
  requiresSignature: boolean;
  captureFields?: string[];
}

export interface ConsentCapturedFields {
  fullName?: string;
  dateOfBirth?: string;
  ssnLast4?: string;
  driversLicenseNumber?: string;
  stateOfIssue?: string;
}

export interface ConsentLoadResult {
  template: ConsentTemplate;
  isSigned: boolean;
  consent: { id: string; status: string; signed_at: string; signer_name: string } | null;
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
  loadConsent(packetId: string, consentKey: string, token: string): Observable<ConsentLoadResult> {
    const publicBase = this.baseUrl.replace(/\/api\/?$/, '/public/consents');
    return this.http.get<Record<string, unknown>>(
      `${publicBase}/${encodeURIComponent(packetId)}/${encodeURIComponent(consentKey)}`,
      { params: { token } }
    ).pipe(
      map((resp: Record<string, unknown>) => {
        // FN-240: API returns { template: { body_text, ... }, consent, isSigned, ... }
        // Frontend expects flat ConsentTemplate with htmlContent
        const tpl = (resp['template'] || resp) as Record<string, unknown>;
        const template: ConsentTemplate = {
          consentKey: (tpl['key'] as string) || consentKey,
          title: (tpl['title'] as string) || '',
          version: String(tpl['version'] || ''),
          effectiveDate: (tpl['effective_date'] as string) || (tpl['effectiveDate'] as string) || '',
          htmlContent: (tpl['body_text'] as string) || (tpl['htmlContent'] as string) || '',
          requiresSignature: (tpl['requires_signature'] as boolean) ?? (tpl['requiresSignature'] as boolean) ?? true,
          captureFields: (tpl['capture_fields'] as string[]) || (tpl['captureFields'] as string[]) || []
        };
        return {
          template,
          isSigned: !!resp['isSigned'],
          consent: (resp['consent'] as ConsentLoadResult['consent']) || null
        };
      })
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
   * Get all signed consent statuses for a public onboarding packet.
   * GET /public/consents/:packetId/status?token=...
   */
  getConsentStatuses(packetId: string, token: string): Observable<{ consents: { consent_key: string; status: string; signed_at: string }[] }> {
    const publicBase = this.baseUrl.replace(/\/api\/?$/, '/public/consents');
    return this.http.get<{ consents: { consent_key: string; status: string; signed_at: string }[] }>(
      `${publicBase}/${encodeURIComponent(packetId)}/status`,
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
