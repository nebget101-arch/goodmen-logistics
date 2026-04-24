/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { of } from 'rxjs';

import { LoadWizardStopsComponent } from './stops.component';
import { LoadsService } from '../../../../services/loads.service';
import { LoadStopType } from '../../../../models/load-dashboard.model';

function buildStop(fb: FormBuilder, type: LoadStopType, seq: number, zip: string | null = null): FormGroup {
  return fb.group({
    stop_type: [type, Validators.required],
    stop_date: [null as string | null],
    stop_time: [null as string | null],
    city: [null as string | null],
    state: [null as string | null],
    zip: [zip],
    address1: [null as string | null],
    facility_name: [null as string | null],
    notes: [null as string | null],
    sequence: [seq],
  });
}

describe('LoadWizardStopsComponent (FN-877)', () => {
  let fixture: ComponentFixture<LoadWizardStopsComponent>;
  let component: LoadWizardStopsComponent;
  let loadsService: jasmine.SpyObj<LoadsService>;
  let fb: FormBuilder;

  beforeEach(async () => {
    loadsService = jasmine.createSpyObj<LoadsService>('LoadsService', [
      'lookupZip',
      'getRouteGeometry',
    ]);
    loadsService.lookupZip.and.returnValue(
      of({ success: true, data: { zip: '10001', city: 'New York', state: 'NY', lat: 40.7, lon: -74.0 } }),
    );
    loadsService.getRouteGeometry.and.returnValue(
      of({ coordinates: [[-74.0, 40.7], [-87.6, 41.9]] as [number, number][] }),
    );

    await TestBed.configureTestingModule({
      imports: [LoadWizardStopsComponent, ReactiveFormsModule],
      providers: [
        FormBuilder,
        { provide: LoadsService, useValue: loadsService },
      ],
    }).compileComponents();

    fb = TestBed.inject(FormBuilder);
    fixture = TestBed.createComponent(LoadWizardStopsComponent);
    component = fixture.componentInstance;
    component.stops = fb.array<FormGroup>([
      buildStop(fb, 'PICKUP', 1),
      buildStop(fb, 'DELIVERY', 2),
    ]);
    component.rate = 1200;
    component.mode = 'create';
    fixture.detectChanges();
  });

  it('renders one row per FormArray entry', () => {
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="stop-row"]');
    expect(rows.length).toBe(2);
  });

  it('addStop appends a DELIVERY FormGroup and renumbers sequences', () => {
    component.addStop();
    expect(component.stops.length).toBe(3);
    expect(component.stops.at(2).get('stop_type')!.value).toBe('DELIVERY');
    component.stops.controls.forEach((c, i) => {
      expect(c.get('sequence')!.value).toBe(i + 1);
    });
  });

  it('removeStop is blocked when it would leave 0 pickups or 0 deliveries', () => {
    component.removeStop(0); // PICKUP — last of its type, should be no-op.
    expect(component.stops.length).toBe(2);
    component.removeStop(1); // DELIVERY — last of its type, also no-op.
    expect(component.stops.length).toBe(2);
  });

  it('removeStop succeeds when a same-type sibling exists', () => {
    component.addStop(); // adds second DELIVERY
    expect(component.stops.length).toBe(3);
    component.removeStop(1); // remove first DELIVERY — second DELIVERY remains.
    expect(component.stops.length).toBe(2);
    const types = component.stops.controls.map((c) => c.get('stop_type')!.value);
    expect(types).toEqual(['PICKUP', 'DELIVERY']);
  });

  it('onZipBlur calls lookupZip and patches city/state on the row', () => {
    const row = component.stops.at(0) as FormGroup;
    row.get('zip')!.setValue('10001');
    component.onZipBlur(row);
    expect(loadsService.lookupZip).toHaveBeenCalledWith('10001');
    expect(row.get('city')!.value).toBe('New York');
    expect(row.get('state')!.value).toBe('NY');
  });

  it('onZipBlur is a no-op in view mode', () => {
    component.mode = 'view';
    const row = component.stops.at(0) as FormGroup;
    row.get('zip')!.setValue('10001');
    component.onZipBlur(row);
    expect(loadsService.lookupZip).not.toHaveBeenCalled();
  });

  it('view mode disables the FormArray so inputs are read-only', () => {
    component.mode = 'view';
    component.ngOnChanges({
      mode: {
        previousValue: 'create',
        currentValue: 'view',
        firstChange: false,
        isFirstChange: () => false,
      },
    });
    expect(component.stops.disabled).toBe(true);
  });

  it('onDrop reorders controls in the FormArray', () => {
    const typesBefore = component.stops.controls.map((c) => c.get('stop_type')!.value);
    expect(typesBefore).toEqual(['PICKUP', 'DELIVERY']);
    component.onDrop({ previousIndex: 0, currentIndex: 1 } as any);
    const typesAfter = component.stops.controls.map((c) => c.get('stop_type')!.value);
    expect(typesAfter).toEqual(['DELIVERY', 'PICKUP']);
  });

  it('recomputes trip metrics after debounce when zips resolve', fakeAsync(() => {
    (component.stops.at(0) as FormGroup).get('zip')!.setValue('10001');
    (component.stops.at(1) as FormGroup).get('zip')!.setValue('60601');
    tick(600); // debounceTime(350) + timer(200) + scheduling slack.
    expect(loadsService.getRouteGeometry).toHaveBeenCalled();
    expect(component.metrics.totalMiles).not.toBeNull();
    expect(component.metrics.totalMiles!).toBeGreaterThan(0);
    expect(component.metrics.ratePerMile).not.toBeNull();
  }));

  it('clears metrics when fewer than 2 zips are present', fakeAsync(() => {
    tick(600);
    expect(component.metrics.totalMiles).toBeNull();
    expect(component.metrics.ratePerMile).toBeNull();
  }));
});
