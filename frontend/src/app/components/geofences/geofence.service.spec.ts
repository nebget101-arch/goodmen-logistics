/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { GeofenceService } from './geofence.service';
import { GeofencePayload } from './geofence.model';

describe('GeofenceService', () => {
  let service: GeofenceService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiUrl}/geofences`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [GeofenceService],
    });
    service = TestBed.inject(GeofenceService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists geofences with no filters', () => {
    service.list().subscribe();
    const req = httpMock.expectOne(base);
    expect(req.request.method).toBe('GET');
    req.flush({ data: [] });
  });

  it('encodes active / ownedBy / near filters into the query string', () => {
    service
      .list({ active: true, ownedBy: 'u1', near: { lat: 41.8, lng: -87.6 }, nearRadiusMeters: 500 })
      .subscribe();
    const req = httpMock.expectOne(
      (r) =>
        r.url === base &&
        r.params.get('active') === 'true' &&
        r.params.get('ownedBy') === 'u1' &&
        r.params.get('near') === '-87.6,41.8' &&
        r.params.get('nearRadiusMeters') === '500',
    );
    expect(req.request.method).toBe('GET');
    req.flush({ data: [] });
  });

  it('encodes the vehicle_id (per-unit) filter into the query string', () => {
    service.list({ vehicleId: 'veh-7' }).subscribe();
    const req = httpMock.expectOne(
      (r) => r.url === base && r.params.get('vehicle_id') === 'veh-7',
    );
    expect(req.request.method).toBe('GET');
    req.flush({ data: [] });
  });

  it('geocodes an address and maps address_id → addressId', () => {
    let result: any;
    service.geocode('chicago il').subscribe((r) => (result = r));
    const req = httpMock.expectOne(`${base}/geocode?q=chicago%20il`);
    expect(req.request.method).toBe('GET');
    req.flush({
      data: [{ label: 'Chicago, IL', lat: 41.8, lng: -87.6, type: 'city', address_id: 'loc1' }],
      meta: { total: 1, cached: false },
    });
    expect(result).toEqual([
      { label: 'Chicago, IL', lat: 41.8, lng: -87.6, type: 'city', addressId: 'loc1' },
    ]);
  });

  it('creates a geofence via POST', () => {
    const payload: GeofencePayload = {
      name: 'Yard',
      kind: 'circle',
      center: { lat: 41.8, lng: -87.6 },
      radiusMeters: 250,
      triggers: [],
    };
    service.create(payload).subscribe();
    const req = httpMock.expectOne(base);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush({ id: 'g1', ...payload });
  });

  it('updates a geofence via PUT to /:id', () => {
    const payload: GeofencePayload = { name: 'Yard 2', kind: 'polygon', vertices: [] };
    service.update('g1', payload).subscribe();
    const req = httpMock.expectOne(`${base}/g1`);
    expect(req.request.method).toBe('PUT');
    req.flush({ id: 'g1', ...payload });
  });

  it('deletes a geofence via DELETE to /:id', () => {
    service.delete('g1').subscribe();
    const req = httpMock.expectOne(`${base}/g1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
