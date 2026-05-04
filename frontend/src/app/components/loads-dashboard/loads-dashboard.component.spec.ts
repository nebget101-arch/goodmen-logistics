/// <reference types="jasmine" />

import { FormBuilder } from '@angular/forms';
import { of } from 'rxjs';

import { LoadsDashboardComponent } from './loads-dashboard.component';

/**
 * FN-1300 — focused unit coverage for the single-PDF hero → V2 wizard routing.
 * The legacy FN-1078 Auto-Create modal is gone; single-PDF drops now feed the
 * V2 wizard in `ai-extract` mode with `[initialPdfFile]` pre-loaded so its
 * built-in `runExtraction` fires on init. These specs lock in the pure
 * component-state transitions; Cypress (FN-1301 QA) covers the full UI flow.
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

function makeComponent(overrides: { aiExtract?: any; lookupZip?: any } = {}): LoadsDashboardComponent {
  const loadsService: any = {
    aiExtractFromPdf: jasmine
      .createSpy('aiExtractFromPdf')
      .and.returnValue(overrides.aiExtract || of({ success: true, data: null })),
    getLoad: () => of({ success: true, data: null }),
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
  const router: any = { navigate: () => Promise.resolve(), events: of(null) };
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
    websocket
  );
}

describe('LoadsDashboardComponent — single-PDF hero → V2 wizard routing (FN-1300)', () => {
  it('routes a single-PDF hero drop into the V2 wizard in ai-extract mode with the file pre-loaded', () => {
    const component = makeComponent();
    const pdf = makePdf();

    component.onHeroSinglePdf(pdf);

    expect(component.showLoadWizardV2).toBeTrue();
    expect(component.wizardMode).toBe('ai-extract');
    expect(component.singlePdfForWizard).toBe(pdf);
    expect(component.showNewLoadMenu).toBeFalse();
    // Legacy entry points stay closed.
    expect(component.showLoadWizard).toBeFalse();
    expect(component.showManualModal).toBeFalse();
  });

  it('resets wizardMode and singlePdfForWizard when the V2 wizard is closed', () => {
    const component = makeComponent();
    component.onHeroSinglePdf(makePdf());

    component.closeLoadWizardV2();

    expect(component.showLoadWizardV2).toBeFalse();
    expect(component.singlePdfForWizard).toBeNull();
    expect(component.wizardMode).toBe('create');
  });

  it('resets ai-extract state after a load is created so the next open starts in create mode', () => {
    const component = makeComponent();
    component.onHeroSinglePdf(makePdf());

    component.onLoadWizardV2Created({ id: 'L-1', load_number: 'L-1' } as any);

    expect(component.showLoadWizardV2).toBeFalse();
    expect(component.singlePdfForWizard).toBeNull();
    expect(component.wizardMode).toBe('create');
  });

  it('openLoadWizardV2 from the New Load menu starts in create mode with no pre-loaded PDF', () => {
    const component = makeComponent();
    // Simulate a stale ai-extract state from a previous hero drop.
    component.singlePdfForWizard = makePdf();
    component.wizardMode = 'ai-extract';

    component.openLoadWizardV2();

    expect(component.showLoadWizardV2).toBeTrue();
    expect(component.wizardMode).toBe('create');
    expect(component.singlePdfForWizard).toBeNull();
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
