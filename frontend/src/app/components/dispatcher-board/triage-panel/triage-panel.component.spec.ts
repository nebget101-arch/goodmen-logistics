/// <reference types="jasmine" />

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ChangeDetectorRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { TriagePanelComponent } from './triage-panel.component';
import { TriageService, TriageRecord } from '../../../services/triage.service';

const MOCK_TRIAGE: TriageRecord = {
  id: 'tr-1',
  incident_id: 'inc-abc',
  severity: 'HIGH',
  category: 'Flat Tyre',
  urgency: 'URGENT',
  vendor_skills: ['Roadside Assistance', 'Tyre Change'],
  rationale: 'Driver reported tyre blowout on I-40. High severity due to freeway location.',
  prompt_version: '1.2.0',
  model_name: 'claude-sonnet-4-6',
  created_at: '2026-06-11T10:00:00Z'
};

describe('TriagePanelComponent', () => {
  let fixture: ComponentFixture<TriagePanelComponent>;
  let component: TriagePanelComponent;
  let triageService: jasmine.SpyObj<TriageService>;

  beforeEach(async () => {
    triageService = jasmine.createSpyObj<TriageService>('TriageService', ['getTriage', 'overrideTriage']);
    triageService.getTriage.and.returnValue(of(MOCK_TRIAGE));

    await TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [TriagePanelComponent],
      providers: [
        { provide: TriageService, useValue: triageService },
        ChangeDetectorRef
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(TriagePanelComponent);
    component = fixture.componentInstance;
    component.incidentId = 'inc-abc';
  });

  it('should render triage data after load', () => {
    fixture.detectChanges();

    expect(triageService.getTriage).toHaveBeenCalledWith('inc-abc');
    expect(component.triage).toEqual(MOCK_TRIAGE);
    expect(component.loading).toBeFalse();
    expect(component.errorMessage).toBe('');
  });

  it('should show error state when getTriage fails', () => {
    triageService.getTriage.and.returnValue(throwError(() => new Error('Network error')));

    fixture.detectChanges();

    expect(component.triage).toBeNull();
    expect(component.loading).toBeFalse();
    expect(component.errorMessage).toBeTruthy();
  });

  it('should open override modal on override button click', () => {
    fixture.detectChanges();

    expect(component.showOverrideModal).toBeFalse();
    component.openOverrideModal();
    expect(component.showOverrideModal).toBeTrue();
  });

  it('should update triage and close modal on overrideComplete', () => {
    fixture.detectChanges();
    component.showOverrideModal = true;

    const updated: TriageRecord = { ...MOCK_TRIAGE, severity: 'CRITICAL', prompt_version: '1.3.0' };
    component.onOverrideComplete(updated);

    expect(component.triage).toEqual(updated);
    expect(component.showOverrideModal).toBeFalse();
  });

  it('should close modal on overrideCancelled', () => {
    component.showOverrideModal = true;
    component.onOverrideCancelled();
    expect(component.showOverrideModal).toBeFalse();
  });

  it('should assign correct severity badge class', () => {
    expect(component.severityClass('CRITICAL')).toContain('badge--critical');
    expect(component.severityClass('HIGH')).toContain('badge--high');
    expect(component.severityClass('MEDIUM')).toContain('badge--medium');
    expect(component.severityClass('LOW')).toContain('badge--low');
  });

  it('should assign correct urgency badge class', () => {
    expect(component.urgencyClass('EMERGENCY')).toContain('badge--critical');
    expect(component.urgencyClass('URGENT')).toContain('badge--high');
    expect(component.urgencyClass('ROUTINE')).toContain('badge--low');
  });
});
