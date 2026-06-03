/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpEventType, HttpResponse } from '@angular/common/http';

import { FmcsaImportsService, RunUploadResponse } from './fmcsa-imports.service';
import { environment } from '../../environments/environment';

describe('FmcsaImportsService', () => {
  let service: FmcsaImportsService;
  let httpMock: HttpTestingController;
  const baseUrl = `${environment.apiUrl}/fmcsa/imports`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [FmcsaImportsService],
    });
    service = TestBed.inject(FmcsaImportsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs the imports ledger', () => {
    service.list().subscribe();
    const req = httpMock.expectOne(baseUrl);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: [] });
  });

  it('POSTs to /run with files and dryRun false by default', () => {
    service.run({ files: ['census', 'authority'] }).subscribe();
    const req = httpMock.expectOne(`${baseUrl}/run`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ files: ['census', 'authority'] });
    req.flush({ success: true, data: { runIds: ['run-1', 'run-2'] } });
  });

  it('forwards dryRun=true when set', () => {
    service.run({ files: ['sms'], dryRun: true }).subscribe();
    const req = httpMock.expectOne(`${baseUrl}/run`);
    expect(req.request.body).toEqual({ files: ['sms'], dryRun: true });
    req.flush({ success: true, data: { runIds: ['run-3'] } });
  });

  describe('runUpload', () => {
    it('POSTs FormData to /run-upload with file, fileType, and dryRun', () => {
      const file = new File(['col1,col2\n1,2\n'], 'census.csv', { type: 'text/csv' });
      service.runUpload(file, 'census', false).subscribe();

      const req = httpMock.expectOne(`${baseUrl}/run-upload`);
      expect(req.request.method).toBe('POST');
      expect(req.request.reportProgress).toBeTrue();

      const body = req.request.body as FormData;
      expect(body instanceof FormData).toBeTrue();
      expect((body.get('file') as File).name).toBe('census.csv');
      expect(body.get('fileType')).toBe('census');
      expect(body.get('dryRun')).toBe('false');

      req.flush({ success: true, data: { runId: 'r-7', file: 'census.csv', uploadedSizeBytes: 17 } });
    });

    it('emits the response data when the upload completes', () => {
      const file = new File(['x'], 'sms.csv.gz');
      const emitted: any[] = [];
      service.runUpload(file, 'sms', true).subscribe((r) => emitted.push(r));

      const req = httpMock.expectOne(`${baseUrl}/run-upload`);
      const responseBody: RunUploadResponse = {
        success: true,
        data: { runId: 'r-9', file: 'sms.csv.gz', uploadedSizeBytes: 1 },
      };
      req.event(new HttpResponse({ body: responseBody, status: 202 }));

      expect(emitted).toEqual([{ runId: 'r-9', file: 'sms.csv.gz', uploadedSizeBytes: 1 }]);
    });

    it('publishes upload progress on uploadProgress$', () => {
      const file = new File(['x'.repeat(100)], 'inspections.csv');
      const progressValues: number[] = [];
      const sub = service.uploadProgress$.subscribe((v) => progressValues.push(v));

      service.runUpload(file, 'inspections', false).subscribe();

      const req = httpMock.expectOne(`${baseUrl}/run-upload`);

      req.event({ type: HttpEventType.UploadProgress, loaded: 25, total: 100 });
      req.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
      req.event({ type: HttpEventType.UploadProgress, loaded: 100, total: 100 });
      req.event(
        new HttpResponse({
          body: { success: true, data: { runId: 'r-1', file: 'inspections.csv', uploadedSizeBytes: 100 } },
          status: 202,
        }),
      );

      expect(progressValues).toContain(25);
      expect(progressValues).toContain(50);
      expect(progressValues).toContain(100);
      sub.unsubscribe();
    });

    it('propagates HTTP errors (e.g. 413) to subscribers', () => {
      const file = new File(['x'], 'huge.csv');
      let errorReceived: any;
      service.runUpload(file, 'crashes', false).subscribe({
        next: () => fail('should not emit'),
        error: (err) => (errorReceived = err),
      });

      const req = httpMock.expectOne(`${baseUrl}/run-upload`);
      req.flush({ success: false, error: 'Upload exceeds 1 GB limit' }, { status: 413, statusText: 'Payload Too Large' });

      expect(errorReceived).toBeTruthy();
      expect(errorReceived.status).toBe(413);
    });
  });
});
