/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { BriefingService, DailyBriefingResponse } from './briefing.service';
import { environment } from '../../environments/environment';

const sampleResponse: DailyBriefingResponse = {
  tenantId: 'tenant-1',
  date: '2026-05-04',
  cached: false,
  briefing: {
    throughput: { headline: 'a', detail: 'b', metric: 'c' },
    exceptions: { headline: 'a', detail: 'b', metric: 'c' },
    driverRisk: { headline: 'a', detail: 'b', metric: 'c' },
    vehicleRisk: { headline: 'a', detail: 'b', metric: 'c' },
    recommendedAction: { headline: 'a', detail: 'b', metric: '' },
  },
};

describe('BriefingService', () => {
  let service: BriefingService;
  let httpMock: HttpTestingController;
  const endpoint = `${environment.apiUrl}/ai/briefing`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [BriefingService],
    });
    service = TestBed.inject(BriefingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('GETs the briefing endpoint without query params by default', () => {
    service.getBriefing().subscribe();
    const req = httpMock.expectOne(endpoint);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('refresh')).toBeFalse();
    req.flush(sampleResponse);
  });

  it('appends refresh=true when refresh option is true', () => {
    service.getBriefing({ refresh: true }).subscribe();
    const req = httpMock.expectOne(
      (r) => r.url === endpoint && r.params.get('refresh') === 'true',
    );
    expect(req.request.method).toBe('GET');
    req.flush(sampleResponse);
  });

  it('omits refresh param when refresh option is false', () => {
    service.getBriefing({ refresh: false }).subscribe();
    const req = httpMock.expectOne(endpoint);
    expect(req.request.params.has('refresh')).toBeFalse();
    req.flush(sampleResponse);
  });
});
