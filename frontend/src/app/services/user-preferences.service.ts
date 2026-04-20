import { Injectable } from '@angular/core';

/**
 * UserPreferencesService (FN-764)
 *
 * Persists per-user UI preferences in localStorage so the Load Wizard can
 * suggest smart defaults (e.g., most-recent driver for a dispatcher).
 *
 * Keys are namespaced by dispatcher id, so a shared browser between two
 * dispatchers still produces the correct per-user suggestion.
 */
@Injectable({ providedIn: 'root' })
export class UserPreferencesService {

  private static readonly RECENT_DRIVER_PREFIX = 'fn_recent_driver_by_dispatcher:';

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
