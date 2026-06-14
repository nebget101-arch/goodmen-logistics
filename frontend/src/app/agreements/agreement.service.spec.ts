/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';

import { AgreementService } from './agreement.service';

/**
 * FN-1801 — covers the equipment-lease adapter client methods that back the
 * vehicle / equipment-owner entry point + status display (FN-1800 contract).
 */
describe('AgreementService — equipment-lease adapter (FN-1801)', () => {
  let service: AgreementService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiUrl}/agreements`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AgreementService],
    });
    service = TestBed.inject(AgreementService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('POSTs the subject + signer payload to the equipment-lease endpoint', () => {
    const payload = {
      subjectType: 'vehicle' as const,
      subjectId: 'veh-1',
      templateId: 'tpl-1',
      fieldValues: { lessor_name: 'Acme Leasing' },
      signer: { name: 'Pat Lessor', email: 'pat@example.com', role: 'Lessor' },
    };
    let result: any;
    service.startEquipmentLeaseSigning(payload).subscribe((r) => (result = r));

    const req = httpMock.expectOne(`${base}/equipment-lease/requests`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush({ requestId: 'req-1', signerLink: 'https://x/sign/t', status: 'sent', link: {} });

    expect(result.requestId).toBe('req-1');
    expect(result.status).toBe('sent');
  });

  it('lists a subject\'s signings and unwraps the data envelope', () => {
    let rows: any;
    service.listEquipmentLeaseSignings('vehicle', 'veh-9').subscribe((r) => (rows = r));

    const req = httpMock.expectOne(
      (r) =>
        r.url === `${base}/equipment-lease/requests` &&
        r.params.get('subjectType') === 'vehicle' &&
        r.params.get('subjectId') === 'veh-9'
    );
    expect(req.request.method).toBe('GET');
    req.flush({ data: [{ id: 'l1', subjectType: 'vehicle', subjectId: 'veh-9', request: { id: 'req-1', status: 'signed' } }] });

    expect(rows.length).toBe(1);
    expect(rows[0].request.status).toBe('signed');
  });

  it('returns an empty array when the list response has no data', () => {
    let rows: any;
    service.listEquipmentLeaseSignings('equipment_owner', 'own-1').subscribe((r) => (rows = r));
    const req = httpMock.expectOne((r) => r.url === `${base}/equipment-lease/requests`);
    req.flush({});
    expect(rows).toEqual([]);
  });
});
