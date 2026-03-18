import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../services/api.service';

export interface TrialState {
  /** e.g. 'trial' | 'expired' | 'converted' | null */
  trialStatus: string | null;
  trialEnd: Date | null;
  daysRemaining: number | null;
  planAmount: number | null;
  planId: string | null;
  planName: string | null;
  hasPaymentMethod: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
}

@Injectable({ providedIn: 'root' })
export class TrialStateService {
  private readonly _state$ = new BehaviorSubject<TrialState | null>(null);
  private fetchInProgress = false;
  private loaded = false;

  /** Observable stream of the current trial + billing state. */
  readonly state$ = this._state$.asObservable();

  /** Synchronous snapshot of the latest state (may be null before first load). */
  get snapshot(): TrialState | null {
    return this._state$.value;
  }

  constructor(private readonly api: ApiService) {}

  /**
   * Load trial state once on first call.
   * Subsequent calls are no-ops until refresh() is called explicitly.
   */
  load(): void {
    if (this.loaded) return;
    this.refresh();
  }

  /** Force re-fetch trial status and payment method. Safe to call anytime. */
  refresh(): void {
    if (this.fetchInProgress) return;
    this.fetchInProgress = true;
    this.loaded = true;

    forkJoin({
      status: this.api.getBillingTrialStatus(),
      payment: this.api.getBillingPaymentMethod()
    }).subscribe({
      next: ({ status, payment }) => {
        const s = status?.data || {};
        const p = payment?.data || {};

        this._state$.next({
          trialStatus: s.trial_status ?? null,
          trialEnd: s.trial_end ? new Date(s.trial_end) : null,
          daysRemaining: Number.isFinite(Number(s.daysRemaining))
            ? Math.max(0, Math.floor(Number(s.daysRemaining)))
            : null,
          planAmount: Number.isFinite(Number(s.planAmount)) ? Number(s.planAmount) : null,
          planId: s.planId ? String(s.planId) : null,
          planName: s.planName ? String(s.planName) : null,
          hasPaymentMethod: Boolean(p.hasCard),
          cardBrand: p.brand ? String(p.brand) : null,
          cardLast4: p.last4 ? String(p.last4) : null,
          cardExpMonth: Number.isFinite(Number(p.expMonth)) ? Number(p.expMonth) : null,
          cardExpYear: Number.isFinite(Number(p.expYear)) ? Number(p.expYear) : null
        });
        this.fetchInProgress = false;
      },
      error: () => {
        // API failure (403/404 for non-trial users) → silently hide banner
        this._state$.next(null);
        this.fetchInProgress = false;
      }
    });
  }

  /** Reset the cached state and allow the next load() call to re-fetch. */
  reset(): void {
    this.loaded = false;
    this.fetchInProgress = false;
    this._state$.next(null);
  }
}
