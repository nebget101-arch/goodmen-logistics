import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  PublicTrackEnvelope,
  PublicTrackErrorReason,
  PublicTrackPayload
} from './public-track.models';

/**
 * FN-1678 — client for the unauthenticated public tracking endpoint
 * (`GET /api/track/:token`, FN-1679). Deliberately tiny: one read, no auth
 * state, no token storage. The shared {@link AuthInterceptor} only attaches an
 * `Authorization` header when a token already lives in localStorage, so a
 * logged-out shipper hits the endpoint cleanly and a logged-in broker's token
 * is simply ignored by the public route.
 *
 * Errors are normalized to a {@link PublicTrackErrorReason} so the component
 * can render the right empty state (404 → not found, 410 → expired/revoked)
 * without leaking server error text.
 */
@Injectable({ providedIn: 'root' })
export class PublicTrackService {
  private readonly baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Fetch the tracking payload for a share token. The token is path-encoded so
   * a malformed value can't break out of the path segment. Emits the payload
   * on success; errors with a {@link PublicTrackErrorReason} string.
   */
  fetch(token: string): Observable<PublicTrackPayload> {
    const url = `${this.baseUrl}/track/${encodeURIComponent(token)}`;
    return this.http.get<PublicTrackEnvelope>(url).pipe(
      map((res) => res.data),
      catchError((err: HttpErrorResponse) =>
        throwError(() => PublicTrackService.reasonFromStatus(err.status))
      )
    );
  }

  /** Map an HTTP status to a public-safe error reason. */
  static reasonFromStatus(status: number): PublicTrackErrorReason {
    if (status === 404) return 'not_found';
    if (status === 410) return 'gone';
    return 'error';
  }
}
