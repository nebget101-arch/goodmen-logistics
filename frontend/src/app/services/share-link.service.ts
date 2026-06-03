import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * FN-1676 (Story E — Share-link generation + management).
 *
 * Client for the per-load public tracking-link API (FN-1675). Brokers generate
 * a token-only public link, manage expiry/revocation, and see view counts.
 *
 * Security model (mirrors the backend):
 *  - The raw token is returned exactly ONCE, on create. The server stores only
 *    its SHA-256 hash, so a link's URL can never be re-displayed later — the
 *    list endpoint returns metadata only (view counts, expiry, reveal options).
 *    To hand out a fresh URL, revoke and create a new link.
 */

/** Which optional fields the public tracking page may reveal. */
export interface ShareRevealOptions {
  /** Show the assigned driver's name. Default OFF (privacy). */
  driverName: boolean;
  /** Show the vehicle / unit number. Default OFF (privacy). */
  vehicleNumber: boolean;
  /** Show the historical GPS breadcrumb trail. Default OFF (granular). */
  breadcrumbs: boolean;
  /** Show the planned route polyline. Default ON (not sensitive). */
  routeLine: boolean;
}

/**
 * A share link as returned by the list endpoint. No raw token — only metadata.
 * Field names mirror the `load_share_links` table (FN-1674).
 */
export interface ShareLink {
  id: string;
  load_id: string;
  created_at: string;
  /** Null when the link never expires. */
  expires_at: string | null;
  /** Set once the link has been manually revoked. */
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  reveal_options: ShareRevealOptions;
}

/**
 * Create response — the ONLY time the raw token (and therefore the full URL)
 * is available. `url` is server-provided when present; otherwise the caller
 * builds it from `token`.
 */
export interface ShareLinkCreated extends ShareLink {
  /** Raw 32-byte base64url token, shown once. */
  token: string;
  /** Fully-qualified public URL, when the API constructs it server-side. */
  url?: string;
}

/** Body for creating a link. */
export interface CreateShareLinkPayload {
  /** Days after delivery before the link expires; null = never expires. */
  expiryDays: number | null;
  revealOptions: ShareRevealOptions;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class ShareLinkService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /** List the share links for a load (metadata only — no raw tokens). */
  list(loadId: string): Observable<Envelope<ShareLink[]>> {
    return this.http.get<Envelope<ShareLink[]>>(
      `${this.baseUrl}/loads/${loadId}/share-links`,
    );
  }

  /** Create a share link. The response carries the raw token exactly once. */
  create(
    loadId: string,
    payload: CreateShareLinkPayload,
  ): Observable<Envelope<ShareLinkCreated>> {
    return this.http.post<Envelope<ShareLinkCreated>>(
      `${this.baseUrl}/loads/${loadId}/share-links`,
      payload,
    );
  }

  /** Revoke a share link by id (sets revoked_at server-side). */
  revoke(shareLinkId: string): Observable<Envelope<unknown>> {
    return this.http.delete<Envelope<unknown>>(
      `${this.baseUrl}/share-links/${shareLinkId}`,
    );
  }

  /**
   * Resolve the public URL for a freshly-created link. Prefers the
   * server-provided `url`; otherwise builds `{origin}/track/{token}` (the
   * public tracking route owned by Story F / FN-1658).
   */
  buildShareUrl(created: ShareLinkCreated): string {
    if (created.url) return created.url;
    const origin =
      typeof window !== 'undefined' && window.location
        ? window.location.origin
        : '';
    return `${origin}/track/${created.token}`;
  }
}
