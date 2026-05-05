import { Injectable, OnDestroy } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { distinctUntilChanged, filter, takeUntil } from 'rxjs/operators';

export type DashboardWindow = 'today' | '7d' | '30d';

export const DASHBOARD_WINDOWS: readonly DashboardWindow[] = ['today', '7d', '30d'];
export const DEFAULT_DASHBOARD_WINDOW: DashboardWindow = '7d';

const URL_PARAM = 'window';

function coerceWindow(raw: unknown): DashboardWindow | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return (DASHBOARD_WINDOWS as readonly string[]).includes(v) ? (v as DashboardWindow) : null;
}

/**
 * FN-1332 — global Today/7d/30d window selector state.
 * Source of truth is the `?window=` URL param so the choice survives reloads
 * and shares cleanly across the KPI strip, Action Queue, and any other
 * window-scoped widget.
 */
@Injectable({ providedIn: 'root' })
export class DashboardWindowService implements OnDestroy {
  private readonly window$$ = new BehaviorSubject<DashboardWindow>(DEFAULT_DASHBOARD_WINDOW);
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
  ) {
    const initial = coerceWindow(this.router.routerState.snapshot.root.queryParamMap.get(URL_PARAM));
    if (initial) this.window$$.next(initial);

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        const next = coerceWindow(this.router.routerState.snapshot.root.queryParamMap.get(URL_PARAM));
        const current = this.window$$.value;
        if (next && next !== current) this.window$$.next(next);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Hot stream of the active window. Emits current value to new subscribers. */
  window$(): Observable<DashboardWindow> {
    return this.window$$.pipe(distinctUntilChanged());
  }

  current(): DashboardWindow {
    return this.window$$.value;
  }

  /**
   * Update the active window. Persists in the URL via `?window=` so the choice
   * is shareable and survives reloads. No-op when the window is already set.
   */
  setWindow(next: DashboardWindow): void {
    if (next === this.window$$.value) return;
    this.window$$.next(next);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [URL_PARAM]: next },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
