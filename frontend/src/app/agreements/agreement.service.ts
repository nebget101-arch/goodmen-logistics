import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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
import { FieldMapSavePayload } from './agreement-placement/bbox-editor.logic';

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

  /**
   * FN-1807 — persist visual placement edits (geometry + adds/deletes) from the
   * bbox editor. Uses the FN-1808 `PATCH .../fields` body `{ fields, adds, deletes }`:
   *   - `fields`  — existing fields whose `page`/`bbox`/`role`/`label` changed
   *   - `adds`    — user-drawn boxes (no id; manual → `confidence: null`)
   *   - `deletes` — server ids of removed fields
   * Backward compatible with `saveFields` (which sends only `fields`). Returns the
   * refreshed template so server-assigned ids for additions are picked up. See
   * docs/design/agreements-bbox-coordinates.md.
   */
  savePlacement(
    id: string,
    payload: FieldMapSavePayload,
    finalize = false
  ): Observable<AgreementTemplateDetail> {
    return this.http.patch<AgreementTemplateDetail>(
      `${this.base}/templates/${id}/fields`,
      { ...payload, finalize }
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
}
