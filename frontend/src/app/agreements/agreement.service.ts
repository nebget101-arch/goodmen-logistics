import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  AgreementTemplate,
  AgreementTemplateDetail,
  AgreementFieldPatch,
} from './agreement.model';
import {
  CreateSignatureRequestPayload,
  SignatureRequest,
} from './signature-request.model';
import {
  EquipmentLeaseSigning,
  EquipmentLeaseSubjectType,
  StartEquipmentLeaseSigningPayload,
  StartEquipmentLeaseSigningResult,
} from './equipment-lease-signing.model';

/**
 * FN-1794 — client for the agreement template / field-map endpoints (FN-1793).
 *
 *   POST   /api/agreements/templates           → upload PDF, create draft + AI field map
 *   GET    /api/agreements/templates            → list templates (no field maps)
 *   GET    /api/agreements/templates/:id        → template + ordered field map
 *   PATCH  /api/agreements/templates/:id/fields → save role/label edits, finalize
 *
 * FN-1798 — fill → send signature request endpoints (FN-1797):
 *
 *   POST   /api/agreements/:templateId/requests → create request, send signer link
 *   GET    /api/agreements/requests/:id         → request status + signed-PDF URL
 *
 * FN-1801 — equipment / motor-carrier lease adapter (FN-1800):
 *
 *   POST   /api/agreements/equipment-lease/requests           → start a lease
 *            signing for a vehicle / equipment-owner subject (links it back)
 *   GET    /api/agreements/equipment-lease/requests?subjectType=&subjectId=
 *            → the subject's lease signings with live status + signed-PDF URL
 *
 * Every template-returning endpoint serves the flat template DTO with a nested
 * `fields` array (FN-1793 `getTemplateWithFields`). Upload is a direct multipart
 * POST (`file` + `name`); the backend stores to R2 and runs detection inline.
 */
@Injectable({ providedIn: 'root' })
export class AgreementService {
  private base = `${environment.apiUrl}/agreements`;

  constructor(private http: HttpClient) {}

  /** Upload a source PDF and create a draft template; response includes the AI field map. */
  createTemplate(file: File, name: string): Observable<AgreementTemplateDetail> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    return this.http.post<AgreementTemplateDetail>(`${this.base}/templates`, fd);
  }

  /** Fetch a template with its ordered field map and a signed source-download URL. */
  getTemplate(id: string): Observable<AgreementTemplateDetail> {
    return this.http.get<AgreementTemplateDetail>(`${this.base}/templates/${id}`);
  }

  /**
   * Persist reviewed role assignments / labels. Backend honors only `role` and
   * `label` per field. Pass `finalize: true` to flip the template to `ready`.
   */
  saveFields(
    id: string,
    fields: AgreementFieldPatch[],
    finalize = false
  ): Observable<AgreementTemplateDetail> {
    return this.http.patch<AgreementTemplateDetail>(
      `${this.base}/templates/${id}/fields`,
      { fields, finalize }
    );
  }

  /** List existing templates (most-recent first), without field maps. */
  listTemplates(): Observable<AgreementTemplate[]> {
    return this.http.get<AgreementTemplate[]>(`${this.base}/templates`);
  }

  // ── FN-1798: signature requests (internal fill → send) ──────────────────────

  /**
   * Create a signature request for a finalized template: persists the carrier's
   * `internal` field values + signer contact, generates a tokenized link and
   * sends it to the signer. Returns `{ requestId, signerLink, status }`.
   */
  createRequest(
    templateId: string,
    payload: CreateSignatureRequestPayload
  ): Observable<SignatureRequest> {
    return this.http.post<SignatureRequest>(
      `${this.base}/${templateId}/requests`,
      payload
    );
  }

  /** Poll a request's status and signed-PDF download URL once signed. */
  getRequest(id: string): Observable<SignatureRequest> {
    return this.http.get<SignatureRequest>(`${this.base}/requests/${id}`);
  }

  // ── FN-1801: equipment / motor-carrier lease adapter (FN-1800) ──────────────

  /**
   * Start an Equipment/Motor-Carrier Lease Agreement signing for a subject (a
   * fleet vehicle or an equipment-owner / lessor payee). Delegates to the generic
   * engine and records the equipment linkage so the signing shows on the
   * subject's record. Returns `{ requestId, signerLink, status, link }`.
   */
  startEquipmentLeaseSigning(
    payload: StartEquipmentLeaseSigningPayload
  ): Observable<StartEquipmentLeaseSigningResult> {
    return this.http.post<StartEquipmentLeaseSigningResult>(
      `${this.base}/equipment-lease/requests`,
      payload
    );
  }

  /**
   * List a subject's lease signings (newest first), each enriched with the live
   * request status (sent / viewed / signed) and a signed-PDF download URL once
   * signed. Backs the lease-status display on the vehicle / equipment-owner record.
   */
  listEquipmentLeaseSignings(
    subjectType: EquipmentLeaseSubjectType,
    subjectId: string
  ): Observable<EquipmentLeaseSigning[]> {
    const params = new HttpParams()
      .set('subjectType', subjectType)
      .set('subjectId', subjectId);
    return this.http
      .get<{ data: EquipmentLeaseSigning[] }>(`${this.base}/equipment-lease/requests`, { params })
      .pipe(map((res) => res?.data ?? []));
  }
}
