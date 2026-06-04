import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { TrialStateService, TrialState } from '../shared/services/trial-state.service';
import { PaymentMethodFormComponent } from './payment-method-form/payment-method-form.component';
import { ApiService } from '../services/api.service';
import { ToastService } from '../shared/toast/toast.service';
import {
  MARKETING_PLANS,
  MarketingPlan,
  getMarketingPlan,
  getPlanMonthlyPriceUsd,
  getPlanRank
} from '../public/config/marketing.config';

/** Invoice row from FN-1688 `GET /api/billing/invoices`. */
export interface BillingInvoice {
  id: string;
  created: number;
  amountDue: number;
  amountPaid: number;
  status: string;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
}

/** Seat usage from `GET /api/billing/seat-usage`. */
export interface BillingSeatUsage {
  includedUsers: number | null;
  extraPaidSeats: number;
  effectiveSeatLimit: number | null;
  activeUsers: number;
  additionalUserPriceUsd: number | null;
  canPurchaseExtraSeat: boolean;
}

/** Relationship of an offered plan to the tenant's current plan. */
export type PlanRelation = 'current' | 'upgrade' | 'downgrade' | 'contact';

type PendingActionType = 'change' | 'cancel';

interface PendingAction {
  type: PendingActionType;
  /** Target plan for a 'change' action. */
  plan?: MarketingPlan;
}

@Component({
  selector: 'app-billing',
  templateUrl: './billing.component.html',
  styleUrls: ['./billing.component.scss']
})
export class BillingComponent implements OnInit, OnDestroy {
  state: TrialState | null = null;
  loading = true;

  // Payment-method removal (trial users only)
  removing = false;
  removeError = '';
  removeSuccess = '';

  // Plans — single source of truth (FN-317: readonly class field, never a getter binding)
  readonly plans: MarketingPlan[] = MARKETING_PLANS;

  // Invoice history
  invoices: BillingInvoice[] = [];
  invoicesLoading = false;
  invoicesError = '';

  // Seat usage (drives the "upgrade to unlock" prompt)
  seatUsage: BillingSeatUsage | null = null;

  // Stripe Customer Portal hand-off
  portalLoading = false;

  // Confirmation modal for change-plan / cancel
  pending: PendingAction | null = null;
  actionInFlight = false;
  actionError = '';

  private sub?: Subscription;

  constructor(
    private readonly trialState: TrialStateService,
    private readonly api: ApiService,
    private readonly dialog: MatDialog,
    private readonly toast: ToastService
  ) {}

  ngOnInit(): void {
    this.sub = this.trialState.state$.subscribe(s => {
      this.state = s;
      this.loading = false;
    });
    // Always force a fresh fetch when opening the billing page
    this.trialState.refresh();
    this.loadInvoices();
    this.loadSeatUsage();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  // ── Trial / subscription status ───────────────────────────────────────────
  get isInTrial(): boolean {
    return this.state?.trialStatus === 'trial';
  }

  get isExpired(): boolean {
    return this.state?.trialStatus === 'expired';
  }

  get isConverted(): boolean {
    return this.state?.trialStatus === 'converted';
  }

  get isPastDue(): boolean {
    return this.state?.subscriptionStatus === 'past_due' || this.state?.subscriptionStatus === 'unpaid';
  }

  get cancelAtPeriodEnd(): boolean {
    return Boolean(this.state?.cancelAtPeriodEnd);
  }

  /** Banner severity for the contextual status panel. */
  get statusSeverity(): 'good' | 'info' | 'warning' | 'critical' {
    if (this.isPastDue || this.isExpired) return 'critical';
    if (this.cancelAtPeriodEnd) return 'warning';
    if (this.isInTrial) return 'info';
    return 'good';
  }

  // ── Plans ───────────────────────────────────────────────────────────────────
  get currentPlan(): MarketingPlan | undefined {
    return getMarketingPlan(this.state?.planId ?? null);
  }

  /** Has the tenant converted to a paid, manageable subscription? */
  get hasActiveSubscription(): boolean {
    return this.isConverted || this.state?.subscriptionStatus === 'active' || this.isPastDue;
  }

  planRelation(plan: MarketingPlan): PlanRelation {
    const current = this.state?.planId ?? null;
    if (current && plan.id === current) return 'current';
    if (plan.ctaAction === 'contact') return 'contact';
    const currentRank = getPlanRank(current);
    const targetRank = getPlanRank(plan.id);
    if (currentRank < 0) return 'upgrade';
    return targetRank > currentRank ? 'upgrade' : 'downgrade';
  }

  // ── Seat limits ──────────────────────────────────────────────────────────────
  get seatLimitReached(): boolean {
    const u = this.seatUsage;
    if (!u || u.effectiveSeatLimit == null) return false;
    return u.activeUsers >= u.effectiveSeatLimit;
  }

  // ── Proration preview (client-side, from the single plan source) ──────────────
  get prorationPreview(): string {
    if (!this.pending || this.pending.type !== 'change' || !this.pending.plan) return '';
    const target = this.pending.plan;
    const relation = this.planRelation(target);
    const targetPrice = getPlanMonthlyPriceUsd(target);
    const currentPrice = getPlanMonthlyPriceUsd(this.currentPlan);

    if (relation === 'upgrade') {
      const delta =
        targetPrice != null && currentPrice != null ? ` (+$${targetPrice - currentPrice}/mo)` : '';
      return `Upgrading to ${target.name}${delta} takes effect immediately. Stripe charges a prorated amount for the rest of this billing period; future invoices bill at the new rate.`;
    }
    if (relation === 'downgrade') {
      return `Downgrading to ${target.name} applies a prorated credit toward your next invoice, which will bill at the lower rate. Make sure your usage fits the lower plan's limits.`;
    }
    return '';
  }

  // ── Data loads ────────────────────────────────────────────────────────────────
  loadInvoices(): void {
    this.invoicesLoading = true;
    this.invoicesError = '';
    this.api.getBillingInvoices().subscribe({
      next: (res: any) => {
        const list = res?.invoices ?? res?.data?.invoices ?? [];
        this.invoices = Array.isArray(list) ? list : [];
        this.invoicesLoading = false;
      },
      error: () => {
        // Endpoint may be unavailable until FN-1688 deploys; degrade quietly.
        this.invoices = [];
        this.invoicesLoading = false;
      }
    });
  }

  loadSeatUsage(): void {
    this.api.getBillingSeatUsage().subscribe({
      next: (res: any) => {
        this.seatUsage = (res?.data ?? null) as BillingSeatUsage | null;
      },
      error: () => {
        this.seatUsage = null;
      }
    });
  }

  // ── Invoice display helpers ────────────────────────────────────────────────────
  /** Stripe `created` is unix seconds; normalize to ms for the date pipe. */
  invoiceDateMs(created: number): number {
    return created < 1e12 ? created * 1000 : created;
  }

  /** Stripe invoice amounts are in the smallest currency unit (cents). */
  invoiceAmount(cents: number): number {
    return Number.isFinite(Number(cents)) ? Number(cents) / 100 : 0;
  }

  // ── Actions ──────────────────────────────────────────────────────────────────
  openPaymentDialog(): void {
    const dialogRef = this.dialog.open(PaymentMethodFormComponent, {
      width: '540px',
      maxWidth: '96vw',
      disableClose: false,
      panelClass: 'payment-method-dialog'
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (result?.cardSaved) {
        this.trialState.refresh();
      }
    });
  }

  async removeCard(): Promise<void> {
    this.removeError = '';
    this.removeSuccess = '';
    this.removing = true;

    try {
      await firstValueFrom(this.api.removeBillingPaymentMethod());
      this.removeSuccess = 'Payment method removed.';
      this.trialState.refresh();
    } catch (err: any) {
      this.removeError = err?.error?.error || err?.message || 'Failed to remove payment method.';
    } finally {
      this.removing = false;
    }
  }

  async openPortal(): Promise<void> {
    this.portalLoading = true;
    try {
      const res: any = await firstValueFrom(this.api.createBillingPortalSession());
      const url = res?.url ?? res?.data?.url;
      if (url) {
        this.redirect(url);
      } else {
        this.toast.error('Could not open the billing portal. Please try again.');
        this.portalLoading = false;
      }
    } catch {
      this.toast.error('Could not open the billing portal. Please try again.');
      this.portalLoading = false;
    }
  }

  /** Full-page redirect to the Stripe-hosted portal. Isolated so it can be spied in tests. */
  protected redirect(url: string): void {
    window.location.href = url;
  }

  // ── Confirmation flow ──────────────────────────────────────────────────────────
  requestChangePlan(plan: MarketingPlan): void {
    this.actionError = '';
    this.pending = { type: 'change', plan };
  }

  requestCancel(): void {
    this.actionError = '';
    this.pending = { type: 'cancel' };
  }

  closeConfirm(): void {
    if (this.actionInFlight) return;
    this.pending = null;
    this.actionError = '';
  }

  async confirmAction(): Promise<void> {
    if (!this.pending) return;
    this.actionInFlight = true;
    this.actionError = '';
    const action = this.pending;
    try {
      if (action.type === 'cancel') {
        await firstValueFrom(this.api.cancelBillingSubscription());
        this.toast.success('Your subscription will cancel at the end of the billing period.');
      } else if (action.type === 'change' && action.plan) {
        await firstValueFrom(this.api.changeBillingPlan(action.plan.id));
        this.toast.success(`Plan changed to ${action.plan.name}.`);
      }
      this.pending = null;
      this.trialState.refresh();
      this.loadInvoices();
      this.loadSeatUsage();
    } catch (err: any) {
      this.actionError =
        err?.error?.error || err?.error?.message || err?.message || 'Something went wrong. Please try again.';
    } finally {
      this.actionInFlight = false;
    }
  }
}
