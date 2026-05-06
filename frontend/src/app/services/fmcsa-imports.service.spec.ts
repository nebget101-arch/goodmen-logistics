/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { FmcsaImportsService } from './fmcsa-imports.service';
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
});
