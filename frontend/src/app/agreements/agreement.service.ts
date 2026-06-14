import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AgreementTemplate,
  AgreementTemplateDetail,
  AgreementFieldPatch,
} from './agreement.model';

/**
 * FN-1794 — client for the agreement template / field-map endpoints (FN-1793).
 *
 *   POST   /api/agreements/templates           → upload PDF, create draft + AI field map
 *   GET    /api/agreements/templates            → list templates (no field maps)
 *   GET    /api/agreements/templates/:id        → template + ordered field map
 *   PATCH  /api/agreements/templates/:id/fields → save role/label edits, finalize
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
}
