/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';

import { SmartAlertsComponent } from './smart-alerts.component';
import {
  SmartAlert,
  SmartAlertsResponse,
  SmartAlertsService,
} from '../../../services/smart-alerts.service';

const mkAlert = (over: Partial<SmartAlert> = {}): SmartAlert => ({
  id: 'a1',
  type: 'hos_imminent',
  subjectId: 'driver-1',
  subjectKind: 'driver',
  title: 'HOS violation imminent: J. Smith',
  facts: { driverName: 'J. Smith', minutesRemaining: 30, windowType: '11h' },
  severity: 90,
  ...over,
});

describe('SmartAlertsComponent', () => {
  let fixture: ComponentFixture<SmartAlertsComponent>;
  let component: SmartAlertsComponent;
  let service: jasmine.SpyObj<SmartAlertsService> & { alerts$: BehaviorSubject<SmartAlert[]> };

  beforeEach(async () => {
    const alerts$ = new BehaviorSubject<SmartAlert[]>([]);
    service = jasmine.createSpyObj<SmartAlertsService>(
      'SmartAlertsService',
      ['fetch', 'startLiveUpdates', 'dismiss'],
    ) as any;
    (service as any).alerts$ = alerts$;
    service.fetch.and.callFake(() => {
      const six: SmartAlert[] = [
        mkAlert({ id: 'a1', severity: 99 }),
        mkAlert({ id: 'a2', severity: 88, type: 'inspection_overdue', subjectKind: 'vehicle' }),
        mkAlert({ id: 'a3', severity: 70, type: 'late_load_risk', subjectKind: 'load' }),
        mkAlert({ id: 'a4', severity: 50, type: 'fatigue' }),
        mkAlert({ id: 'a5', severity: 40 }),
        mkAlert({ id: 'a6', severity: 20 }),
      ];
      const resp: SmartAlertsResponse = {
        tenantId: 't1',
        alerts: six,
        generatedAt: '2026-05-04T10:00:00Z',
      };
      alerts$.next(six);
      return of(resp);
    });
    service.dismiss.and.returnValue(of(undefined as any));

    await TestBed.configureTestingModule({
      imports: [SmartAlertsComponent, RouterTestingModule],
      providers: [{ provide: SmartAlertsService, useValue: service }],
    }).compileComponents();

    fixture = TestBed.createComponent(SmartAlertsComponent);
    component = fixture.componentInstance;
  });

  it('shows the loading skeleton on first render before data resolves', () => {
    const pending = new Subject<SmartAlertsResponse>();
    service.fetch.and.returnValue(pending.asObservable());

    fixture.detectChanges();

    expect(component.loading).toBe(true);
    const skeleton = fixture.nativeElement.querySelector('.smart-alerts__skeleton');
    expect(skeleton).toBeTruthy();
    const region = fixture.nativeElement.querySelector('[role="region"]');
    expect(region.getAttribute('aria-busy')).toBe('true');

    pending.next({ tenantId: 't1', alerts: [], generatedAt: '' });
    pending.complete();
  });

  it('renders only the top 5 alerts with severity bucket derived from numeric score', () => {
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.smart-alerts__row');
    expect(rows.length).toBe(5);

    const buckets = Array.from(rows, (r: any) => r.getAttribute('data-severity'));
    // 99 → critical, 88 → critical, 70 → high, 50 → medium, 40 → medium
    expect(buckets).toEqual(['critical', 'critical', 'high', 'medium', 'medium']);
  });

  it('renders the severity badge with the numeric score and bucket label', () => {
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.smart-alerts__badge');
    const scoreText = badge.querySelector('.smart-alerts__badge-score').textContent.trim();
    expect(scoreText).toBe('99');
    expect(badge.getAttribute('data-severity')).toBe('critical');
    expect(badge.getAttribute('aria-label')).toContain('Critical severity');
    expect(badge.getAttribute('aria-label')).toContain('99');
  });

  it('renders an action link synthesized from subjectKind+subjectId', () => {
    fixture.detectChanges();

    const actions = fixture.nativeElement.querySelectorAll('.smart-alerts__action');
    expect(actions.length).toBe(5);
    expect(actions[0].textContent).toContain('Open driver');
    expect(actions[1].textContent).toContain('Open vehicle');
    expect(actions[2].textContent).toContain('Open load');
  });

  it('starts live updates and fetches on init', () => {
    fixture.detectChanges();

    expect(service.startLiveUpdates).toHaveBeenCalledTimes(1);
    expect(service.fetch).toHaveBeenCalledTimes(1);
  });

  it('calls service.dismiss(id) when the dismiss button is clicked', () => {
    fixture.detectChanges();

    const dismissBtn: HTMLButtonElement =
      fixture.nativeElement.querySelectorAll('.smart-alerts__dismiss')[0];
    dismissBtn.click();

    expect(service.dismiss).toHaveBeenCalledWith('a1');
  });

  it('disables the dismiss button while a dismissal is in flight', () => {
    const pending = new Subject<void>();
    service.dismiss.and.returnValue(pending.asObservable() as any);
    fixture.detectChanges();

    const dismissBtn: HTMLButtonElement =
      fixture.nativeElement.querySelectorAll('.smart-alerts__dismiss')[0];
    dismissBtn.click();
    fixture.detectChanges();

    expect(component.dismissing.has('a1')).toBe(true);
    const btnAfter: HTMLButtonElement =
      fixture.nativeElement.querySelectorAll('.smart-alerts__dismiss')[0];
    expect(btnAfter.disabled).toBe(true);

    pending.next();
    pending.complete();
  });

  it('renders an empty state when there are no alerts', () => {
    service.fetch.and.callFake(() => {
      (service as any).alerts$.next([]);
      return of({ tenantId: 't1', alerts: [], generatedAt: '' } as SmartAlertsResponse);
    });

    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.smart-alerts__empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No urgent signals');
  });

  it('renders the error fallback with retry when fetch fails', fakeAsync(() => {
    service.fetch.and.returnValue(throwError(() => new Error('502')));

    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const errorEl = fixture.nativeElement.querySelector('.smart-alerts__error');
    expect(errorEl).toBeTruthy();
    expect(errorEl.getAttribute('role')).toBe('alert');
    expect(errorEl.querySelector('.smart-alerts__error-retry')).toBeTruthy();
  }));

  it('reacts to live updates from alerts$ — a new top-severity alert pushes lower-rank items off the top 5', () => {
    fixture.detectChanges();

    const six: SmartAlert[] = [
      mkAlert({ id: 'a0', severity: 100 }),
      mkAlert({ id: 'a1', severity: 99 }),
      mkAlert({ id: 'a2', severity: 88 }),
      mkAlert({ id: 'a3', severity: 70 }),
      mkAlert({ id: 'a4', severity: 50 }),
      mkAlert({ id: 'a5', severity: 40 }),
    ];
    (service as any).alerts$.next(six);
    fixture.detectChanges();

    expect(component.topAlerts.map((a) => a.id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
  });

  it('exposes accessible labels: region heading, badge label, and per-row dismiss aria-label', () => {
    fixture.detectChanges();

    const region = fixture.nativeElement.querySelector('[role="region"]');
    expect(region.getAttribute('aria-labelledby')).toBe('smart-alerts-heading');
    expect(fixture.nativeElement.querySelector('#smart-alerts-heading')).toBeTruthy();

    const dismissBtn = fixture.nativeElement.querySelector('.smart-alerts__dismiss');
    expect(dismissBtn.getAttribute('aria-label')).toContain('Dismiss alert:');
  });
});
