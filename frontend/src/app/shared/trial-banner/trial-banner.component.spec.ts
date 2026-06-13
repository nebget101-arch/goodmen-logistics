import { of } from 'rxjs';
import { TrialBannerComponent } from './trial-banner.component';
import { TrialState } from '../services/trial-state.service';

/**
 * Logic specs for the trial banner's `bannerVariant` selector. Exercised with
 * lightweight mocks (no TestBed) to keep the variant decision table covered
 * without pulling in Material dialog / the payment form. FN-1734 adds the
 * "pending activation" variant.
 */
describe('TrialBannerComponent.bannerVariant', () => {
  let component: TrialBannerComponent;

  const baseState = (overrides: Partial<TrialState> = {}): TrialState => ({
    trialStatus: 'trial',
    pending: false,
    trialEnd: new Date('2030-01-01'),
    daysRemaining: 7,
    planAmount: 349,
    planId: 'multi_mc',
    planName: 'Professional',
    hasPaymentMethod: false,
    cardBrand: null,
    cardLast4: null,
    cardExpMonth: null,
    cardExpYear: null,
    subscriptionStatus: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    nextRenewal: null,
    ...overrides
  });

  beforeEach(() => {
    const trialState = { state$: of(null), load: () => {}, refresh: () => {} } as any;
    const dialog = { open: () => ({ afterClosed: () => of(null) }) } as any;
    const access = { canAccessBilling: () => true } as any;
    component = new TrialBannerComponent(trialState, dialog, access);
  });

  it('hides when there is no state', () => {
    component.state = null;
    expect(component.bannerVariant).toBe('hidden');
  });

  it('shows the pending variant for a trial awaiting activation (FN-1734)', () => {
    component.state = baseState({ trialStatus: null, pending: true });
    expect(component.bannerVariant).toBe('pending');
  });

  it('shows state-a for an active trial without a card', () => {
    component.state = baseState({ trialStatus: 'trial', hasPaymentMethod: false });
    expect(component.bannerVariant).toBe('state-a');
  });

  it('shows state-b for an active trial with a card', () => {
    component.state = baseState({ trialStatus: 'trial', hasPaymentMethod: true });
    expect(component.bannerVariant).toBe('state-b');
  });

  it('shows state-c for an expired trial', () => {
    component.state = baseState({ trialStatus: 'expired' });
    expect(component.bannerVariant).toBe('state-c');
  });

  it('shows state-d for a past-due subscription, overriding pending', () => {
    component.state = baseState({ trialStatus: null, pending: true, subscriptionStatus: 'past_due' });
    expect(component.bannerVariant).toBe('state-d');
  });

  it('hides for a converted subscriber', () => {
    component.state = baseState({ trialStatus: 'converted', pending: false });
    expect(component.bannerVariant).toBe('hidden');
  });
});
