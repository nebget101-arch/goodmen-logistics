/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { DailyBriefingComponent } from './daily-briefing.component';
import { BriefingService, DailyBriefingResponse } from '../../../services/briefing.service';

const mockResponse: DailyBriefingResponse = {
  tenantId: 'tenant-1',
  date: '2026-05-04',
  cached: true,
  briefing: {
    throughput: {
      headline: '42 loads in motion',
      detail: '12 dispatched today, 30 in transit overnight.',
      metric: '42 loads',
    },
    exceptions: {
      headline: '3 active exceptions',
      detail: 'All weather-related delays in the southeast corridor.',
      metric: '3 open',
    },
    driverRisk: {
      headline: 'J. Driver — 2 HOS violations',
      detail: 'Recommend rest before next dispatch.',
      metric: '2 violations',
    },
    vehicleRisk: {
      headline: 'Truck #207 — 5 days overdue PM',
      detail: 'Maintenance window opened today; schedule before next run.',
      metric: '5 days late',
    },
    recommendedAction: {
      headline: 'Reassign 2 pending loads to active drivers',
      detail: 'Estimated time saved: 4h. Affects loads L-1101, L-1108.',
      metric: '',
    },
  },
};

describe('DailyBriefingComponent', () => {
  let fixture: ComponentFixture<DailyBriefingComponent>;
  let component: DailyBriefingComponent;
  let briefingService: jasmine.SpyObj<BriefingService>;

  beforeEach(async () => {
    briefingService = jasmine.createSpyObj<BriefingService>('BriefingService', ['getBriefing']);
    briefingService.getBriefing.and.returnValue(of(mockResponse));

    await TestBed.configureTestingModule({
      imports: [DailyBriefingComponent],
      providers: [{ provide: BriefingService, useValue: briefingService }],
    }).compileComponents();

    fixture = TestBed.createComponent(DailyBriefingComponent);
    component = fixture.componentInstance;
  });

  it('shows the loading skeleton on first render before data resolves', () => {
    const pending = new Subject<DailyBriefingResponse>();
    briefingService.getBriefing.and.returnValue(pending.asObservable());

    fixture.detectChanges();

    expect(component.loading).toBe(true);
    expect(component.response).toBeNull();
    const skeleton = fixture.nativeElement.querySelector('.briefing-card__skeleton');
    expect(skeleton).toBeTruthy();
    const region = fixture.nativeElement.querySelector('[role="region"]');
    expect(region.getAttribute('aria-busy')).toBe('true');

    pending.next(mockResponse);
    pending.complete();
  });

  it('renders all 5 briefing sections when data resolves', () => {
    fixture.detectChanges();

    expect(component.loading).toBe(false);
    expect(component.response).toEqual(mockResponse);

    const sections = fixture.nativeElement.querySelectorAll('.briefing-card__section');
    expect(sections.length).toBe(5);

    const labels = Array.from(sections, (s: any) =>
      s.querySelector('.briefing-card__section-label').textContent.trim(),
    );
    expect(labels).toEqual([
      'Load throughput',
      'Exceptions',
      'Top driver risk',
      'Top vehicle risk',
      'Recommended action',
    ]);

    const headlines = Array.from(sections, (s: any) =>
      s.querySelector('.briefing-card__section-headline').textContent.trim(),
    );
    expect(headlines).toContain('42 loads in motion');
    expect(headlines).toContain('Truck #207 — 5 days overdue PM');
  });

  it('renders the metric chip only when the section has a non-empty metric', () => {
    fixture.detectChanges();

    const sections = fixture.nativeElement.querySelectorAll('.briefing-card__section');
    const metrics = Array.from(sections, (s: any) =>
      s.querySelector('.briefing-card__section-metric')?.textContent.trim() || null,
    );
    expect(metrics[0]).toBe('42 loads');
    expect(metrics[3]).toBe('5 days late');
    expect(metrics[4]).toBeNull();
  });

  it('renders the error fallback and a retry button when fetch fails', () => {
    briefingService.getBriefing.and.returnValue(throwError(() => new Error('502')));
    fixture.detectChanges();

    expect(component.loading).toBe(false);
    expect(component.errorMessage).toBeTruthy();

    const errorEl = fixture.nativeElement.querySelector('.briefing-card__error');
    expect(errorEl).toBeTruthy();
    expect(errorEl.getAttribute('role')).toBe('alert');
    expect(errorEl.querySelector('.briefing-card__error-retry')).toBeTruthy();
  });

  it('calls getBriefing with refresh=true when refresh() is invoked', fakeAsync(() => {
    fixture.detectChanges();
    expect(briefingService.getBriefing).toHaveBeenCalledTimes(1);
    expect(briefingService.getBriefing.calls.argsFor(0)[0]).toEqual({ refresh: false });

    component.refresh();
    tick();

    expect(briefingService.getBriefing).toHaveBeenCalledTimes(2);
    expect(briefingService.getBriefing.calls.argsFor(1)[0]).toEqual({ refresh: true });
  }));

  it('ignores re-entrant refresh while a refresh is already in flight', () => {
    const pending = new Subject<DailyBriefingResponse>();
    briefingService.getBriefing.and.returnValues(of(mockResponse), pending.asObservable());

    fixture.detectChanges();
    expect(briefingService.getBriefing).toHaveBeenCalledTimes(1);

    component.refresh();
    expect(component.refreshing).toBe(true);
    component.refresh();
    expect(briefingService.getBriefing).toHaveBeenCalledTimes(2);

    pending.next(mockResponse);
    pending.complete();
  });

  it('emits visibilityChange with hasBaseline=true when the response omits the field (back-compat)', () => {
    const events: Array<{ hasBaseline: boolean; firstBaselineEta: string | null }> = [];
    component.visibilityChange.subscribe((e) => events.push(e));
    fixture.detectChanges();

    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ hasBaseline: true, firstBaselineEta: null });
  });

  it('hides briefing sections and shows "First baseline ready by {date}" when hasBaseline=false', () => {
    const noBaseline: DailyBriefingResponse = {
      ...mockResponse,
      hasBaseline: false,
      firstBaselineEta: '2026-05-12',
    };
    briefingService.getBriefing.and.returnValue(of(noBaseline));
    const events: Array<{ hasBaseline: boolean; firstBaselineEta: string | null }> = [];
    component.visibilityChange.subscribe((e) => events.push(e));
    fixture.detectChanges();

    expect(events).toEqual([{ hasBaseline: false, firstBaselineEta: '2026-05-12' }]);
    expect(fixture.nativeElement.querySelector('.briefing-card__sections')).toBeFalsy();
    const baseline = fixture.nativeElement.querySelector('[data-testid="briefing-first-baseline-eta"]');
    expect(baseline).toBeTruthy();
    expect(baseline.textContent).toContain('First baseline ready by 2026-05-12');
  });

  it('exposes accessible labels: region heading and refresh button', () => {
    fixture.detectChanges();

    const region = fixture.nativeElement.querySelector('[role="region"]');
    expect(region.getAttribute('aria-labelledby')).toBe('briefing-heading');
    expect(fixture.nativeElement.querySelector('#briefing-heading')).toBeTruthy();

    const refreshBtn = fixture.nativeElement.querySelector('.briefing-card__refresh');
    expect(refreshBtn.getAttribute('aria-label')).toContain('Refresh');
    expect(refreshBtn.tagName).toBe('BUTTON');
    expect(refreshBtn.getAttribute('type')).toBe('button');
  });
});
