import { Injectable } from '@angular/core';
import { BehaviorSubject, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';

export interface TrialState {
  /** e.g. 'trial' | 'expired' | 'converted' | null */
  trialStatus: string | null;
  /**
   * True when trial-status loaded successfully but the trial has not been
   * admin-approved yet: the tenant exists, but `trial_status` is null and there
   * is no managed subscription. The UI renders an explicit "pending activation"
   * state instead of a blank banner / empty trial fields. A genuine non-trial
   * user instead errors out (403/404) and yields a null state, so this never
   * fires for them. See FN-1732 / FN-1734.
   */
  pending: boolean;
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
  /**
   * Stripe subscription status from FN-1688 `GET /api/billing/subscription`,
   * e.g. 'active' | 'past_due' | 'canceled' | 'trialing' | 'unpaid'. Null when
   * the endpoint is unavailable (Story C not yet deployed) — the page degrades
   * gracefully to trial-only state.
   */
  subscriptionStatus: string | null;
  /** True when the subscription is set to cancel at the end of the current period. */
  cancelAtPeriodEnd: boolean;
  /** End of the current billing period (also the cancellation effective date). */
  currentPeriodEnd: Date | null;
  /** Next renewal date (null when cancelling at period end). */
  nextRenewal: Date | null;
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
      payment: this.api.getBillingPaymentMethod(),
      // Resilient: FN-1688 subscription endpoint may not be deployed yet —
      // a failure here must not blank out the trial/payment state.
      subscription: this.api.getBillingSubscription().pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ status, payment, subscription }) => {
        const s = status?.data || {};
        const p = payment?.data || {};
        const sub = subscription?.data || subscription || {};

        this._state$.next({
          trialStatus: s.trial_status ?? null,
          // Pending = loaded OK, but no trial status and no managed subscription
          // (tenant created via self-signup, awaiting admin trial approval).
          pending: !s.trial_status && !sub.status,
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
          cardExpYear: Number.isFinite(Number(p.expYear)) ? Number(p.expYear) : null,
          subscriptionStatus: sub.status ? String(sub.status) : null,
          cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
          currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
          nextRenewal: sub.nextRenewal ? new Date(sub.nextRenewal) : null
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
