import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

const RECENT_SEARCHES_KEY = 'fleetneuron.command_palette.recent_searches';
const RECENT_SEARCHES_LIMIT = 5;

/**
 * FN-802 — CommandPaletteService
 *
 * Owns open/close state of the global command palette and persists the user's
 * most recent natural-language queries so we can show them when the palette
 * opens with an empty input.
 *
 * The component itself is mounted once at app root and reacts to `open$`.
 */
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private readonly _open$ = new BehaviorSubject<boolean>(false);

  get open$(): Observable<boolean> {
    return this._open$.asObservable();
  }

  get isOpen(): boolean {
    return this._open$.value;
  }

  open(): void {
    if (!this._open$.value) { this._open$.next(true); }
  }

  close(): void {
    if (this._open$.value) { this._open$.next(false); }
  }

  toggle(): void {
    this._open$.next(!this._open$.value);
  }

  /** Read the last 5 queries the user submitted. Empty when nothing stored. */
  getRecentSearches(): string[] {
    try {
      const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (!raw) { return []; }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * Push a query onto the recent-searches list. Most recent first; duplicates
   * removed (case-insensitive); list capped at 5.
   */
  pushRecentSearch(query: string): void {
    const trimmed = (query || '').trim();
    if (!trimmed) { return; }
    const lower = trimmed.toLowerCase();
    const existing = this.getRecentSearches().filter(q => q.toLowerCase() !== lower);
    const next = [trimmed, ...existing].slice(0, RECENT_SEARCHES_LIMIT);
    try {
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      // localStorage may be unavailable (private mode, quota); silently skip.
    }
  }

  clearRecentSearches(): void {
    try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* noop */ }
  }
}
