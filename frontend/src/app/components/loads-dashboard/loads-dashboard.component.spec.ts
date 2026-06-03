/// <reference types="jasmine" />

import { FormBuilder } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { LoadsDashboardComponent } from './loads-dashboard.component';
import { LoadAiEndpointExtraction } from '../../models/load-dashboard.model';

/**
 * FN-1078 — focused unit coverage for the Auto-Create-from-PDF → 4-step wizard
 * routing fix. Cypress (FN-1079) covers the full UI flow; these specs lock in
 * the pure component-state transitions so future regressions are caught before
 * they land in the slower e2e suite.
 *
 * The component pulls in 11 services. Construction itself is side-effect-free
 * (just FormBuilder calls + assigning a scroll strategy), so we instantiate
 * with `new` and skip ngOnInit / TestBed compilation.
 */

function makePdf(name = 'rate-conf.pdf'): File {
  return new File([new Blob(['%PDF-1.4'], { type: 'application/pdf' })], name, {
    type: 'application/pdf'
  });
}

function makeComponent(
  overrides: {
    aiExtract?: any;
    lookupZip?: any;
    getLoad?: any;
    hasPermission?: (permission: string) => boolean;
    routerNavigate?: jasmine.Spy;
  } = {}
): LoadsDashboardComponent {
  const loadsService: any = {
    aiExtractFromPdf: jasmine
      .createSpy('aiExtractFromPdf')
      .and.returnValue(overrides.aiExtract || of({ success: true, data: null })),
    getLoad: overrides.getLoad
      ? jasmine.createSpy('getLoad').and.callFake(overrides.getLoad)
      : jasmine.createSpy('getLoad').and.returnValue(of({ success: true, data: null })),
    lookupZip: jasmine
      .createSpy('lookupZip')
      .and.returnValue(overrides.lookupZip || of({ success: true, data: {} })),
    bulkUploadRateConfirmations: () => of({ results: [] })
  };
  const userPreferences: any = {
    getRecentDriverId: () => null,
    getSavedViews: () => [],
    saveView: () => {},
    deleteView: () => {},
    getActiveView: () => null,
    setActiveView: () => {},
    getRecentBrokerId: () => null,
    setRecentDriverId: () => {},
    setRecentBrokerId: () => {}
  };
  const scrollStrategies: any = { close: () => ({}) };
  const websocket: any = {
    status$: of('disconnected'),
    presence$: of([]),
    events$: of(null),
    subscribe: () => {},
    sendMessage: () => {}
  };
  const route: any = {
    queryParamMap: of(new Map()),
    snapshot: { queryParamMap: { get: () => null } }
  };
  const router: any = {
    navigate: overrides.routerNavigate || jasmine.createSpy('navigate').and.returnValue(Promise.resolve()),
    events: of(null)
  };
  const sanitizer: any = { bypassSecurityTrustResourceUrl: (s: string) => s };
  const operatingEntityContext: any = {
    activeOperatingEntityId$: of(null),
    activeEntity$: of(null)
  };
  const loadTemplatesService: any = {
    list: () => of({ success: true, data: [] }),
    create: () => of({ success: true })
  };
  const keyboardShortcuts: any = { registerAll: () => () => {} };
  const accessControl: any = {
    hasPermission: overrides.hasPermission
      ? jasmine.createSpy('hasPermission').and.callFake(overrides.hasPermission)
      : jasmine.createSpy('hasPermission').and.returnValue(true)
  };

  return new LoadsDashboardComponent(
    loadsService,
    new FormBuilder(),
    route,
    router,
    sanitizer,
    operatingEntityContext,
    loadTemplatesService,
    keyboardShortcuts,
    userPreferences,
    scrollStrategies,
    websocket,
    accessControl
  );
}

describe('LoadsDashboardComponent — Auto-Create → wizard routing (FN-1078)', () => {
  describe('runAutoExtraction', () => {
    it('routes a normal extraction into the 4-step wizard with prefill', () => {
      const data: LoadAiEndpointExtraction = {
        brokerName: 'Acme Logistics',
        poNumber: 'PO-12345',
        rate: 1850,
        pickup: { date: '2026-06-01', city: 'Dallas', state: 'TX', zip: '75201', address1: null },
        delivery: { date: '2026-06-02', city: 'Atlanta', state: 'GA', zip: '30303', address1: null },
        notes: 'Handle with care',
        provider: 'openai'
      };
      const component = makeComponent({
        aiExtract: of({ success: true, data })
      });
      const pdf = makePdf();
      component.autoPdfFile = pdf;
      component.showAutoModal = true;

      component.runAutoExtraction();

      expect(component.showLoadWizard).toBeTrue();
      expect(component.showAutoModal).toBeFalse();
      expect(component.showManualModal).toBeFalse();
      expect(component.wizardAiExtractedPdf).toBe(pdf);
      expect(component.wizardBasics.brokerName).toBe('Acme Logistics');
      expect(component.wizardBasics.poNumber).toBe('PO-12345');
      expect(component.wizardBasics.rate).toBe(1850);
      expect(component.wizardAiPrefilledFields.has('brokerName')).toBeTrue();
      expect(component.wizardAiPrefilledFields.has('poNumber')).toBeTrue();
      expect(component.wizardAiPrefilledFields.has('rate')).toBeTrue();
      // Auto-modal state cleared so a fresh re-open starts blank.
      expect(component.autoPdfFile).toBeNull();
      expect(component.autoExtraction).toBeNull();
    });

    it('routes a "no data" extraction into the wizard with the PDF queued and no prefill', () => {
      const component = makeComponent({
        aiExtract: of({ success: true, data: null })
      });
      const pdf = makePdf();
      component.autoPdfFile = pdf;
      component.showAutoModal = true;

      component.runAutoExtraction();

      expect(component.showLoadWizard).toBeTrue();
      expect(component.showAutoModal).toBeFalse();
      expect(component.showManualModal).toBeFalse();
      expect(component.wizardAiExtractedPdf).toBe(pdf);
      expect(component.wizardAiPrefilledFields.size).toBe(0);
    });

    it('routes a vision-only / scanned PDF into the wizard with the PDF queued and no prefill', () => {
      const data: LoadAiEndpointExtraction = {
        brokerName: null,
        poNumber: null,
        rate: null,
        pickup: { date: null, city: null, state: null, zip: null, address1: null },
        delivery: { date: null, city: null, state: null, zip: null, address1: null },
        notes: null,
        provider: 'none',
        warning: 'Scanned PDF — could not extract text.'
      };
      const component = makeComponent({
        aiExtract: of({ success: true, data })
      });
      const pdf = makePdf();
      component.autoPdfFile = pdf;
      component.showAutoModal = true;

      component.runAutoExtraction();

      expect(component.showLoadWizard).toBeTrue();
      expect(component.showAutoModal).toBeFalse();
      expect(component.wizardAiExtractedPdf).toBe(pdf);
      expect(component.wizardAiPrefilledFields.size).toBe(0);
    });

    it('keeps the user in the Auto-Create modal on extraction error and surfaces the manual escape hatch', () => {
      const component = makeComponent({
        aiExtract: throwError(() => new Error('500'))
      });
      const pdf = makePdf();
      component.autoPdfFile = pdf;
      component.showAutoModal = true;

      component.runAutoExtraction();

      expect(component.showLoadWizard).toBeFalse();
      expect(component.showAutoModal).toBeTrue();
      expect(component.showManualModal).toBeFalse();
      expect(component.autoError).toContain('Continue manually');
      expect(component.autoExtracting).toBeFalse();

      // Pressing the "Continue manually" footer button hands off to the wizard
      // with just the PDF queued, no prefill.
      component.continueAutoManually();
      expect(component.showLoadWizard).toBeTrue();
      expect(component.wizardAiExtractedPdf).toBe(pdf);
      expect(component.wizardAiPrefilledFields.size).toBe(0);
    });
  });

  describe('onAutoFileSelected re-select handling', () => {
    it('routes the queued + new PDFs into the bulk extraction grid instead of overwriting', () => {
      const component = makeComponent();
      const first = makePdf('first.pdf');
      const second = makePdf('second.pdf');
      component.autoPdfFile = first;
      component.showAutoModal = true;

      const fileList: any = {
        0: second,
        length: 1,
        item: (i: number) => (i === 0 ? second : null)
      };
      Object.setPrototypeOf(fileList, Array.prototype);

      component.onAutoFileSelected(fileList as FileList);

      expect(component.showAutoModal).toBeFalse();
      expect(component.showBulkExtractionGrid).toBeTrue();
      expect(component.bulkExtractionFiles.length).toBe(2);
      expect(component.bulkExtractionFiles[0]).toBe(first);
      expect(component.bulkExtractionFiles[1]).toBe(second);
      expect(component.autoPdfFile).toBeNull();
    });

    it('queues a single PDF normally when none was previously selected', () => {
      const component = makeComponent();
      const pdf = makePdf();
      component.showAutoModal = true;

      const fileList: any = {
        0: pdf,
        length: 1,
        item: (i: number) => (i === 0 ? pdf : null)
      };
      Object.setPrototypeOf(fileList, Array.prototype);

      component.onAutoFileSelected(fileList as FileList);

      expect(component.autoPdfFile).toBe(pdf);
      expect(component.showAutoModal).toBeTrue();
      expect(component.showBulkExtractionGrid).toBeFalse();
    });
  });
});

describe('LoadsDashboardComponent.applyRouteQueryParams (FN-1312)', () => {
  it('routes ?action=reassign&loadId=X to V2 wizard in edit mode', () => {
    const component = makeComponent();

    component.applyRouteQueryParams({ action: 'reassign', loadId: '158061' });

    expect(component.showLoadWizardV2).toBeTrue();
    expect(component.loadWizardV2Mode).toBe('edit');
    expect(component.loadWizardV2LoadId).toBe('158061');
    expect(component.showDetailsModal).toBeFalse();
  });

  it('falls through to detail drawer when user lacks LOADS_EDIT permission', () => {
    const getLoadSpy = jasmine
      .createSpy('getLoad')
      .and.returnValue(of({ success: true, data: { id: '158061' } }));
    const component = makeComponent({
      hasPermission: () => false,
      getLoad: getLoadSpy
    });

    component.applyRouteQueryParams({ action: 'reassign', loadId: '158061' });

    expect(component.showLoadWizardV2).toBeFalse();
    expect(component.showDetailsModal).toBeTrue();
    expect(getLoadSpy).toHaveBeenCalledWith('158061');
  });

  it('opens the legacy detail drawer for ?loadId=X without action (regression check)', () => {
    const getLoadSpy = jasmine
      .createSpy('getLoad')
      .and.returnValue(of({ success: true, data: { id: '158061' } }));
    const component = makeComponent({ getLoad: getLoadSpy });

    component.applyRouteQueryParams({ loadId: '158061' });

    expect(component.showLoadWizardV2).toBeFalse();
    expect(component.showDetailsModal).toBeTrue();
    expect(getLoadSpy).toHaveBeenCalledWith('158061');
  });

  it('does nothing when neither action nor loadId is present', () => {
    const component = makeComponent();

    component.applyRouteQueryParams({});

    expect(component.showLoadWizardV2).toBeFalse();
    expect(component.showDetailsModal).toBeFalse();
  });

  it('still applies status / billingStatus filter params on top of routing', () => {
    const component = makeComponent();

    component.applyRouteQueryParams({ status: 'IN_TRANSIT', billingStatus: 'INVOICED' });

    expect(component.filters.status).toBe('IN_TRANSIT');
    expect(component.filters.billingStatus).toBe('INVOICED');
  });

  it('clears action+loadId query params when the wizard closes from edit mode', () => {
    const navigateSpy = jasmine.createSpy('navigate').and.returnValue(Promise.resolve());
    const component = makeComponent({ routerNavigate: navigateSpy });

    component.applyRouteQueryParams({ action: 'reassign', loadId: '158061' });
    expect(component.showLoadWizardV2).toBeTrue();

    component.closeLoadWizardV2();

    expect(component.showLoadWizardV2).toBeFalse();
    expect(component.loadWizardV2Mode).toBe('create');
    expect(component.loadWizardV2LoadId).toBeNull();
    expect(navigateSpy).toHaveBeenCalled();
    const navArgs = navigateSpy.calls.mostRecent().args;
    expect(navArgs[1].queryParams).toEqual({ action: null, loadId: null });
    expect(navArgs[1].queryParamsHandling).toBe('merge');
  });

  it('does NOT clear query params when closing from create mode (no regression on + New Load)', () => {
    const navigateSpy = jasmine.createSpy('navigate').and.returnValue(Promise.resolve());
    const component = makeComponent({ routerNavigate: navigateSpy });

    component.openLoadWizardV2();
    component.closeLoadWizardV2();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('clears query params after a successful update from edit mode', () => {
    const navigateSpy = jasmine.createSpy('navigate').and.returnValue(Promise.resolve());
    const component = makeComponent({ routerNavigate: navigateSpy });
    spyOn(component, 'loadLoads');

    component.applyRouteQueryParams({ action: 'reassign', loadId: '158061' });
    component.onLoadWizardV2Updated({ id: '158061', load_number: 'L-158061' } as any);

    expect(component.showLoadWizardV2).toBeFalse();
    expect(component.successMessage).toContain('updated');
    expect(navigateSpy).toHaveBeenCalled();
  });
});

describe('LoadsDashboardComponent.lookupZipForEditStop (FN-1089)', () => {
  it('populates both city and state when both are returned', () => {
    const component = makeComponent({
      lookupZip: of({ success: true, data: { zip: '90210', city: 'Beverly Hills', state: 'CA' } })
    });
    component.editStopForm.patchValue({ city: '', state: '', zip: '90210' });

    component.lookupZipForEditStop();

    expect(component.editStopForm.get('city')!.value).toBe('Beverly Hills');
    expect(component.editStopForm.get('state')!.value).toBe('CA');
  });

  it('preserves existing state when the response is missing state', () => {
    const component = makeComponent({
      lookupZip: of({ success: true, data: { zip: '10001', city: 'New York', state: '' } })
    });
    component.editStopForm.patchValue({ city: '', state: 'NY', zip: '10001' });

    component.lookupZipForEditStop();

    // city updates from the response.
    expect(component.editStopForm.get('city')!.value).toBe('New York');
    // state was 'NY' before lookup; blank response must not clobber it.
    expect(component.editStopForm.get('state')!.value).toBe('NY');
  });

});

// ─── FN-1353: AI insight → smart filter wiring ────────────────────────────
describe('LoadsDashboardComponent — FN-1353 applyAiInsight', () => {
  function makeInsight(type: string, href = '/loads'): any {
    return {
      id: `insight-${type}`,
      type,
      severity: 'warn',
      title: `Test ${type}`,
      href,
    };
  }

  function makeC(): { c: any; loadLoadsSpy: jasmine.Spy; navSpy: jasmine.Spy } {
    const navSpy = jasmine.createSpy('navigateByUrl').and.returnValue(Promise.resolve(true));
    const c: any = makeComponent();
    // Stub `loadLoads` so we don't fire real HTTP.
    const loadLoadsSpy = spyOn(c, 'loadLoads').and.callFake(() => {});
    c.router.navigateByUrl = navSpy;
    return { c, loadLoadsSpy, navSpy };
  }

  it('overdue → activates smart filter "overdue" and reloads', () => {
    const { c, loadLoadsSpy } = makeC();
    c.smartFilterKeys = [];
    c.applyAiInsight(makeInsight('overdue'));
    expect(c.smartFilterKeys).toContain('overdue');
    expect(loadLoadsSpy).toHaveBeenCalled();
    expect(c.page).toBe(1);
  });

  it('missing_documents → activates smart filter "missing_docs"', () => {
    const { c } = makeC();
    c.smartFilterKeys = [];
    c.applyAiInsight(makeInsight('missing_documents'));
    expect(c.smartFilterKeys).toContain('missing_docs');
  });

  it('driver_idle → activates smart filter "idle_drivers"', () => {
    const { c } = makeC();
    c.smartFilterKeys = [];
    c.applyAiInsight(makeInsight('driver_idle'));
    expect(c.smartFilterKeys).toContain('idle_drivers');
  });

  it('does not duplicate an already-active filter', () => {
    const { c, loadLoadsSpy } = makeC();
    c.smartFilterKeys = ['overdue'];
    c.applyAiInsight(makeInsight('overdue'));
    expect(c.smartFilterKeys.filter((k: string) => k === 'overdue').length).toBe(1);
    // No reload triggered if no chip change.
    expect(loadLoadsSpy).not.toHaveBeenCalled();
  });

  it('unmapped types fall back to navigateByUrl(insight.href)', () => {
    const { c, navSpy, loadLoadsSpy } = makeC();
    c.smartFilterKeys = [];
    c.applyAiInsight(makeInsight('rate_anomaly', '/reports/rate-anomaly'));
    expect(navSpy).toHaveBeenCalledWith('/reports/rate-anomaly');
    expect(loadLoadsSpy).not.toHaveBeenCalled();
  });

  it('isRowAttention flags DRAFT loads', () => {
    const { c } = makeC();
    expect(c.isRowAttention({
      id: '1', load_number: 'L1', status: 'DRAFT', billing_status: 'PENDING',
      attachment_types: [], attachment_count: 0,
    } as any)).toBe(true);
  });

  it('isRowAttention flags DELIVERED loads missing BOL/POD', () => {
    const { c } = makeC();
    expect(c.isRowAttention({
      id: '1', load_number: 'L1', status: 'DELIVERED', billing_status: 'PENDING',
      attachment_types: ['RATE_CONFIRMATION'], attachment_count: 1,
    } as any)).toBe(true);
  });

  it('isRowAttention does NOT flag DELIVERED loads with BOL', () => {
    const { c } = makeC();
    expect(c.isRowAttention({
      id: '1', load_number: 'L1', status: 'DELIVERED', billing_status: 'PENDING',
      attachment_types: ['BOL'], attachment_count: 1,
    } as any)).toBe(false);
  });

  it('kanbanKeyForLoad maps statuses to columns correctly', () => {
    const { c } = makeC();
    expect(c.kanbanKeyForLoad({ status: 'DISPATCHED', billing_status: 'PENDING' } as any)).toBe('dispatched');
    expect(c.kanbanKeyForLoad({ status: 'IN_TRANSIT', billing_status: 'PENDING' } as any)).toBe('in_transit');
    expect(c.kanbanKeyForLoad({ status: 'DELIVERED', billing_status: 'PENDING' } as any)).toBe('delivered');
    expect(c.kanbanKeyForLoad({ status: 'DELIVERED', billing_status: 'INVOICED' } as any)).toBe('invoiced');
    expect(c.kanbanKeyForLoad({ status: 'DELIVERED', billing_status: 'FUNDED' } as any)).toBe('funded');
    expect(c.kanbanKeyForLoad({ status: 'DELIVERED', billing_status: 'PAID' } as any)).toBe('funded');
  });

  it('hydrateViewMode reads localStorage and falls back to "cards" on invalid', () => {
    const { c } = makeC();
    try {
      window.localStorage.setItem('loads.list.view', 'kanban');
      c.hydrateViewMode();
      expect(c.viewMode).toBe('kanban');
      window.localStorage.setItem('loads.list.view', 'invalid');
      c.hydrateViewMode();
      expect(c.viewMode).toBe('cards');
    } finally {
      window.localStorage.removeItem('loads.list.view');
    }
  });

  it('setViewMode persists to localStorage', () => {
    const { c } = makeC();
    try {
      c.setViewMode('table');
      expect(window.localStorage.getItem('loads.list.view')).toBe('table');
    } finally {
      window.localStorage.removeItem('loads.list.view');
    }
  });
});
