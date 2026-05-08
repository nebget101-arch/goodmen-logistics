/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ReceivingActivityComponent } from './receiving-activity.component';
import { ApiService } from '../../services/api.service';

const sampleResponse = {
  success: true,
  data: [
    {
      id: 'tkt-1',
      ticket_number: 'RCV-001',
      vendor_name: 'Acme',
      reference_number: 'PO-100',
      posted_at: '2026-05-01T10:00:00Z',
      posted_by_name: 'Alice User',
      location_name: 'Main Warehouse',
      lines: [
        { sku: 'SKU-1', name: 'Bolt', qty_received: 4, unit_cost: 2.5 },
        { sku: 'SKU-2', name: 'Nut', qty_received: 6, unit_cost: 1.5 },
      ],
    },
    {
      id: 'tkt-2',
      ticket_number: 'RCV-002',
      vendor_name: 'Beta',
      reference_number: 'PO-200',
      posted_at: '2026-05-02T09:00:00Z',
      posted_by_name: 'Bob User',
      location_name: 'Main Warehouse',
      lines: [],
    },
  ],
  page: 1,
  pageSize: 25,
  total: 2,
  totalParts: 10,
  totalLines: 2,
  totalCost: 19,
  byUser: [
    { userId: 'u-a', name: 'Alice User', count: 1, totalParts: 10 },
    { userId: 'u-b', name: 'Bob User', count: 1, totalParts: 0 },
  ],
  byVendor: [
    { name: 'Acme', count: 1 },
    { name: 'Beta', count: 1 },
  ],
};

describe('ReceivingActivityComponent (FN-1494)', () => {
  let fixture: ComponentFixture<ReceivingActivityComponent>;
  let component: ReceivingActivityComponent;
  let api: jasmine.SpyObj<ApiService>;
  let router: jasmine.SpyObj<Router>;

  function setup(queryParams: Record<string, string> = {}): void {
    api = jasmine.createSpyObj<ApiService>('ApiService', [
      'getReceivingActivity',
      'getReceivingActivityCsvUrl',
      'listUsers',
    ]);
    api.getReceivingActivity.and.returnValue(of(sampleResponse));
    api.getReceivingActivityCsvUrl.and.callFake((f: any) => {
      const p = new URLSearchParams();
      Object.entries(f || {}).forEach(([k, v]) => { if (v != null) p.set(k, String(v)); });
      return `/api/receiving/activity.csv?${p.toString()}`;
    });
    api.listUsers.and.returnValue(of({ data: [
      { id: 'u-a', first_name: 'Alice', last_name: 'User', username: 'alice' },
      { id: 'u-b', first_name: 'Bob', last_name: 'User', username: 'bob' },
    ] }));

    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    const route = {
      snapshot: { queryParamMap: convertToParamMap(queryParams) },
    } as unknown as ActivatedRoute;

    TestBed.configureTestingModule({
      declarations: [ReceivingActivityComponent],
      imports: [FormsModule],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: route },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });

    fixture = TestBed.createComponent(ReceivingActivityComponent);
    component = fixture.componentInstance;
    component.locationId = 'loc-warehouse';
  }

  it('hydrates filters from URL query params on init (deep-link)', () => {
    setup({ preset: 'custom', from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z', userId: 'u-a', vendor: 'Acme', q: 'RCV', page: '2' });

    fixture.detectChanges();

    expect(component.filters.preset).toBe('custom');
    expect(component.filters.from).toBe('2026-04-01T00:00:00Z');
    expect(component.filters.to).toBe('2026-04-30T23:59:59Z');
    expect(component.filters.userId).toBe('u-a');
    expect(component.filters.vendor).toBe('Acme');
    expect(component.filters.ticketNumber).toBe('RCV');
    expect(component.page).toBe(2);
  });

  it('fetches activity on init and renders aggregations', () => {
    setup();
    fixture.detectChanges();

    expect(api.getReceivingActivity).toHaveBeenCalled();
    const call = api.getReceivingActivity.calls.mostRecent().args[0];
    expect(call?.locationId).toBe('loc-warehouse');
    expect(component.rows.length).toBe(2);
    expect(component.totalParts).toBe(10);
    expect(component.totalCost).toBe(19);
    expect(component.total).toBe(2);
    expect(component.uniqueUsers).toBe(2);
    expect(component.byVendor.length).toBe(2);
  });

  it('refetches when a date preset is chosen', fakeAsync(() => {
    setup();
    fixture.detectChanges();
    api.getReceivingActivity.calls.reset();

    component.setPreset('30d');
    tick(300);

    expect(api.getReceivingActivity).toHaveBeenCalled();
    const call = api.getReceivingActivity.calls.mostRecent().args[0];
    expect(call?.from).toBeTruthy();
    expect(call?.to).toBeTruthy();
    expect(component.page).toBe(1);
  }));

  it('client-side narrows visible rows by ticket# search without refetching', () => {
    setup();
    fixture.detectChanges();
    api.getReceivingActivity.calls.reset();

    component.filters.ticketNumber = 'RCV-002';
    component.onTicketSearch();

    expect(api.getReceivingActivity).not.toHaveBeenCalled();
    expect(component.visibleRows.length).toBe(1);
    expect(component.visibleRows[0].ticketNumber).toBe('RCV-002');
  });

  it('opens the drawer with computed totals when a row is opened', () => {
    setup();
    fixture.detectChanges();

    component.openTicket(component.rows[0]);

    expect(component.selectedTicket).toBeTruthy();
    expect(component.selectedTicket!.ticketNumber).toBe('RCV-001');
    // 4*2.5 + 6*1.5 = 19; 4 + 6 = 10
    expect(component.selectedTicket!.totalCost).toBeCloseTo(19, 5);
    expect(component.selectedTicket!.totalParts).toBe(10);
    expect(component.selectedTicket!.lines.length).toBe(2);
  });

  it('opens the drawer when a row Enter key is pressed', () => {
    setup();
    fixture.detectChanges();

    const evt = new KeyboardEvent('keydown', { key: 'Enter' });
    spyOn(evt, 'preventDefault');
    component.onRowKeydown(evt, component.rows[1]);

    expect(component.selectedTicket?.ticketNumber).toBe('RCV-002');
  });

  it('closes the drawer when closeDrawer is called', () => {
    setup();
    fixture.detectChanges();
    component.openTicket(component.rows[0]);
    expect(component.selectedTicket).toBeTruthy();

    component.closeDrawer();

    expect(component.selectedTicket).toBeNull();
  });

  it('builds CSV URL from current filters', () => {
    setup();
    fixture.detectChanges();
    component.filters.userId = 'u-a';
    component.filters.vendor = 'Acme';

    const url = component.csvUrl();

    expect(url).toContain('locationId=loc-warehouse');
    expect(url).toContain('userId=u-a');
    expect(url).toContain('vendor=Acme');
  });

  it('surfaces error and offers retry path', () => {
    setup();
    api.getReceivingActivity.and.returnValue(throwError(() => ({ error: { error: 'boom' } })));

    fixture.detectChanges();

    expect(component.error).toBe('boom');
    expect(component.loading).toBe(false);

    api.getReceivingActivity.and.returnValue(of(sampleResponse));
    component.retry();

    expect(component.error).toBe('');
    expect(component.rows.length).toBe(2);
  });

  it('paginates next/prev within total bounds', () => {
    setup();
    fixture.detectChanges();
    api.getReceivingActivity.calls.reset();
    component.total = 100;
    component.pageSize = 25;
    component.page = 1;

    component.nextPage();

    expect(component.page).toBe(2);
    expect(api.getReceivingActivity).toHaveBeenCalled();
    const call = api.getReceivingActivity.calls.mostRecent().args[0];
    expect(call?.page).toBe(2);

    component.prevPage();
    expect(component.page).toBe(1);
  });
});
