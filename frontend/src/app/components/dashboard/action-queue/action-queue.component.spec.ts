/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';

import { ActionQueueComponent } from './action-queue.component';
import { environment } from '../../../../environments/environment';

const QUEUE_URL = `${environment.apiUrl}/dashboard/action-queue`;
const DISMISS_URL = `${environment.apiUrl}/dashboard/action-queue/dismiss`;

function makeGroup(overrides: Partial<any> = {}) {
  return {
    id: 'compliance:driver:medical_cert_expired',
    source: 'compliance',
    severity: 'critical',
    category: 'driver',
    message: '3 drivers — Medical certificate expired',
    count: 3,
    latest_at: '2026-05-05T08:00:00.000Z',
    targets: [
      { id: 'd1', label: 'Alice', route: '/drivers/d1' },
      { id: 'd2', label: 'Bob', route: '/drivers/d2' },
      { id: 'd3', label: 'Carol', route: '/drivers/d3' },
    ],
    primary_action: { label: 'Open', action_id: 'open', payload: { route: '/drivers/d1' } },
    ...overrides,
  };
}

function envelope(groups: any[], extras: Partial<any> = {}) {
  return {
    groups,
    total: groups.reduce((sum, g) => sum + g.count, 0),
    window: '7d',
    severity: 'all',
    generatedAt: '2026-05-05T08:00:00.000Z',
    upstreamErrors: [],
    ...extras,
  };
}

describe('ActionQueueComponent', () => {
  let fixture: ComponentFixture<ActionQueueComponent>;
  let component: ActionQueueComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, RouterTestingModule, ActionQueueComponent],
    });
    fixture = TestBed.createComponent(ActionQueueComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads groups on init with default window=7d & severity=all', fakeAsync(() => {
    fixture.detectChanges();
    const req = httpMock.expectOne((r) => r.url === QUEUE_URL);
    expect(req.request.params.get('window')).toBe('7d');
    expect(req.request.params.get('severity')).toBe('all');
    req.flush(envelope([makeGroup()]));
    tick();
    expect(component.loading).toBeFalse();
    expect(component.rows.length).toBe(1);
    expect(component.total).toBe(3);
  }));

  it('shows the empty state when no groups are returned', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === QUEUE_URL).flush(envelope([]));
    tick();
    expect(component.rows.length).toBe(0);
    expect(component.error).toBeNull();
  }));

  it('surfaces a degraded banner when upstreamErrors are present', fakeAsync(() => {
    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.url === QUEUE_URL)
      .flush(envelope([makeGroup()], { upstreamErrors: [{ source: 'smart_alerts', error: 'boom' }] }));
    tick();
    expect(component.upstreamWarning).toBeTrue();
  }));

  it('refetches when the severity filter changes', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === QUEUE_URL).flush(envelope([makeGroup()]));
    tick();

    component.onSeverityChange('critical');
    const req = httpMock.expectOne((r) => r.url === QUEUE_URL);
    expect(req.request.params.get('severity')).toBe('critical');
    req.flush(envelope([makeGroup()]));
    tick();
  }));

  it('dismiss group POSTs only group_id and removes the row optimistically', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === QUEUE_URL).flush(envelope([makeGroup()]));
    tick();

    const row = component.rows[0];
    component.dismissGroup(row);
    const req = httpMock.expectOne(DISMISS_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ group_id: row.group.id });
    req.flush({ dismissed_count: 1, group_id: row.group.id });
    tick();
    expect(component.rows.length).toBe(0);
    expect(component.total).toBe(0);
  }));

  it('dismiss selected POSTs target_ids and removes only those targets', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === QUEUE_URL).flush(envelope([makeGroup()]));
    tick();

    const row = component.rows[0];
    component.toggleTarget(row, 'd1', true);
    component.toggleTarget(row, 'd2', true);
    expect(component.isAllSelected(row)).toBeFalse();

    component.dismissSelected(row);
    const req = httpMock.expectOne(DISMISS_URL);
    expect(req.request.body.group_id).toBe(row.group.id);
    expect(req.request.body.target_ids).toEqual(['d1', 'd2']);
    req.flush({ dismissed_count: 2, group_id: row.group.id });
    tick();

    expect(component.rows.length).toBe(1);
    expect(component.rows[0].group.targets.length).toBe(1);
    expect(component.rows[0].group.targets[0].id).toBe('d3');
    expect(component.total).toBe(1);
  }));

  it('select-all then dismiss selected removes the entire group', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === QUEUE_URL).flush(envelope([makeGroup()]));
    tick();

    const row = component.rows[0];
    component.toggleSelectAll(row, true);
    expect(component.isAllSelected(row)).toBeTrue();
    expect(row.selectedTargetIds.size).toBe(3);

    component.dismissSelected(row);
    const req = httpMock.expectOne(DISMISS_URL);
    expect(req.request.body.target_ids).toEqual(['d1', 'd2', 'd3']);
    req.flush({ dismissed_count: 3 });
    tick();

    expect(component.rows.length).toBe(0);
  }));

  it('primary action navigates when payload has a route', fakeAsync(() => {
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigateByUrl');
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === QUEUE_URL).flush(envelope([makeGroup()]));
    tick();

    component.onPrimaryAction(component.rows[0]);
    expect(navSpy).toHaveBeenCalledWith('/drivers/d1');
  }));

  it('falls back to expanding the row when the primary action has no route', fakeAsync(() => {
    fixture.detectChanges();
    const group = makeGroup({
      primary_action: { label: 'View list', action_id: 'view_list', payload: {} },
    });
    httpMock.expectOne((r) => r.url === QUEUE_URL).flush(envelope([group]));
    tick();

    const row = component.rows[0];
    expect(row.expanded).toBeFalse();
    component.onPrimaryAction(row);
    expect(row.expanded).toBeTrue();
  }));

  it('exposes an error message when the queue fetch fails', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === QUEUE_URL).flush('boom', { status: 500, statusText: 'Server Error' });
    tick();
    expect(component.loading).toBeFalse();
    expect(component.error).toContain('Could not load');
  }));
});
