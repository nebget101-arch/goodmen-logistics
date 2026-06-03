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
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 4, 8, 23, 30, 0)); // 2026-05-08 23:30 local
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [BriefingService],
    });
    service = TestBed.inject(BriefingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    jasmine.clock().uninstall();
  });

  it('GETs the briefing endpoint with localDate (and no refresh) by default', () => {
    service.getBriefing().subscribe();
    const req = httpMock.expectOne((r) => r.url === endpoint && r.params.get('localDate') === '2026-05-08');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('refresh')).toBeFalse();
    req.flush(sampleResponse);
  });

  it('appends refresh=true alongside localDate when refresh option is true', () => {
    service.getBriefing({ refresh: true }).subscribe();
    const req = httpMock.expectOne(
      (r) =>
        r.url === endpoint &&
        r.params.get('refresh') === 'true' &&
        r.params.get('localDate') === '2026-05-08',
    );
    expect(req.request.method).toBe('GET');
    req.flush(sampleResponse);
  });

  it('omits refresh param when refresh option is false but still includes localDate', () => {
    service.getBriefing({ refresh: false }).subscribe();
    const req = httpMock.expectOne((r) => r.url === endpoint && r.params.get('localDate') === '2026-05-08');
    expect(req.request.params.has('refresh')).toBeFalse();
    req.flush(sampleResponse);
  });

  it('includes a localDate matching YYYY-MM-DD format', () => {
    service.getBriefing().subscribe();
    const req = httpMock.expectOne((r) => r.url === endpoint);
    expect(req.request.params.get('localDate')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    req.flush(sampleResponse);
  });
});
