/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';

import {
  ShareLinkCreated,
  ShareLinkService,
  ShareRevealOptions,
} from './share-link.service';
import { environment } from '../../environments/environment';

const REVEAL: ShareRevealOptions = {
  driverName: false,
  vehicleNumber: false,
  breadcrumbs: false,
  routeLine: true,
};

describe('ShareLinkService', () => {
  let service: ShareLinkService;
  let httpMock: HttpTestingController;
  const base = environment.apiUrl;
  const loadId = 'load-123';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ShareLinkService],
    });
    service = TestBed.inject(ShareLinkService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs the per-load share-links list', () => {
    service.list(loadId).subscribe();
    const req = httpMock.expectOne(`${base}/loads/${loadId}/share-links`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: [] });
  });

  it('POSTs create with expiryDays + revealOptions', () => {
    service
      .create(loadId, { expiryDays: 7, revealOptions: REVEAL })
      .subscribe();
    const req = httpMock.expectOne(`${base}/loads/${loadId}/share-links`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ expiryDays: 7, revealOptions: REVEAL });
    req.flush({ success: true, data: {} });
  });

  it('DELETEs a share link by id to revoke it', () => {
    service.revoke('sl-9').subscribe();
    const req = httpMock.expectOne(`${base}/share-links/sl-9`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ success: true, data: null });
  });

  describe('buildShareUrl', () => {
    it('prefers the server-provided url', () => {
      const created = {
        url: 'https://app.example.com/track/abc',
        token: 'abc',
      } as ShareLinkCreated;
      expect(service.buildShareUrl(created)).toBe(
        'https://app.example.com/track/abc',
      );
    });

    it('falls back to {origin}/track/{token} when url is absent', () => {
      const created = { token: 'tok-xyz' } as ShareLinkCreated;
      expect(service.buildShareUrl(created)).toBe(
        `${window.location.origin}/track/tok-xyz`,
      );
    });
  });
});
