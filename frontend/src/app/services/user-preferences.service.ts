import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export type UserPreferences = Record<string, any>;

export interface LoadsSavedView {
  id: string;
  name: string;
  filters: {
    status?: string;
    billingStatus?: string;
    driverId?: string;
    q?: string;
    needsReview?: boolean;
    source?: string;
  };
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export interface LoadsDashboardPrefs {
  columnVisibility?: Record<string, boolean>;
  savedViews?: LoadsSavedView[];
}

/**
 * UserPreferencesService
 *
 * Combines two preference surfaces:
 *  - Server-persisted prefs (FN-767) — column visibility + saved filter views,
 *    stored in `users.preferences` JSONB and fetched via `/api/user-preferences`.
 *  - Local-only prefs (FN-764) — recent driver per dispatcher, cached in
 *    localStorage so the Load Wizard can suggest smart defaults. Keyed by
 *    dispatcher id so a shared browser between two dispatchers still produces
 *    the correct per-user suggestion.
 */
@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly baseUrl = `${environment.apiUrl}/user-preferences`;

  private readonly prefs$ = new BehaviorSubject<UserPreferences>({});
  private loaded = false;

  private static readonly RECENT_DRIVER_PREFIX = 'fn_recent_driver_by_dispatcher:';

  constructor(private http: HttpClient) {}

  /** Current cached preferences snapshot (may be empty before load()). */
  get snapshot(): UserPreferences {
    return this.prefs$.value;
  }

  /** Observable stream of preferences; emits the cached value immediately. */
  watch(): Observable<UserPreferences> {
    return this.prefs$.asObservable();
  }

  /**
   * Loads preferences from the backend once and caches them. Subsequent calls
   * return the cached value. Callers that need a forced refresh can pass force.
   */
  load(force = false): Observable<UserPreferences> {
    if (this.loaded && !force) return of(this.prefs$.value);
    return this.http.get<{ success: boolean; data: UserPreferences }>(this.baseUrl).pipe(
      map((res) => (res && res.data) ? res.data : {}),
      tap((prefs) => {
        this.loaded = true;
        this.prefs$.next(prefs || {});
      }),
      catchError(() => {
        this.loaded = true;
        this.prefs$.next({});
        return of({} as UserPreferences);
      })
    );
  }

  /**
   * Shallow-merges a patch at the top level, persists it, and updates the cache.
   * Use nested keys (e.g. { loadsDashboard: { columnVisibility: {...} } }) to
   * scope prefs per feature.
   */
  patch(patch: UserPreferences): Observable<UserPreferences> {
    return this.http.put<{ success: boolean; data: UserPreferences }>(this.baseUrl, patch).pipe(
      map((res) => (res && res.data) ? res.data : { ...this.prefs$.value, ...patch }),
      tap((prefs) => this.prefs$.next(prefs || {})),
      catchError(() => {
        // Optimistic local update so UI stays responsive on transient failures.
        const merged = { ...this.prefs$.value, ...patch };
        this.prefs$.next(merged);
        return of(merged);
      })
    );
  }

  /** Convenience accessor for the loads-dashboard namespace. */
  getLoadsDashboardPrefs(): LoadsDashboardPrefs {
    const prefs = this.prefs$.value || {};
    return (prefs['loadsDashboard'] as LoadsDashboardPrefs) || {};
  }

  /** Persist a patch scoped to the loads-dashboard namespace. */
  patchLoadsDashboard(patch: Partial<LoadsDashboardPrefs>): Observable<UserPreferences> {
    const current = this.getLoadsDashboardPrefs();
    const next: LoadsDashboardPrefs = { ...current, ...patch };
    return this.patch({ loadsDashboard: next });
  }

  /** Returns the most-recently-used driver id for the given dispatcher, or null. */
  getRecentDriverId(dispatcherId: string | null | undefined): string | null {
    if (!dispatcherId) { return null; }
    try {
      return localStorage.getItem(this._driverKey(dispatcherId)) || null;
    } catch {
      return null;
    }
  }

  /** Stores `driverId` as the most-recently-used driver for `dispatcherId`. */
  setRecentDriverId(dispatcherId: string | null | undefined, driverId: string | null | undefined): void {
    if (!dispatcherId || !driverId) { return; }
    try {
      localStorage.setItem(this._driverKey(dispatcherId), driverId);
    } catch {
      /* quota exceeded — preferences are best-effort */
    }
  }

  /** Clears the stored recent driver for a dispatcher. */
  clearRecentDriverId(dispatcherId: string | null | undefined): void {
    if (!dispatcherId) { return; }
    try {
      localStorage.removeItem(this._driverKey(dispatcherId));
    } catch {
      /* noop */
    }
  }

  private _driverKey(dispatcherId: string): string {
    return `${UserPreferencesService.RECENT_DRIVER_PREFIX}${dispatcherId}`;
  }
}
