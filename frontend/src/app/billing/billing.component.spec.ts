import { of, throwError, BehaviorSubject } from 'rxjs';
import { BillingComponent } from './billing.component';
import { TrialState } from '../shared/services/trial-state.service';
import { getMarketingPlan } from '../public/config/marketing.config';

/**
 * FN-1698 — logic specs for the billing page. The component is exercised with
 * lightweight mocks rather than full template rendering so the plan/proration/
 * invoice logic is covered without pulling in Stripe / Material / primitives.
 */
describe('BillingComponent', () => {
  let component: BillingComponent;
  let state$: BehaviorSubject<TrialState | null>;
  let api: any;
  let dialog: any;
  let toast: any;
  let trialState: any;

  const baseState = (overrides: Partial<TrialState> = {}): TrialState => ({
    trialStatus: 'converted',
    pending: false,
    trialEnd: null,
    daysRemaining: null,
    planAmount: 349,
    planId: 'multi_mc',
    planName: 'Professional',
    hasPaymentMethod: true,
    cardBrand: 'visa',
    cardLast4: '4242',
    cardExpMonth: 12,
    cardExpYear: 2030,
    subscriptionStatus: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    nextRenewal: null,
    ...overrides
  });

  beforeEach(() => {
    state$ = new BehaviorSubject<TrialState | null>(null);
    trialState = {
      state$: state$.asObservable(),
      refresh: jasmine.createSpy('refresh')
    };
    api = {
      getBillingInvoices: jasmine.createSpy('getBillingInvoices').and.returnValue(of({ invoices: [] })),
      getBillingSeatUsage: jasmine.createSpy('getBillingSeatUsage').and.returnValue(of({ data: null })),
      removeBillingPaymentMethod: jasmine.createSpy('removeBillingPaymentMethod').and.returnValue(of({})),
      createBillingPortalSession: jasmine.createSpy('createBillingPortalSession').and.returnValue(of({ url: 'https://portal' })),
      changeBillingPlan: jasmine.createSpy('changeBillingPlan').and.returnValue(of({ ok: true })),
      cancelBillingSubscription: jasmine.createSpy('cancelBillingSubscription').and.returnValue(of({ ok: true }))
    };
    dialog = { open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(null) }) };
    toast = {
      success: jasmine.createSpy('success'),
      error: jasmine.createSpy('error')
    };
    component = new BillingComponent(trialState, api, dialog, toast);
  });

  it('creates and wires fresh data on init', () => {
    component.ngOnInit();
    expect(trialState.refresh).toHaveBeenCalled();
    expect(api.getBillingInvoices).toHaveBeenCalled();
    expect(api.getBillingSeatUsage).toHaveBeenCalled();
    expect(component.loading).toBe(false);
  });

  describe('planRelation', () => {
    beforeEach(() => { component.state = baseState({ planId: 'multi_mc' }); });

    it('marks the matching plan as current', () => {
      expect(component.planRelation(getMarketingPlan('multi_mc')!)).toBe('current');
    });

    it('classifies a higher tier as an upgrade', () => {
      expect(component.planRelation(getMarketingPlan('end_to_end')!)).toBe('upgrade');
    });

    it('classifies a lower tier as a downgrade', () => {
      expect(component.planRelation(getMarketingPlan('basic')!)).toBe('downgrade');
    });

    it('classifies a contact-only plan as contact', () => {
      expect(component.planRelation(getMarketingPlan('enterprise')!)).toBe('contact');
    });
  });

  describe('prorationPreview', () => {
    it('describes an immediate prorated charge for an upgrade', () => {
      component.state = baseState({ planId: 'basic' });
      component.requestChangePlan(getMarketingPlan('multi_mc')!);
      expect(component.prorationPreview).toContain('immediately');
      expect(component.prorationPreview).toContain('+$200/mo');
    });

    it('describes a prorated credit for a downgrade', () => {
      component.state = baseState({ planId: 'end_to_end' });
      component.requestChangePlan(getMarketingPlan('basic')!);
      expect(component.prorationPreview).toContain('credit');
    });
  });

  describe('invoice helpers', () => {
    it('normalizes unix-seconds timestamps to milliseconds', () => {
      expect(component.invoiceDateMs(1_700_000_000)).toBe(1_700_000_000_000);
      expect(component.invoiceDateMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    });

    it('converts Stripe cents amounts to currency units', () => {
      expect(component.invoiceAmount(34900)).toBe(349);
      expect(component.invoiceAmount(NaN as any)).toBe(0);
    });

    it('loads invoices from the response envelope', () => {
      api.getBillingInvoices.and.returnValue(of({ invoices: [{ id: 'in_1' }] }));
      component.loadInvoices();
      expect(component.invoices.length).toBe(1);
      expect(component.invoicesLoading).toBe(false);
    });

    it('degrades quietly when invoices fail to load', () => {
      api.getBillingInvoices.and.returnValue(throwError(() => new Error('404')));
      component.loadInvoices();
      expect(component.invoices).toEqual([]);
      expect(component.invoicesLoading).toBe(false);
    });
  });

  describe('seatLimitReached', () => {
    it('is true when active users meet the effective limit', () => {
      component.seatUsage = {
        includedUsers: 4, extraPaidSeats: 0, effectiveSeatLimit: 4,
        activeUsers: 4, additionalUserPriceUsd: 25, canPurchaseExtraSeat: true
      };
      expect(component.seatLimitReached).toBe(true);
    });

    it('is false when seats remain', () => {
      component.seatUsage = {
        includedUsers: 4, extraPaidSeats: 2, effectiveSeatLimit: 6,
        activeUsers: 4, additionalUserPriceUsd: 25, canPurchaseExtraSeat: true
      };
      expect(component.seatLimitReached).toBe(false);
    });
  });

  describe('confirmAction', () => {
    it('changes plan and refreshes on confirm', async () => {
      component.state = baseState({ planId: 'basic' });
      component.requestChangePlan(getMarketingPlan('multi_mc')!);
      await component.confirmAction();
      expect(api.changeBillingPlan).toHaveBeenCalledWith('multi_mc');
      expect(toast.success).toHaveBeenCalled();
      expect(component.pending).toBeNull();
      expect(trialState.refresh).toHaveBeenCalled();
    });

    it('cancels the subscription on confirm', async () => {
      component.state = baseState();
      component.requestCancel();
      await component.confirmAction();
      expect(api.cancelBillingSubscription).toHaveBeenCalled();
      expect(component.pending).toBeNull();
    });

    it('surfaces an error and keeps the modal open on failure', async () => {
      component.state = baseState({ planId: 'basic' });
      api.changeBillingPlan.and.returnValue(throwError(() => ({ error: { error: 'Card declined' } })));
      component.requestChangePlan(getMarketingPlan('end_to_end')!);
      await component.confirmAction();
      expect(component.actionError).toBe('Card declined');
      expect(component.pending).not.toBeNull();
    });
  });

  describe('openPortal', () => {
    it('redirects to the returned portal url', async () => {
      const redirectSpy = spyOn<any>(component, 'redirect');
      await component.openPortal();
      expect(api.createBillingPortalSession).toHaveBeenCalled();
      expect(redirectSpy).toHaveBeenCalledWith('https://portal');
    });

    it('toasts an error when no url is returned', async () => {
      api.createBillingPortalSession.and.returnValue(of({}));
      await component.openPortal();
      expect(toast.error).toHaveBeenCalled();
      expect(component.portalLoading).toBe(false);
    });
  });

  describe('status getters', () => {
    it('detects past-due subscriptions', () => {
      component.state = baseState({ subscriptionStatus: 'past_due' });
      expect(component.isPastDue).toBe(true);
      expect(component.statusSeverity).toBe('critical');
    });

    it('flags cancel-at-period-end as a warning', () => {
      component.state = baseState({ cancelAtPeriodEnd: true });
      expect(component.cancelAtPeriodEnd).toBe(true);
      expect(component.statusSeverity).toBe('warning');
    });

    it('reports a pending trial as info severity (FN-1734)', () => {
      component.state = baseState({
        trialStatus: null,
        subscriptionStatus: null,
        pending: true
      });
      expect(component.isPending).toBe(true);
      expect(component.isInTrial).toBe(false);
      expect(component.isConverted).toBe(false);
      expect(component.statusSeverity).toBe('info');
    });

    it('does not treat an active subscriber as pending', () => {
      component.state = baseState();
      expect(component.isPending).toBe(false);
      expect(component.statusSeverity).toBe('good');
    });
  });
});
