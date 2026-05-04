/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';

import { ExplainPanelComponent } from './explain-panel.component';
import {
  ExplainPanelState,
  ExplainResponse,
  ExplainService,
} from '../../../services/explain.service';

const mkResponse = (over: Partial<ExplainResponse> = {}): ExplainResponse => ({
  token: 'tok-1',
  subject: 'Why driver J. Smith is high-risk',
  summary: 'Three recent fatigue events plus an overdue inspection drove the score.',
  generatedAt: '2026-05-04T10:00:00Z',
  expiresAt: '2026-06-03T10:00:00Z',
  sources: [
    {
      id: 'src-1',
      label: 'Fatigue event 2026-05-02',
      detail: '11-hour rule violation',
      link: { label: 'View HOS log', routerLink: ['/hos', 'driver-1'] },
    },
  ],
  rules: [
    { id: 'r1', label: 'fatigue_window_breach', matched: true, detail: 'Last 7 days: 3 events' },
    { id: 'r2', label: 'inspection_overdue', matched: false },
  ],
  scores: [
    { label: 'fatigue', value: 0.82, weight: 0.6 },
    { label: 'inspection', value: 0.4, weight: 0.4 },
  ],
  ...over,
});

describe('ExplainPanelComponent', () => {
  let fixture: ComponentFixture<ExplainPanelComponent>;
  let component: ExplainPanelComponent;
  let service: jasmine.SpyObj<ExplainService> & { state$: BehaviorSubject<ExplainPanelState | null> };

  beforeEach(async () => {
    const state$ = new BehaviorSubject<ExplainPanelState | null>(null);
    service = jasmine.createSpyObj<ExplainService>(
      'ExplainService',
      ['open', 'close', 'getExplanation', 'clearCache'],
    ) as any;
    (service as any).state$ = state$.asObservable();
    // Test seam: drive state via the underlying subject.
    (service as any)._state = state$;

    service.getExplanation.and.returnValue(of(mkResponse()));
    service.close.and.callFake(() => state$.next(null));

    await TestBed.configureTestingModule({
      imports: [ExplainPanelComponent, RouterTestingModule],
      providers: [{ provide: ExplainService, useValue: service }],
    }).compileComponents();

    fixture = TestBed.createComponent(ExplainPanelComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  function open(state: ExplainPanelState = { token: 'tok-1', label: 'Driver risk' }): void {
    (service as any)._state.next(state);
    fixture.detectChanges();
  }

  it('renders nothing when no token is open', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.explain-panel')).toBeNull();
    expect(fixture.nativeElement.querySelector('.explain-backdrop')).toBeNull();
  });

  it('shows a loading skeleton while the explanation is in-flight', () => {
    const pending = new Subject<ExplainResponse>();
    service.getExplanation.and.returnValue(pending.asObservable());

    open();
    expect(component.loading).toBe(true);
    const skeleton = fixture.nativeElement.querySelector('.explain-panel__loading');
    expect(skeleton).toBeTruthy();

    pending.next(mkResponse());
    pending.complete();
    fixture.detectChanges();
    expect(component.loading).toBe(false);
  });

  it('renders sources, rules, and scores when the explanation resolves', () => {
    open();
    const heading = fixture.nativeElement.querySelector('.explain-panel__heading');
    expect(heading.textContent).toContain('Why driver J. Smith is high-risk');

    const sectionLabels = Array.from(
      fixture.nativeElement.querySelectorAll('.explain-section__label'),
    ).map((el: any) => el.textContent.trim());
    expect(sectionLabels).toEqual(['Source signals', 'Rules evaluated', 'Score components']);

    const counts = Array.from(
      fixture.nativeElement.querySelectorAll('.explain-section__count'),
    ).map((el: any) => el.textContent.trim());
    expect(counts).toEqual(['1', '2', '2']);
  });

  it('renders the source link as a router link when commands are present', () => {
    open();
    const link = fixture.nativeElement.querySelector('.explain-list__link');
    expect(link).toBeTruthy();
    expect(link.textContent).toContain('View HOS log');
    expect(link.getAttribute('href')).toBe('/hos/driver-1');
  });

  it('clicking the source router-link closes the panel so the user lands on the record', () => {
    open();
    const link = fixture.nativeElement.querySelector('.explain-list__link') as HTMLAnchorElement;
    link.click();
    expect(service.close).toHaveBeenCalled();
  });

  it('toggles a section when its toggle button is pressed', () => {
    open();
    expect(component.collapsed.sources).toBeFalse();

    const sourcesToggle = fixture.nativeElement.querySelector(
      '.explain-section .explain-section__toggle',
    ) as HTMLButtonElement;
    sourcesToggle.click();
    fixture.detectChanges();

    expect(component.collapsed.sources).toBeTrue();
    expect(sourcesToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders the matched/skipped pill on each rule', () => {
    open();
    const pills = Array.from(
      fixture.nativeElement.querySelectorAll('.explain-list__pill'),
    ).map((el: any) => el.textContent.trim());
    expect(pills).toEqual(['Matched', 'Skipped']);
  });

  it('renders score percent + bar fill scaled to 0-100 from a 0-1 value', () => {
    open();
    expect(component.scorePercent(0.82)).toBe(82);
    expect(component.scorePercent(1.5)).toBe(100);
    expect(component.scorePercent(-1)).toBe(0);
    expect(component.scorePercent(NaN)).toBe(0);

    const fills = Array.from(
      fixture.nativeElement.querySelectorAll('.explain-score__bar-fill'),
    ).map((el: any) => (el as HTMLElement).style.width);
    expect(fills).toEqual(['82%', '40%']);
  });

  it('shows the expired-token error when the gateway returns 404', () => {
    service.getExplanation.and.returnValue(
      throwError(() => ({ status: 404, message: 'Not found' })),
    );
    open();
    expect(component.errorMessage).toContain('expire after 30 days');
    const error = fixture.nativeElement.querySelector('.explain-panel__error');
    expect(error).toBeTruthy();
  });

  it('shows a generic error when the request fails for non-404 reasons', () => {
    service.getExplanation.and.returnValue(throwError(() => ({ status: 500 })));
    open();
    expect(component.errorMessage).toContain('Try again in a moment');
  });

  it('retry re-issues the fetch and clears the previous error', () => {
    service.getExplanation.and.returnValue(throwError(() => ({ status: 500 })));
    open();
    expect(component.errorMessage).toBeTruthy();

    service.getExplanation.and.returnValue(of(mkResponse()));
    component.retry();
    fixture.detectChanges();
    expect(component.errorMessage).toBeNull();
    expect(component.response?.token).toBe('tok-1');
  });

  it('close() delegates to the service', () => {
    open();
    component.close();
    expect(service.close).toHaveBeenCalled();
  });

  it('Escape key closes the panel when one is open', () => {
    open();
    component.onEscape();
    expect(service.close).toHaveBeenCalled();
  });

  it('Escape key is a no-op when no panel is open', () => {
    fixture.detectChanges();
    component.onEscape();
    expect(service.close).not.toHaveBeenCalled();
  });

  it('clears in-flight state when the service emits null', () => {
    open();
    expect(component.response).not.toBeNull();
    (service as any)._state.next(null);
    fixture.detectChanges();
    expect(component.response).toBeNull();
    expect(component.errorMessage).toBeNull();
    expect(component.loading).toBeFalse();
    expect(fixture.nativeElement.querySelector('.explain-panel')).toBeNull();
  });
});
