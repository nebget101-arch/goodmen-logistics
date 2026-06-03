/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ManufacturersService, MasterEntity } from './manufacturers.service';
import { VendorsService } from './vendors.service';
import { environment } from '../../environments/environment';

describe('ManufacturersService + VendorsService (FN-1094)', () => {
  let manufacturers: ManufacturersService;
  let vendors: VendorsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ManufacturersService, VendorsService],
    });
    manufacturers = TestBed.inject(ManufacturersService);
    vendors = TestBed.inject(VendorsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('search() unwraps { success, data } and forwards q + limit', () => {
    const rows: MasterEntity[] = [{ id: 1, name: 'Acme' }];
    let received: MasterEntity[] | undefined;
    manufacturers.search('acme', 5).subscribe((r) => (received = r));

    const req = http.expectOne(
      (r) => r.url === `${environment.apiUrl}/manufacturers/search` &&
             r.params.get('q') === 'acme' &&
             r.params.get('limit') === '5'
    );
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: rows });
    expect(received).toEqual(rows);
  });

  it('search() returns [] when payload has no data', () => {
    let received: MasterEntity[] | undefined;
    manufacturers.search('zzz').subscribe((r) => (received = r));
    const req = http.expectOne((r) => r.url.endsWith('/manufacturers/search'));
    req.flush({ success: true });
    expect(received).toEqual([]);
  });

  it('create() POSTs name and unwraps the created row', () => {
    let received: MasterEntity | undefined;
    manufacturers.create('  Bosch  ').subscribe((r) => (received = r));
    const req = http.expectOne(`${environment.apiUrl}/manufacturers`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Bosch' });
    req.flush({ success: true, data: { id: 9, name: 'Bosch' } });
    expect(received).toEqual({ id: 9, name: 'Bosch' });
  });

  it('VendorsService targets /vendors instead of /manufacturers', () => {
    vendors.search('napa').subscribe();
    http.expectOne((r) => r.url === `${environment.apiUrl}/vendors/search`).flush({
      success: true,
      data: [],
    });

    vendors.create('NAPA').subscribe();
    http.expectOne(`${environment.apiUrl}/vendors`).flush({
      success: true,
      data: { id: 1, name: 'NAPA' },
    });
  });
});
