import { of, throwError } from 'rxjs';
import { TrialStateService } from './trial-state.service';

/**
 * Specs for the pending-activation derivation added in FN-1734: a tenant that
 * loaded successfully but has no trial status and no managed subscription is
 * "pending", whereas a non-trial user (whose request errors) yields a null state.
 */
describe('TrialStateService.pending', () => {
  let api: any;
  let service: TrialStateService;

  const wire = (statusData: any, subscription: any = throwError(() => new Error('404'))) => {
    api = {
      getBillingTrialStatus: jasmine.createSpy('getBillingTrialStatus').and.returnValue(of({ data: statusData })),
      getBillingPaymentMethod: jasmine.createSpy('getBillingPaymentMethod').and.returnValue(of({ data: { hasCard: false } })),
      getBillingSubscription: jasmine.createSpy('getBillingSubscription').and.returnValue(subscription)
    };
    service = new TrialStateService(api);
  };

  it('marks a tenant with null trial status and no subscription as pending', () => {
    wire({ trial_status: null, trial_end: null });
    service.refresh();
    expect(service.snapshot?.pending).toBe(true);
    expect(service.snapshot?.trialStatus).toBeNull();
  });

  it('does not mark an active trial as pending', () => {
    wire({ trial_status: 'trial', trial_end: '2030-01-01' });
    service.refresh();
    expect(service.snapshot?.pending).toBe(false);
    expect(service.snapshot?.trialStatus).toBe('trial');
  });

  it('does not mark a converted subscriber with an active subscription as pending', () => {
    wire({ trial_status: null }, of({ data: { status: 'active' } }));
    service.refresh();
    expect(service.snapshot?.pending).toBe(false);
  });

  it('yields a null state (not pending) when trial status fails to load', () => {
    api = {
      getBillingTrialStatus: jasmine.createSpy('getBillingTrialStatus').and.returnValue(throwError(() => new Error('403'))),
      getBillingPaymentMethod: jasmine.createSpy('getBillingPaymentMethod').and.returnValue(of({ data: {} })),
      getBillingSubscription: jasmine.createSpy('getBillingSubscription').and.returnValue(throwError(() => new Error('404')))
    };
    service = new TrialStateService(api);
    service.refresh();
    expect(service.snapshot).toBeNull();
  });
});
