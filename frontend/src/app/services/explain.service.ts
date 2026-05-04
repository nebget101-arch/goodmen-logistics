import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, throwError } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/**
 * Where the rationale came from. `link` lets the panel render a "View source row"
 * action that jumps to the underlying record (router-internal commands or external href).
 */
export interface ExplainSource {
  id?: string;
  label: string;
  detail?: string;
  link?: ExplainLink;
}

export interface ExplainLink {
  label?: string;
  routerLink?: (string | number)[];
  queryParams?: Record<string, string | number | boolean>;
  href?: string;
}

export interface ExplainRule {
  id?: string;
  label: string;
  detail?: string;
  matched?: boolean;
}

/** Numeric signal that contributed to the score. `value` and `weight` are 0-1 floats. */
export interface ExplainScore {
  label: string;
  value: number;
  weight?: number;
  detail?: string;
}

/**
 * Full rationale payload returned by `GET /api/ai/explain/:token`.
 * Tokens expire 30 days after mint (FN-1132 AC); the gateway returns 404/410 in that case
 * and the panel surfaces a "no longer available" message.
 */
export interface ExplainResponse {
  token: string;
  subject: string;
  summary?: string;
  generatedAt?: string;
  expiresAt?: string;
  sources: ExplainSource[];
  rules: ExplainRule[];
  scores: ExplainScore[];
}

/** State for the panel: which token is currently being explained, plus a display label. */
export interface ExplainPanelState {
  token: string;
  label?: string;
}

@Injectable({ providedIn: 'root' })
export class ExplainService {
  private readonly endpoint = `${environment.apiUrl}/ai/explain`;

  private readonly panelState$ = new BehaviorSubject<ExplainPanelState | null>(null);
  private readonly cache = new Map<string, Observable<ExplainResponse>>();

  constructor(private readonly http: HttpClient) {}

  /** Stream of the currently-open panel state (null when closed). */
  get state$(): Observable<ExplainPanelState | null> {
    return this.panelState$.asObservable();
  }

  open(token: string, label?: string): void {
    if (!token) return;
    const current = this.panelState$.value;
    if (current && current.token === token && current.label === label) return;
    this.panelState$.next({ token, label });
  }

  close(): void {
    if (this.panelState$.value === null) return;
    this.panelState$.next(null);
  }

  /**
   * Fetch the rationale for a token. Cached per-token for the lifetime of the service
   * — re-opening the same explanation does not re-hit the gateway.
   */
  getExplanation(token: string): Observable<ExplainResponse> {
    if (!token) {
      return throwError(() => new Error('Missing explainability token'));
    }
    const cached = this.cache.get(token);
    if (cached) return cached;

    const req$ = this.http
      .get<ExplainResponse>(`${this.endpoint}/${encodeURIComponent(token)}`)
      .pipe(
        catchError((err) => {
          this.cache.delete(token);
          return throwError(() => err);
        }),
        shareReplay(1),
      );
    this.cache.set(token, req$);
    return req$;
  }

  /** Clear cached explanations (e.g. on logout / tenant switch). */
  clearCache(): void {
    this.cache.clear();
  }
}
