/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { KpiStripComponent } from './kpi-strip.component';
import {
  DashboardWindow,
  DashboardWindowService,
} from '../../../services/dashboard-window.service';
import { environment } from '../../../../environments/environment';

class FakeWindowService {
  private subject = new BehaviorSubject<DashboardWindow>('7d');
  current = (): DashboardWindow => this.subject.value;
  window$ = () => this.subject.asObservable();
  emit(w: DashboardWindow): void {
    this.subject.next(w);
  }
}

const STATS_URL = `${environment.apiUrl}/dashboard/stats`;

function setup() {
  TestBed.resetTestingModule();
  const fakeWindow = new FakeWindowService();
  TestBed.configureTestingModule({
    imports: [HttpClientTestingModule, KpiStripComponent],
    providers: [
      provideRouter([]),
      { provide: DashboardWindowService, useValue: fakeWindow },
    ],
  });
  const fixture: ComponentFixture<KpiStripComponent> = TestBed.createComponent(KpiStripComponent);
  const httpMock = TestBed.inject(HttpTestingController);
  return { fixture, component: fixture.componentInstance, httpMock, fakeWindow };
}

describe('KpiStripComponent', () => {
  it('fetches stats with the active window on init', fakeAsync(() => {
    const { fixture, httpMock } = setup();
    fixture.detectChanges();
    tick();
    const req = httpMock.expectOne((r) => r.url === STATS_URL);
    expect(req.request.params.get('window')).toBe('7d');
    req.flush({ activeDrivers: 8, totalDrivers: 12, hosViolations: 0, dqfComplianceRate: 92 });
    tick();
    httpMock.verify();
  }));

  it('re-fetches when the window changes', fakeAsync(() => {
    const { fixture, httpMock, fakeWindow } = setup();
    fixture.detectChanges();
    tick();
    httpMock.expectOne((r) => r.url === STATS_URL).flush({});
    tick();

    fakeWindow.emit('30d');
    tick();
    const req2 = httpMock.expectOne((r) => r.url === STATS_URL);
    expect(req2.request.params.get('window')).toBe('30d');
    req2.flush({});
    tick();
    httpMock.verify();
  }));

  it('renders 6 KPI cards from a flat (legacy) stats payload', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne((r) => r.url === STATS_URL)
      .flush({
        activeDrivers: 8,
        totalDrivers: 12,
        oosVehicles: 0,
        activeVehicles: 9,
        totalVehicles: 10,
        hosViolations: 2,
        dqfComplianceRate: 88,
        expiredMedCerts: 1,
        upcomingMedCerts: 3,
        vehiclesNeedingMaintenance: 0,
      });
    tick();
    expect(component.cards.length).toBe(6);
    expect(component.cards[0].id).toBe('active-drivers');
    expect(component.cards[0].value).toBe('8/12');
    // No deltas for legacy shape
    component.cards.forEach((c) => expect(c.delta.direction).toBe('none'));
    httpMock.verify();
  }));

  it('renders deltas with correct tone from new {current, delta} envelope', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock.expectOne((r) => r.url === STATS_URL).flush({
      window: '7d',
      current: {
        activeDrivers: 10,
        totalDrivers: 12,
        oosVehicles: 1,
        hosViolations: 1,
        dqfComplianceRate: 92,
        expiredMedCerts: 0,
        upcomingMedCerts: 2,
        vehiclesNeedingMaintenance: 0,
      },
      delta: {
        activeDrivers: 2,
        oosVehicles: -1,
        hosViolations: 1,
        dqfComplianceRate: 3,
        expiredMedCerts: 0,
        vehiclesNeedingMaintenance: 0,
      },
    });
    tick();
    const drivers = component.cards.find((c) => c.id === 'active-drivers')!;
    // higher-better, +2 → good
    expect(drivers.delta.direction).toBe('up');
    expect(drivers.delta.tone).toBe('good');
    expect(drivers.delta.text).toBe('+2');

    const oos = component.cards.find((c) => c.id === 'vehicle-oos')!;
    // lower-better, -1 → good
    expect(oos.delta.direction).toBe('down');
    expect(oos.delta.tone).toBe('good');

    const hos = component.cards.find((c) => c.id === 'hos-violations')!;
    // lower-better, +1 → bad
    expect(hos.delta.tone).toBe('bad');

    const dqf = component.cards.find((c) => c.id === 'dqf-compliance')!;
    // percentage-point delta
    expect(dqf.delta.text).toBe('+3pp');
    httpMock.verify();
  }));

  it('shows critical severity for OOS vehicles > 0', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock.expectOne((r) => r.url === STATS_URL).flush({ oosVehicles: 3 });
    tick();
    const oos = component.cards.find((c) => c.id === 'vehicle-oos')!;
    expect(oos.severity).toBe('critical');
    httpMock.verify();
  }));

  it('shows error state when stats request fails', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne((r) => r.url === STATS_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    tick();
    expect(component.error).toContain('Could not load');
    expect(component.loading).toBeFalse();
    httpMock.verify();
  }));
});
