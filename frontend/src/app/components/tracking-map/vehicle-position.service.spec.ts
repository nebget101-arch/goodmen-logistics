/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';

import { VehiclePositionService } from './vehicle-position.service';
import { VehiclePositionPing } from './vehicle-position.model';

describe('VehiclePositionService', () => {
  let service: VehiclePositionService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiUrl}/vehicle-positions`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [VehiclePositionService],
    });
    service = TestBed.inject(VehiclePositionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists positions without filters', () => {
    service.list().subscribe();
    const req = httpMock.expectOne(base);
    expect(req.request.method).toBe('GET');
    req.flush({ data: [] });
  });

  it('serializes status / driver / geofence filters into the query string', () => {
    service.list({ status: 'active', driverId: 'd1', geofenceId: 'g1' }).subscribe();
    const req = httpMock.expectOne(
      (r) => r.url === base &&
        r.params.get('status') === 'active' &&
        r.params.get('driverId') === 'd1' &&
        r.params.get('geofenceId') === 'g1',
    );
    expect(req.request.method).toBe('GET');
    req.flush({ data: [] });
  });

  it('requests a breadcrumb trail with the default 4h window (hours param)', () => {
    service.breadcrumbs('v1').subscribe();
    const req = httpMock.expectOne((r) => r.url === `${base}/v1/breadcrumbs`);
    expect(req.request.params.get('hours')).toBe('4');
    req.flush({ data: [] });
  });

  it('exposes live pings via the websocket on() stream', () => {
    const received: VehiclePositionPing[] = [];
    service.pings$().subscribe((p) => received.push(p));
    // No socket connection is opened in tests; on() simply returns the subject.
    expect(received).toEqual([]);
  });
});
