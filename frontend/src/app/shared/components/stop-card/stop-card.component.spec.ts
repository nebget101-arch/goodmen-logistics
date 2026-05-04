/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { StopCardComponent } from './stop-card.component';
import { LoadStop } from '../../../models/load-dashboard.model';

describe('StopCardComponent.normalizeStateCode (FN-1049)', () => {
  let component: StopCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, DragDropModule],
      declarations: [StopCardComponent]
    }).compileComponents();
    component = TestBed.createComponent(StopCardComponent).componentInstance;
  });

  it('returns "" for null / undefined / empty / whitespace input', () => {
    expect(component.normalizeStateCode(null)).toBe('');
    expect(component.normalizeStateCode(undefined)).toBe('');
    expect(component.normalizeStateCode('')).toBe('');
    expect(component.normalizeStateCode('   ')).toBe('');
  });

  it('passes through valid 2-letter codes regardless of case', () => {
    expect(component.normalizeStateCode('CA')).toBe('CA');
    expect(component.normalizeStateCode('ca')).toBe('CA');
    expect(component.normalizeStateCode(' tx ')).toBe('TX');
    expect(component.normalizeStateCode('DC')).toBe('DC');
  });

  it('strips trailing "." and "," before lookup', () => {
    expect(component.normalizeStateCode('Ca.')).toBe('CA');
    expect(component.normalizeStateCode('TX,')).toBe('TX');
    expect(component.normalizeStateCode('California.')).toBe('CA');
  });

  it('maps full state names (case-insensitive) to 2-letter code', () => {
    expect(component.normalizeStateCode('California')).toBe('CA');
    expect(component.normalizeStateCode('texas')).toBe('TX');
    expect(component.normalizeStateCode('NEW YORK')).toBe('NY');
    expect(component.normalizeStateCode('north carolina')).toBe('NC');
    expect(component.normalizeStateCode('District of Columbia')).toBe('DC');
  });

  it('collapses internal whitespace before lookup', () => {
    expect(component.normalizeStateCode('  new   york  ')).toBe('NY');
    expect(component.normalizeStateCode('south  dakota')).toBe('SD');
  });

  it('returns "" for unknown input', () => {
    expect(component.normalizeStateCode('Notastate')).toBe('');
    expect(component.normalizeStateCode('XX')).toBe('');
    expect(component.normalizeStateCode('Californa')).toBe('');
  });
});

describe('StopCardComponent state binding (FN-1049)', () => {
  let fixture: ComponentFixture<StopCardComponent>;
  let component: StopCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, DragDropModule],
      declarations: [StopCardComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(StopCardComponent);
    component = fixture.componentInstance;
  });

  function expanded(stop: LoadStop): void {
    component.stop = stop;
    component.expanded = true;
    fixture.detectChanges();
  }

  it('normalizedState returns the 2-letter code for a full-name stop', () => {
    component.stop = { stop_type: 'PICKUP', state: 'California' };
    expect(component.normalizedState).toBe('CA');
  });

  it('normalizedState passes through an existing 2-letter code', () => {
    component.stop = { stop_type: 'PICKUP', state: 'TX' };
    expect(component.normalizedState).toBe('TX');
  });

  it('normalizedState returns "" when state is unrecognized', () => {
    component.stop = { stop_type: 'PICKUP', state: 'Atlantis' };
    expect(component.normalizedState).toBe('');
  });

  it('cityStateLabel shows the normalized code, not the raw full name', () => {
    component.stop = { stop_type: 'PICKUP', city: 'Los Angeles', state: 'California' };
    expect(component.cityStateLabel).toBe('Los Angeles, CA');
  });

  it('cityStateLabel falls back to the raw value when state is unrecognized', () => {
    component.stop = { stop_type: 'PICKUP', city: 'Atlantis', state: 'Atlantis' };
    expect(component.cityStateLabel).toBe('Atlantis, Atlantis');
  });

  it('renders the State <select> bound to the normalized code', () => {
    expanded({ stop_type: 'PICKUP', state: 'California' });
    const select = fixture.nativeElement.querySelector('.sc-select') as HTMLSelectElement;
    // First .sc-select is stop type; we want the State one — use a more specific query
    const stateSelect = fixture.nativeElement.querySelectorAll('select.sc-select')[1] as HTMLSelectElement;
    expect(stateSelect.value).toBe('CA');
    expect(select).toBeTruthy();
  });

  it('onStateChange emits the stop with a normalized 2-letter code', () => {
    component.stop = { stop_type: 'PICKUP', state: 'California' };
    let emitted: LoadStop | undefined;
    component.stopChange.subscribe((s: LoadStop) => (emitted = s));
    component.onStateChange('texas');
    expect(emitted).toBeTruthy();
    expect(emitted!.state).toBe('TX');
  });

  it('onStateChange emits null state when the dropdown is cleared', () => {
    component.stop = { stop_type: 'PICKUP', state: 'CA' };
    let emitted: LoadStop | undefined;
    component.stopChange.subscribe((s: LoadStop) => (emitted = s));
    component.onStateChange('');
    expect(emitted).toBeTruthy();
    expect(emitted!.state).toBeNull();
  });

  it('onStateChange emits null state when the input is unrecognized', () => {
    component.stop = { stop_type: 'PICKUP', state: 'CA' };
    let emitted: LoadStop | undefined;
    component.stopChange.subscribe((s: LoadStop) => (emitted = s));
    component.onStateChange('Atlantis');
    expect(emitted).toBeTruthy();
    expect(emitted!.state).toBeNull();
  });
});
