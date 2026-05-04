/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ReportsService } from './reports.service';
import { environment } from '../../../environments/environment';

describe('ReportsService.exportReport', () => {
  let service: ReportsService;
  let httpMock: HttpTestingController;

  const baseUrl = `${environment.apiUrl}/reports/v2`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ReportsService]
    });
    service = TestBed.inject(ReportsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('PDF export hits export endpoint with format=pdf and includeNarrative=true', () => {
    service
      .exportReport('total-revenue', 'pdf', { startDate: '2026-01-01', endDate: '2026-04-30' })
      .subscribe((blob) => {
        expect(blob).toBeTruthy();
      });

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === `${baseUrl}/export/total-revenue`
    );

    expect(req.request.params.get('format')).toBe('pdf');
    expect(req.request.params.get('includeNarrative')).toBe('true');
    expect(req.request.params.get('startDate')).toBe('2026-01-01');
    expect(req.request.params.get('endDate')).toBe('2026-04-30');
    expect(req.request.responseType).toBe('blob');

    req.flush(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
  });

  it('CSV export does NOT include the includeNarrative flag (back-compat unchanged)', () => {
    service
      .exportReport('total-revenue', 'csv', { startDate: '2026-01-01', endDate: '2026-04-30' })
      .subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === `${baseUrl}/export/total-revenue`
    );

    expect(req.request.params.get('format')).toBe('csv');
    expect(req.request.params.has('includeNarrative')).toBe(false);
    expect(req.request.responseType).toBe('blob');

    req.flush(new Blob(['period,revenue\n'], { type: 'text/csv' }));
  });

  it('skips empty filter values when building params', () => {
    service
      .exportReport('overview', 'pdf', { startDate: '2026-01-01', endDate: '', dispatcherId: undefined })
      .subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === `${baseUrl}/export/overview`
    );

    expect(req.request.params.get('startDate')).toBe('2026-01-01');
    expect(req.request.params.has('endDate')).toBe(false);
    expect(req.request.params.has('dispatcherId')).toBe(false);
    expect(req.request.params.get('includeNarrative')).toBe('true');

    req.flush(new Blob([], { type: 'application/pdf' }));
  });
});
