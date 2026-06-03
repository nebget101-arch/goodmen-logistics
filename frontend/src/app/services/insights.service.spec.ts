/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { InsightsService, TrendsResponse } from './insights.service';
import { environment } from '../../environments/environment';

const sampleResponse: TrendsResponse = {
  tenantId: 'tenant-1',
  range: '7d',
  generatedAt: '2026-05-08T12:00:00.000Z',
  window: {
    actualDays: ['2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08'],
    futureDays: ['2026-05-09', '2026-05-10', '2026-05-11'],
  },
  series: {
    loadVolume: { actual: [], predicted: [] },
    maintenance: { actual: [], predicted: [] },
    onTimePct: { actual: [], predicted: [] },
    fuelCost: { actual: [], predicted: [] },
  },
  upstreamErrors: [],
  cached: false,
};

describe('InsightsService', () => {
  let service: InsightsService;
  let httpMock: HttpTestingController;
  const endpoint = `${environment.apiUrl}/insights/trends`;

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 4, 8, 23, 30, 0)); // 2026-05-08 23:30 local
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [InsightsService],
    });
    service = TestBed.inject(InsightsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    jasmine.clock().uninstall();
  });

  it('GETs the trends endpoint with range=7d and localDate by default', () => {
    service.getTrends().subscribe();
    const req = httpMock.expectOne(
      (r) =>
        r.url === endpoint &&
        r.params.get('range') === '7d' &&
        r.params.get('localDate') === '2026-05-08',
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.has('refresh')).toBeFalse();
    req.flush(sampleResponse);
  });

  it('appends refresh=true alongside localDate when refresh option is true', () => {
    service.getTrends({ refresh: true }).subscribe();
    const req = httpMock.expectOne(
      (r) =>
        r.url === endpoint &&
        r.params.get('refresh') === 'true' &&
        r.params.get('localDate') === '2026-05-08' &&
        r.params.get('range') === '7d',
    );
    expect(req.request.method).toBe('GET');
    req.flush(sampleResponse);
  });

  it('omits refresh param when refresh option is false but still includes localDate', () => {
    service.getTrends({ refresh: false }).subscribe();
    const req = httpMock.expectOne(
      (r) => r.url === endpoint && r.params.get('localDate') === '2026-05-08',
    );
    expect(req.request.params.has('refresh')).toBeFalse();
    req.flush(sampleResponse);
  });

  it('includes a localDate matching YYYY-MM-DD format', () => {
    service.getTrends().subscribe();
    const req = httpMock.expectOne((r) => r.url === endpoint);
    expect(req.request.params.get('localDate')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    req.flush(sampleResponse);
  });
});
