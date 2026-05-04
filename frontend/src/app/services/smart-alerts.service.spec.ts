/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Subject } from 'rxjs';

import {
  SmartAlert,
  SmartAlertsResponse,
  SmartAlertsService,
  SMART_ALERT_WS_EVENTS,
  detailFor,
  defaultActionFor,
  severityBucket,
} from './smart-alerts.service';
import { WebsocketService } from './websocket.service';
import { environment } from '../../environments/environment';

class MockWebsocketService {
  private subjects = new Map<string, Subject<any>>();
  on<T = any>(event: string) {
    if (!this.subjects.has(event)) this.subjects.set(event, new Subject<T>());
    return this.subjects.get(event)!.asObservable();
  }
  emit(event: string, payload: any) {
    this.subjects.get(event)?.next(payload);
  }
}

const alert = (over: Partial<SmartAlert> = {}): SmartAlert => ({
  id: 'a1',
  type: 'hos_imminent',
  subjectId: 'driver-1',
  subjectKind: 'driver',
  title: 'HOS violation imminent: J. Smith',
  facts: { driverName: 'J. Smith', minutesRemaining: 30, windowType: '11h' },
  severity: 90,
  ...over,
});

describe('SmartAlertsService', () => {
  let service: SmartAlertsService;
  let httpMock: HttpTestingController;
  let ws: MockWebsocketService;
  const endpoint = `${environment.apiUrl}/alerts/smart`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        SmartAlertsService,
        { provide: WebsocketService, useClass: MockWebsocketService },
      ],
    });
    service = TestBed.inject(SmartAlertsService);
    httpMock = TestBed.inject(HttpTestingController);
    ws = TestBed.inject(WebsocketService) as unknown as MockWebsocketService;
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('GETs /api/alerts/smart and exposes alerts$ sorted by severity desc', (done) => {
    const response: SmartAlertsResponse = {
      tenantId: 't1',
      generatedAt: '2026-05-04T10:00:00Z',
      alerts: [
        alert({ id: 'a1', severity: 60 }),
        alert({ id: 'a2', severity: 95 }),
        alert({ id: 'a3', severity: 80 }),
      ],
    };

    service.fetch().subscribe(() => {
      service.alerts$.subscribe((list) => {
        expect(list.map((a) => a.id)).toEqual(['a2', 'a3', 'a1']);
        done();
      });
    });

    const req = httpMock.expectOne(endpoint);
    expect(req.request.method).toBe('GET');
    req.flush(response);
  });

  it('replaces the local list when alerts.smart.update fires (full snapshot)', (done) => {
    service.startLiveUpdates();
    service.fetch().subscribe(() => {
      ws.emit(SMART_ALERT_WS_EVENTS.UPDATE, {
        tenantId: 't1',
        generatedAt: '2026-05-04T10:01:00Z',
        alerts: [alert({ id: 'b1', severity: 99 }), alert({ id: 'b2', severity: 77 })],
      });
      service.alerts$.subscribe((list) => {
        expect(list.map((a) => a.id)).toEqual(['b1', 'b2']);
        done();
      });
    });

    httpMock.expectOne(endpoint).flush({
      tenantId: 't1',
      generatedAt: '2026-05-04T10:00:00Z',
      alerts: [alert({ id: 'a1' }), alert({ id: 'a2', severity: 50 })],
    });
  });

  it('removes an alert when alerts.smart.dismissed fires', (done) => {
    service.startLiveUpdates();
    service.fetch().subscribe(() => {
      ws.emit(SMART_ALERT_WS_EVENTS.DISMISSED, {
        tenantId: 't1',
        userId: 'u1',
        alertId: 'a1',
        dismissedAt: '2026-05-04T10:02:00Z',
      });
      service.alerts$.subscribe((list) => {
        expect(list.find((a) => a.id === 'a1')).toBeUndefined();
        expect(list.length).toBe(1);
        done();
      });
    });

    httpMock.expectOne(endpoint).flush({
      tenantId: 't1',
      generatedAt: '2026-05-04T10:00:00Z',
      alerts: [alert({ id: 'a1' }), alert({ id: 'a2' })],
    });
  });

  it('startLiveUpdates is idempotent — calling twice does not double-bind events', (done) => {
    service.startLiveUpdates();
    service.startLiveUpdates();
    service.fetch().subscribe(() => {
      ws.emit(SMART_ALERT_WS_EVENTS.UPDATE, {
        tenantId: 't1',
        generatedAt: '2026-05-04T10:01:00Z',
        alerts: [alert({ id: 'a1', severity: 10 })],
      });
      // If the event were double-bound the service would emit twice; we assert
      // the final state is still consistent (single alert).
      service.alerts$.subscribe((list) => {
        expect(list.length).toBe(1);
        expect(list[0].severity).toBe(10);
        done();
      });
    });

    httpMock.expectOne(endpoint).flush({
      tenantId: 't1',
      generatedAt: '2026-05-04T10:00:00Z',
      alerts: [alert({ id: 'a1', severity: 90 })],
    });
  });

  it('dismiss() optimistically removes the alert and POSTs the dismissal', (done) => {
    service.fetch().subscribe(() => {
      let observedRemoval = false;
      service.alerts$.subscribe((list) => {
        if (list.length === 0) observedRemoval = true;
      });
      service.dismiss('a1').subscribe(() => {
        expect(observedRemoval).toBe(true);
        done();
      });
      const req = httpMock.expectOne(`${endpoint}/a1/dismiss`);
      expect(req.request.method).toBe('POST');
      req.flush(null);
    });

    httpMock.expectOne(endpoint).flush({
      tenantId: 't1',
      generatedAt: '2026-05-04T10:00:00Z',
      alerts: [alert({ id: 'a1' })],
    });
  });

  it('caps the local list at 50 even if the server returns more', (done) => {
    const many: SmartAlert[] = Array.from({ length: 75 }, (_, i) =>
      alert({ id: `a${i}`, severity: 100 - i }),
    );
    service.fetch().subscribe(() => {
      service.alerts$.subscribe((list) => {
        expect(list.length).toBe(50);
        done();
      });
    });

    httpMock.expectOne(endpoint).flush({
      tenantId: 't1',
      generatedAt: '2026-05-04T10:00:00Z',
      alerts: many,
    });
  });
});

describe('severityBucket', () => {
  it('maps 0-100 score onto the four-tier bucket', () => {
    expect(severityBucket(95)).toBe('critical');
    expect(severityBucket(80)).toBe('critical');
    expect(severityBucket(79)).toBe('high');
    expect(severityBucket(60)).toBe('high');
    expect(severityBucket(59)).toBe('medium');
    expect(severityBucket(40)).toBe('medium');
    expect(severityBucket(39)).toBe('low');
    expect(severityBucket(0)).toBe('low');
    expect(severityBucket(NaN as unknown as number)).toBe('low');
  });
});

describe('detailFor', () => {
  it('renders an HOS imminent detail line from facts', () => {
    const a: SmartAlert = {
      id: 'x',
      type: 'hos_imminent',
      subjectId: 'd1',
      subjectKind: 'driver',
      title: '',
      facts: { driverName: 'J. Smith', minutesRemaining: 25, windowType: '14h' },
      severity: 80,
    };
    expect(detailFor(a)).toContain('J. Smith');
    expect(detailFor(a)).toContain('25 min');
    expect(detailFor(a)).toContain('14h');
  });

  it('falls back to a default sentence when facts are sparse', () => {
    const a: SmartAlert = {
      id: 'x',
      type: 'fatigue',
      subjectId: 'd1',
      subjectKind: 'driver',
      title: '',
      facts: {},
      severity: 50,
    };
    expect(detailFor(a)).toBe('Driver fatigue risk detected.');
  });

  it('handles snake_case keys for inspection_overdue', () => {
    const a: SmartAlert = {
      id: 'x',
      type: 'inspection_overdue',
      subjectId: 'v1',
      subjectKind: 'vehicle',
      title: '',
      facts: { vehicle_name: 'Truck #207', days_overdue: 5 },
      severity: 65,
    };
    expect(detailFor(a)).toContain('Truck #207');
    expect(detailFor(a)).toContain('5 days overdue');
  });
});

describe('defaultActionFor', () => {
  it('uses the backend-provided action when present', () => {
    const a: SmartAlert = {
      id: 'x',
      type: 'hos_imminent',
      subjectId: 'd1',
      subjectKind: 'driver',
      title: '',
      facts: {},
      severity: 80,
      action: { label: 'Custom', routerLink: ['/custom'] },
    };
    expect(defaultActionFor(a)?.label).toBe('Custom');
  });

  it('synthesizes a driver link from subjectKind+subjectId', () => {
    const a: SmartAlert = {
      id: 'x',
      type: 'hos_imminent',
      subjectId: '42',
      subjectKind: 'driver',
      title: '',
      facts: {},
      severity: 80,
    };
    expect(defaultActionFor(a)).toEqual({ label: 'Open driver', routerLink: ['/drivers', '42'] });
  });

  it('returns null when there is no subjectId', () => {
    const a: SmartAlert = {
      id: 'x',
      type: 'late_load_risk',
      subjectId: '',
      subjectKind: 'load',
      title: '',
      facts: {},
      severity: 55,
    };
    expect(defaultActionFor(a)).toBeNull();
  });
});
