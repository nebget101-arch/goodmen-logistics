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

  /** Flush the recipient-option fetches fired by ngOnInit (users + brokers). */
  function flushRecipientOptions(
    users: unknown[] = [],
    brokers: unknown[] = [],
  ): void {
    httpMock.expectOne(`${environment.apiUrl}/users`).flush({ data: users });
    httpMock
      .expectOne((r) => r.url.startsWith(`${environment.apiUrl}/brokers`))
      .flush({ data: brokers });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [GeofencesComponent, AiSelectComponent, AiSegmentedControlComponent],
      imports: [CommonModule, ReactiveFormsModule, HttpClientTestingModule, RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(GeofencesComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    fixture.detectChanges(); // ngOnInit → list() + recipient options, ngAfterViewInit → map
    httpMock.expectOne(base).flush({ data: [] });
    flushRecipientOptions();
  });

  afterEach(() => httpMock.verify());

  it('creates and loads the geofence list', () => {
    expect(component).toBeTruthy();
    expect(component.geofences).toEqual([]);
  });

  it('FN-317: option arrays are data fields, not getters', () => {
    for (const key of [
      'kindOptions',
      'eventKindOptions',
      'actionOptions',
      'recipientTypeOptions',
      'channelOptions',
      'userOptions',
      'brokerOptions',
    ]) {
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

  // ── Notify recipients (FN-1759) ─────────────────────────────────────────
  function addNotifyTrigger() {
    component.addTrigger({ eventKind: 'exit', action: 'notify' });
  }

  it('adds a user recipient (inside-org, channel both) to a notify trigger', () => {
    addNotifyTrigger();
    component.triggers.at(0).patchValue({ draftType: 'user', draftUserId: 'u1' });
    component.addRecipient(0);

    expect(component.recipients(0).length).toBe(1);
    const r = component.recipients(0).at(0).value;
    expect(r.recipientType).toBe('user');
    expect(r.userId).toBe('u1');
    expect(r.channel).toBe('both');
    expect(component.hasRecipientScope(0, 'inside')).toBeTrue();
    expect(component.hasRecipientScope(0, 'outside')).toBeFalse();
  });

  it('validates external email and groups email/broker as outside-org', () => {
    addNotifyTrigger();

    // invalid email is rejected
    component.triggers.at(0).patchValue({ draftType: 'email', draftEmail: 'not-an-email' });
    component.addRecipient(0);
    expect(component.recipients(0).length).toBe(0);
    expect(component.error).toContain('valid email');

    // valid email is added, channel forced to email-only
    component.triggers.at(0).patchValue({ draftType: 'email', draftEmail: 'Ops@Acme.com' });
    component.addRecipient(0);
    expect(component.recipients(0).length).toBe(1);
    expect(component.recipients(0).at(0).value.email).toBe('ops@acme.com');
    expect(component.recipients(0).at(0).value.channel).toBe('email');
    expect(component.hasRecipientScope(0, 'outside')).toBeTrue();
    expect(component.hasRecipientScope(0, 'inside')).toBeFalse();
  });

  it('does not add the same recipient twice', () => {
    addNotifyTrigger();
    component.triggers.at(0).patchValue({ draftType: 'user', draftUserId: 'u1' });
    component.addRecipient(0);
    component.triggers.at(0).patchValue({ draftType: 'user', draftUserId: 'u1' });
    component.addRecipient(0);
    expect(component.recipients(0).length).toBe(1);
  });

  it('serializes recipients on save and omits transient draft fields', () => {
    const gf: Geofence = {
      id: 'g2',
      name: 'Dock',
      kind: 'circle',
      center: { lat: 41.8, lng: -87.6 },
      radiusMeters: 200,
      triggers: [
        {
          eventKind: 'exit',
          action: 'notify',
          recipients: [{ recipientType: 'broker', brokerId: 'b9', channel: 'email' }],
        },
      ],
    };
    component.edit(gf);
    // pre-seeded broker recipient round-trips through the FormArray
    expect(component.recipients(0).length).toBe(1);

    // add an internal user too
    component.triggers.at(0).patchValue({ draftType: 'user', draftUserId: 'u5' });
    component.addRecipient(0);

    component.save();
    const req = httpMock.expectOne(`${base}/g2`);
    expect(req.request.method).toBe('PUT');
    const recipients = req.request.body.triggers[0].recipients;
    expect(recipients.length).toBe(2);
    expect(recipients).toContain(
      jasmine.objectContaining({ recipientType: 'broker', brokerId: 'b9', channel: 'email' }),
    );
    expect(recipients).toContain(
      jasmine.objectContaining({ recipientType: 'user', userId: 'u5', channel: 'both' }),
    );
    // no draft* leakage onto the wire
    expect(Object.keys(recipients[0])).toEqual(['recipientType', 'userId', 'email', 'brokerId', 'channel']);
    req.flush({ ...gf });
    httpMock.expectOne(base).flush({ data: [gf] });
  });

  it('maps fetched users and brokers into option lists', () => {
    // a fresh component instance to exercise the option-fetch mapping
    const fx = TestBed.createComponent(GeofencesComponent);
    const cmp = fx.componentInstance;
    fx.detectChanges();
    httpMock.expectOne(base).flush({ data: [] });
    httpMock
      .expectOne(`${environment.apiUrl}/users`)
      .flush({ data: [{ id: 'u1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@x.io' }] });
    httpMock
      .expectOne((r) => r.url.startsWith(`${environment.apiUrl}/brokers`))
      .flush({ data: [{ id: 'b1', name: 'Acme', city: 'Reno', state: 'NV', mc_number: 'MC1' }] });

    expect(cmp.userOptions[0]).toEqual({ value: 'u1', label: 'Ada Lovelace (ada@x.io)' });
    expect(cmp.brokerOptions[0]).toEqual({ value: 'b1', label: 'Acme / Reno, NV / MC1' });
    fx.destroy();
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
