/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { environment } from '../../../environments/environment';

import { TrackingMapComponent } from './tracking-map.component';
import { AiSelectComponent } from '../../shared/ai-select/ai-select.component';
import { Geofence } from '../geofences/geofence.model';
import { VehicleMovementStatus, VehiclePosition } from './vehicle-position.model';

/** A minimal decorated position for assembling test fixtures. */
function pos(overrides: Partial<VehiclePosition> = {}): VehiclePosition {
  return {
    vehicleId: 'v1',
    unitNumber: 'Unit 1',
    driverId: 'd1',
    driverName: 'Pat Driver',
    lat: 41.8,
    lng: -87.6,
    speedMph: 55,
    headingDeg: 90,
    status: 'active',
    movementStatus: 'moving' as VehicleMovementStatus,
    ts: new Date().toISOString(),
    lastPingAgeSeconds: 5,
    ...overrides,
  };
}

describe('TrackingMapComponent', () => {
  let component: TrackingMapComponent;
  let fixture: ComponentFixture<TrackingMapComponent>;
  let httpMock: HttpTestingController;
  const api = environment.apiUrl;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [TrackingMapComponent, AiSelectComponent],
      imports: [CommonModule, FormsModule, HttpClientTestingModule, RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(TrackingMapComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    // First CD: ngOnInit (drivers + geofences) + ngAfterViewInit (positions + map).
    fixture.detectChanges();
    httpMock.match((r) => r.url.endsWith('/drivers')).forEach((r) => r.flush([]));
    httpMock.match((r) => r.url === `${api}/geofences`).forEach((r) => r.flush({ data: [] }));
    httpMock.match((r) => r.url === `${api}/vehicle-positions`).forEach((r) => r.flush({ data: [] }));
  });

  afterEach(() => httpMock.verify());

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  it('FN-317: filter option arrays are data fields, not getters', () => {
    for (const key of ['statusOptions', 'driverOptions', 'geofenceOptions']) {
      const desc = Object.getOwnPropertyDescriptor(component, key);
      expect(desc).toBeDefined();
      expect(desc!.get).toBeUndefined();
      expect(Array.isArray(desc!.value)).toBeTrue();
    }
  });

  it('formats last-ping age in human units from lastPingAgeSeconds', () => {
    expect(component.pingAge(pos({ lastPingAgeSeconds: 30 }))).toBe('30s ago');
    expect(component.pingAge(pos({ lastPingAgeSeconds: 300 }))).toBe('5m ago');
    expect(component.pingAge(pos({ lastPingAgeSeconds: 7200 }))).toBe('2h ago');
    expect(component.pingAge(pos({ lastPingAgeSeconds: null, ts: null }))).toBe('unknown');
    expect(component.pingAge(null)).toBe('unknown');
  });

  it('decorate derives movement status from speed + ping age', () => {
    const moving = component['decorate'](pos({ speedMph: 40, lastPingAgeSeconds: 10, movementStatus: undefined }));
    expect(moving.movementStatus).toBe('moving');

    const idle = component['decorate'](pos({ speedMph: 0, lastPingAgeSeconds: 30, movementStatus: undefined }));
    expect(idle.movementStatus).toBe('idle');

    const offline = component['decorate'](pos({ speedMph: 50, lastPingAgeSeconds: 4000, movementStatus: undefined }));
    expect(offline.movementStatus).toBe('offline');
  });

  it('matchesFilters narrows by driver and movement status', () => {
    const match = (p: VehiclePosition) => (component as any).matchesFilters(p) as boolean;

    component.filterDriverId = 'd1';
    expect(match(pos({ driverId: 'd1' }))).toBeTrue();
    expect(match(pos({ driverId: 'd2' }))).toBeFalse();

    component.filterDriverId = '';
    component.filterStatus = 'idle';
    expect(match(pos({ movementStatus: 'idle' }))).toBeTrue();
    expect(match(pos({ movementStatus: 'moving' }))).toBeFalse();
  });

  it('matchesFilters narrows by circle geofence containment (haversine)', () => {
    const gf: Geofence = {
      id: 'g1',
      name: 'Yard',
      kind: 'circle',
      center: { lat: 41.8, lng: -87.6 },
      radiusMeters: 1000,
    };
    (component as any).geofences = [gf];
    component.filterGeofenceId = 'g1';

    expect((component as any).matchesFilters(pos({ lat: 41.8, lng: -87.6 }))).toBeTrue();
    // ~30km north — well outside a 1km circle.
    expect((component as any).matchesFilters(pos({ lat: 42.07, lng: -87.6 }))).toBeFalse();
  });

  it('matchesFilters narrows by polygon geofence containment (ray cast)', () => {
    const gf: Geofence = {
      id: 'p1',
      name: 'Box',
      kind: 'polygon',
      vertices: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 10 },
        { lat: 10, lng: 10 },
        { lat: 10, lng: 0 },
      ],
    };
    (component as any).geofences = [gf];
    component.filterGeofenceId = 'p1';

    expect((component as any).matchesFilters(pos({ lat: 5, lng: 5 }))).toBeTrue();
    expect((component as any).matchesFilters(pos({ lat: 20, lng: 20 }))).toBeFalse();
  });

  it('filter changes clear a selection that no longer matches', () => {
    component.selected = pos({ driverId: 'd1' });
    component.filterDriverId = 'd2';
    component.onFiltersChanged();
    expect(component.selected).toBeNull();
  });
});
