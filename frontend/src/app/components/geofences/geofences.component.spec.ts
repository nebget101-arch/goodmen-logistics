/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { environment } from '../../../environments/environment';

import { GeofencesComponent } from './geofences.component';
import { AiSelectComponent } from '../../shared/ai-select/ai-select.component';
import { AiSegmentedControlComponent } from '../../shared/ai-segmented-control/ai-segmented-control.component';
import { GeocodeResult, Geofence } from './geofence.model';

describe('GeofencesComponent', () => {
  let component: GeofencesComponent;
  let fixture: ComponentFixture<GeofencesComponent>;
  let httpMock: HttpTestingController;
  const base = `${environment.apiUrl}/geofences`;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [GeofencesComponent, AiSelectComponent, AiSegmentedControlComponent],
      imports: [CommonModule, ReactiveFormsModule, HttpClientTestingModule, RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(GeofencesComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    fixture.detectChanges(); // ngOnInit → list(), ngAfterViewInit → map
    httpMock.expectOne(base).flush({ data: [] });
  });

  afterEach(() => httpMock.verify());

  it('creates and loads the geofence list', () => {
    expect(component).toBeTruthy();
    expect(component.geofences).toEqual([]);
  });

  it('FN-317: option arrays are readonly data fields, not getters', () => {
    for (const key of ['kindOptions', 'eventKindOptions', 'actionOptions']) {
      const desc = Object.getOwnPropertyDescriptor(component, key);
      expect(desc).toBeDefined();
      expect(desc!.get).toBeUndefined();
      expect(Array.isArray(desc!.value)).toBeTrue();
    }
  });

  it('adds and removes triggers in the FormArray', () => {
    expect(component.triggers.length).toBe(0);
    component.addTrigger();
    component.addTrigger();
    expect(component.triggers.length).toBe(2);
    component.removeTrigger(0);
    expect(component.triggers.length).toBe(1);
  });

  it('blocks save and shows an error when no geometry is drawn', () => {
    component.form.patchValue({ name: 'Yard', kind: 'circle' });
    component.save();
    expect(component.error).toContain('Draw a circle');
    httpMock.expectNone(base); // no request issued
  });

  it('edits a circle geofence and saves it via PUT', () => {
    const gf: Geofence = {
      id: 'g1',
      name: 'Chicago Yard',
      kind: 'circle',
      center: { lat: 41.8, lng: -87.6 },
      radiusMeters: 300,
      triggers: [{ eventKind: 'enter', action: 'notify' }],
    };
    component.edit(gf);

    expect(component.editingId).toBe('g1');
    expect(component.form.get('name')!.value).toBe('Chicago Yard');
    expect(component.triggers.length).toBe(1);
    expect(component.hasGeometry).toBeTrue();

    component.save();
    const req = httpMock.expectOne(`${base}/g1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.center).toEqual({ lat: 41.8, lng: -87.6 });
    req.flush({ ...gf });
    // after a successful save the list is reloaded
    httpMock.expectOne(base).flush({ data: [gf] });
  });

  it('flags a polygon that exceeds the 40-vertex limit', () => {
    const vertices = Array.from({ length: 41 }, (_, i) => ({ lat: i, lng: i }));
    component.edit({ id: 'p1', name: 'Big', kind: 'polygon', vertices });
    expect(component.vertexLimitReached).toBeTrue();
    expect(component.hasGeometry).toBeFalse();
  });

  // ── FN-1762 ───────────────────────────────────────────────────────────────
  it('selecting a geocode result drops an editable circle and pre-fills the form', () => {
    const r: GeocodeResult = { label: 'Chicago, IL', lat: 41.8, lng: -87.6, addressId: 'loc1' };
    component.selectGeocodeResult(r);

    expect(component.kind).toBe('circle');
    expect(component.hasGeometry).toBeTrue();
    expect(component.form.get('radiusMeters')!.value).toBe(200);
    // name auto-fills from the result label when blank
    expect(component.form.get('name')!.value).toBe('Chicago, IL');
    expect(component.geocodeResults).toEqual([]);
  });

  it('per-unit scope stamps the chosen vehicle id (and addressId) on the saved payload', () => {
    component.selectGeocodeResult({ label: 'Yard', lat: 1, lng: 2, addressId: 'loc9' });
    component.form.get('appliesTo')!.setValue('unit');
    component.form.get('vehicleId')!.setValue('veh-7');
    component.addTrigger();

    component.save();
    const req = httpMock.expectOne(base);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.addressId).toBe('loc9');
    expect(req.request.body.triggers[0].vehicleId).toBe('veh-7');
    req.flush({ id: 'g2' });
    httpMock.expectOne(base).flush({ data: [] }); // reload after save
  });

  it('"all units" clears the trigger vehicle id', () => {
    component.selectGeocodeResult({ label: 'Yard', lat: 1, lng: 2 });
    component.form.get('appliesTo')!.setValue('all');
    component.addTrigger();

    component.save();
    const req = httpMock.expectOne(base);
    expect(req.request.body.triggers[0].vehicleId).toBeNull();
    expect(req.request.body.addressId).toBeNull();
    req.flush({ id: 'g3' });
    httpMock.expectOne(base).flush({ data: [] });
  });
});
