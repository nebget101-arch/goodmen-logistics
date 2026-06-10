/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { IncidentListComponent, DriverIncident } from './incident-list.component';
import { environment } from '../../../../environments/environment';

const CALLS_URL = `${environment.apiUrl}/roadside/calls`;

const MOCK_CALLS = [
  {
    id: 'c1',
    status: 'NEW',
    unit_number: 'T-101',
    symptoms: 'Flat tyre on I-40',
    location: 'Amarillo, TX',
    created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  },
  {
    id: 'c2',
    status: 'DISPATCHED',
    unit_number: 'T-202',
    symptoms: 'Engine overheating',
    location: 'Albuquerque, NM',
    created_at: new Date(Date.now() - 90 * 60_000).toISOString(),
  },
  {
    id: 'c3',
    status: 'RESOLVED',
    unit_number: 'T-303',
    symptoms: 'Battery jump',
    location: 'Flagstaff, AZ',
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
  },
];

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HttpClientTestingModule, IncidentListComponent],
    providers: [provideRouter([])],
  });
  const fixture: ComponentFixture<IncidentListComponent> =
    TestBed.createComponent(IncidentListComponent);
  const httpMock = TestBed.inject(HttpTestingController);
  return { fixture, component: fixture.componentInstance, httpMock };
}

describe('IncidentListComponent', () => {
  describe('render', () => {
    it('shows loading state on init', () => {
      const { fixture, component } = setup();
      fixture.detectChanges();
      expect(component.loading).toBeTrue();
    });

    it('renders incident cards after successful load', fakeAsync(() => {
      const { fixture, component, httpMock } = setup();
      fixture.detectChanges();
      tick();

      httpMock.expectOne(CALLS_URL).flush(MOCK_CALLS);
      tick();
      fixture.detectChanges();

      expect(component.loading).toBeFalse();
      expect(component.incidents.length).toBe(3);
      expect(component.error).toBe('');
      httpMock.verify();
    }));

    it('shows error state when request fails', fakeAsync(() => {
      const { fixture, component, httpMock } = setup();
      fixture.detectChanges();
      tick();

      httpMock
        .expectOne(CALLS_URL)
        .flush('error', { status: 500, statusText: 'Server Error' });
      tick();
      fixture.detectChanges();

      expect(component.loading).toBeFalse();
      expect(component.error).toContain('Could not load');
      httpMock.verify();
    }));

    it('shows empty state when no incidents returned', fakeAsync(() => {
      const { fixture, component, httpMock } = setup();
      fixture.detectChanges();
      tick();

      httpMock.expectOne(CALLS_URL).flush([]);
      tick();
      fixture.detectChanges();

      expect(component.loading).toBeFalse();
      expect(component.filteredIncidents.length).toBe(0);
      httpMock.verify();
    }));

    it('maps array-wrapped response shape', fakeAsync(() => {
      const { fixture, component, httpMock } = setup();
      fixture.detectChanges();
      tick();

      httpMock.expectOne(CALLS_URL).flush({ calls: MOCK_CALLS });
      tick();

      expect(component.incidents.length).toBe(3);
      httpMock.verify();
    }));
  });

  describe('filter', () => {
    function loadedSetup() {
      const ctx = setup();
      ctx.fixture.detectChanges();
      tick();
      ctx.httpMock.expectOne(CALLS_URL).flush(MOCK_CALLS);
      tick();
      ctx.fixture.detectChanges();
      return ctx;
    }

    it('shows all incidents with ALL filter (default)', fakeAsync(() => {
      const { component } = loadedSetup();
      expect(component.filteredIncidents.length).toBe(3);
    }));

    it('filters to NEW only', fakeAsync(() => {
      const { component } = loadedSetup();
      component.setFilter('NEW');
      expect(component.filteredIncidents.length).toBe(1);
      expect(component.filteredIncidents[0].status).toBe('NEW');
    }));

    it('filters to DISPATCHED only', fakeAsync(() => {
      const { component } = loadedSetup();
      component.setFilter('DISPATCHED');
      expect(component.filteredIncidents.length).toBe(1);
      expect(component.filteredIncidents[0].id).toBe('c2');
    }));

    it('returns empty array when no incidents match filter', fakeAsync(() => {
      const { component } = loadedSetup();
      component.setFilter('TRIAGED');
      expect(component.filteredIncidents.length).toBe(0);
    }));
  });

  describe('timeSince', () => {
    it('shows minutes for recent incidents', () => {
      const { component } = setup();
      const date = new Date(Date.now() - 25 * 60_000).toISOString();
      expect(component.timeSince(date)).toBe('25m ago');
    });

    it('shows hours for incidents opened hours ago', () => {
      const { component } = setup();
      const date = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
      expect(component.timeSince(date)).toBe('3h ago');
    });

    it('shows days for older incidents', () => {
      const { component } = setup();
      const date = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
      expect(component.timeSince(date)).toBe('2d ago');
    });
  });
});
