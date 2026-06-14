import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  SignerView,
  SignSubmission,
  SignResult,
} from '../agreements/signature-request.model';

/**
 * FN-1798 — client for the public, token-gated signing routes (FN-1797).
 * These are UNAUTHENTICATED (no JWT) and mirror the public-employer-investigation
 * pattern: the base URL strips the `/api` suffix and uses the `/public` prefix.
 *
 *   GET  /public/agreements/sign/:token  → document + fields + status (sets `viewed`)
 *   POST /public/agreements/sign/:token  → record signature, generate signed PDF
 */
@Injectable({ providedIn: 'root' })
export class PublicSignService {
  private base = `${environment.apiUrl.replace(/\/api\/?$/, '')}/public/agreements/sign`;

  constructor(private http: HttpClient) {}

  /** Load the agreement for the signer. Marks the request `viewed` server-side. */
  getSignerView(token: string): Observable<SignerView> {
    return this.http.get<SignerView>(`${this.base}/${encodeURIComponent(token)}`);
  }

  /** Submit the signer's field values + signature; returns the signed-PDF URL. */
  submit(token: string, payload: SignSubmission): Observable<SignResult> {
    return this.http.post<SignResult>(
      `${this.base}/${encodeURIComponent(token)}`,
      payload
    );
  }
}
