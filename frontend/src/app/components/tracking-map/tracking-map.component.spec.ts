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

  it('builds vehicle GeoJSON features carrying status + heading props (FN-1725)', () => {
    // Seed two positions and mark them as rendered (in the tween set).
    const a = pos({ vehicleId: 'v1', unitNumber: 'Unit 1', movementStatus: 'moving', headingDeg: 90 });
    const b = pos({ vehicleId: 'v2', unitNumber: 'Unit 2', movementStatus: 'idle', headingDeg: 270, lat: 40, lng: -88 });
    (component as any).positions.set('v1', a);
    (component as any).positions.set('v2', b);
    (component as any).tweens.set('v1', (component as any).newTween(a.lng, a.lat));
    (component as any).tweens.set('v2', (component as any).newTween(b.lng, b.lat));

    const fc = (component as any).buildVehicleFeatures() as GeoJSON.FeatureCollection;
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.length).toBe(2);

    const f1 = fc.features.find((f) => f.properties?.['vehicleId'] === 'v1')!;
    expect(f1.geometry.type).toBe('Point');
    expect((f1.geometry as GeoJSON.Point).coordinates).toEqual([-87.6, 41.8]);
    expect(f1.properties?.['unitNumber']).toBe('Unit 1');
    expect(f1.properties?.['status']).toBe('moving');
    expect(f1.properties?.['heading']).toBe(90);

    const f2 = fc.features.find((f) => f.properties?.['vehicleId'] === 'v2')!;
    expect(f2.properties?.['status']).toBe('idle');
    expect(f2.properties?.['heading']).toBe(270);
  });

  it('vehicle features default status to offline and heading to 0 when missing (FN-1725)', () => {
    const p = pos({ vehicleId: 'v9', movementStatus: undefined, headingDeg: null });
    (component as any).positions.set('v9', p);
    (component as any).tweens.set('v9', (component as any).newTween(p.lng, p.lat));

    const fc = (component as any).buildVehicleFeatures() as GeoJSON.FeatureCollection;
    const f = fc.features.find((x) => x.properties?.['vehicleId'] === 'v9')!;
    expect(f.properties?.['status']).toBe('offline');
    expect(f.properties?.['heading']).toBe(0);
  });

  it('rebuildLayer only renders filtered-in vehicles (FN-1725)', () => {
    (component as any).positions.set('v1', pos({ vehicleId: 'v1', driverId: 'd1' }));
    (component as any).positions.set('v2', pos({ vehicleId: 'v2', driverId: 'd2' }));
    component.filterDriverId = 'd1';
    (component as any).rebuildLayer();

    const ids = [...(component as any).tweens.keys()];
    expect(ids).toEqual(['v1']);
    expect(component.visibleCount).toBe(1);
  });

  it('approximates a circle geofence as a closed lng/lat ring (FN-1720)', () => {
    const ring = (component as any).circleRing(41.8, -87.6, 1000, 64) as number[][];
    expect(ring.length).toBe(65); // steps + 1, closed
    // First and last points coincide (closed ring).
    expect(ring[0][0]).toBeCloseTo(ring[64][0], 6);
    expect(ring[0][1]).toBeCloseTo(ring[64][1], 6);
    // Every vertex is roughly the requested radius from the centre.
    const dist = (component as any).haversineMeters(41.8, -87.6, ring[10][1], ring[10][0]) as number;
    expect(dist).toBeCloseTo(1000, -1); // within ~10m
  });

  it('builds a geofence FeatureCollection carrying the geofence name (FN-1720)', () => {
    (component as any).geofences = [
      { id: 'g1', name: 'Yard', kind: 'circle', center: { lat: 41.8, lng: -87.6 }, radiusMeters: 500 },
      { id: 'p1', name: 'Box', kind: 'polygon', vertices: [
        { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 },
      ] },
    ];
    const fc = (component as any).geofenceFeatureCollection();
    expect(fc.features.length).toBe(2);
    expect(fc.features[0].properties.name).toBe('Yard');
    expect(fc.features[1].geometry.type).toBe('Polygon');
    // Polygon ring is closed (first === last vertex).
    const ring = fc.features[1].geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('builds a Google Maps deep-link for a vehicle coordinate (FN-1723)', () => {
    expect(component.mapsUrl(pos({ lat: 41.8, lng: -87.6 })))
      .toBe('https://www.google.com/maps?q=41.8,-87.6');
    expect(component.mapsUrl(pos({ lat: null as any, lng: null as any }))).toBe('');
    expect(component.mapsUrl(null)).toBe('');
  });

  it('follow-the-unit: enter sets the follow target + label, stop clears it (FN-1723)', () => {
    (component as any).positions.set('v1', pos({ vehicleId: 'v1', unitNumber: 'Unit 1' }));
    (component as any).enterFollow('v1');
    expect(component.followVehicleId).toBe('v1');
    expect(component.followUnitLabel).toBe('Unit 1');

    component.stopFollow();
    expect(component.followVehicleId).toBeNull();
    expect(component.followUnitLabel).toBeNull();
  });

  it('closing the side panel also stops following (FN-1723)', () => {
    component.followVehicleId = 'v1';
    component.followUnitLabel = 'Unit 1';
    component.selected = pos();
    component.closePanel();
    expect(component.selected).toBeNull();
    expect(component.followVehicleId).toBeNull();
  });
});
