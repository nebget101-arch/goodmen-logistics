/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { PublicTrackService } from './public-track.service';
import { PublicTrackEnvelope, PublicTrackPayload } from './public-track.models';
import { environment } from '../../environments/environment';

const samplePayload: PublicTrackPayload = {
  loadNumber: 'L-1042',
  status: 'in_transit',
  statusLabel: 'In transit',
  eta: '2026-06-04T18:00:00.000Z',
  lastUpdatedAt: '2026-06-03T12:00:00.000Z',
  reveal: { driverName: false, vehicleNumber: false, breadcrumbs: false, routeLine: true },
  currentPosition: { lat: 32.78, lon: -96.8 },
  origin: { label: 'Dallas, TX', lat: 32.78, lon: -96.8 },
  destination: { label: 'Memphis, TN', lat: 35.15, lon: -90.05 },
  milestones: [
    { key: 'pickup', label: 'Picked up', state: 'complete', timestamp: '2026-06-03T08:00:00.000Z' },
    { key: 'in_transit', label: 'In transit', state: 'current', timestamp: '2026-06-03T09:00:00.000Z' },
    { key: 'delivered', label: 'Delivered', state: 'upcoming', timestamp: null }
  ]
};

describe('PublicTrackService', () => {
  let service: PublicTrackService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PublicTrackService]
    });
    service = TestBed.inject(PublicTrackService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('unwraps the envelope and returns the payload', () => {
    let received: PublicTrackPayload | undefined;
    service.fetch('tok-123').subscribe((p) => (received = p));

    const req = httpMock.expectOne(`${environment.apiUrl}/track/tok-123`);
    expect(req.request.method).toBe('GET');
    const envelope: PublicTrackEnvelope = { success: true, data: samplePayload };
    req.flush(envelope);

    expect(received).toEqual(samplePayload);
  });

  it('URL-encodes the token in the path', () => {
    service.fetch('a/b+c=').subscribe({ error: () => void 0 });
    const req = httpMock.expectOne(`${environment.apiUrl}/track/${encodeURIComponent('a/b+c=')}`);
    req.flush(null, { status: 404, statusText: 'Not Found' });
  });

  it('maps 404 → not_found', () => {
    let reason: unknown;
    service.fetch('bad').subscribe({ error: (r) => (reason = r) });
    httpMock.expectOne(`${environment.apiUrl}/track/bad`).flush(null, { status: 404, statusText: 'Not Found' });
    expect(reason).toBe('not_found');
  });

  it('maps 410 → gone', () => {
    let reason: unknown;
    service.fetch('expired').subscribe({ error: (r) => (reason = r) });
    httpMock.expectOne(`${environment.apiUrl}/track/expired`).flush(null, { status: 410, statusText: 'Gone' });
    expect(reason).toBe('gone');
  });

  it('maps other statuses → error', () => {
    let reason: unknown;
    service.fetch('boom').subscribe({ error: (r) => (reason = r) });
    httpMock.expectOne(`${environment.apiUrl}/track/boom`).flush(null, { status: 500, statusText: 'Server Error' });
    expect(reason).toBe('error');
  });

  it('reasonFromStatus is exhaustive', () => {
    expect(PublicTrackService.reasonFromStatus(404)).toBe('not_found');
    expect(PublicTrackService.reasonFromStatus(410)).toBe('gone');
    expect(PublicTrackService.reasonFromStatus(0)).toBe('error');
    expect(PublicTrackService.reasonFromStatus(503)).toBe('error');
  });
});
