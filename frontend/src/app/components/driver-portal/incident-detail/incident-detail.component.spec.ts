import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ChangeDetectionStrategy } from '@angular/core';

import { IncidentDetailComponent } from './incident-detail.component';
import { PhotoUploaderComponent } from '../photo-uploader/photo-uploader.component';
import { FeedbackFormComponent } from '../feedback-form/feedback-form.component';
import { ApiService } from '../../../services/api.service';
import { ToastService } from '../../../shared/toast/toast.service';

const MOCK_INCIDENT = {
  id: 'inc-abc-123',
  incident_number: 'INC-ABC123',
  status: 'OPEN',
  issue_type: 'FLAT_TIRE',
  incident_summary: 'Driver reported flat tire on highway.',
  created_at: '2026-06-01T10:00:00.000Z',
  vehicle_unit: 'UNIT-42',
  images: [],
};

describe('IncidentDetailComponent', () => {
  let fixture: ComponentFixture<IncidentDetailComponent>;
  let component: IncidentDetailComponent;
  let apiSpy: jasmine.SpyObj<ApiService>;
  let toastSpy: jasmine.SpyObj<ToastService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    apiSpy = jasmine.createSpyObj('ApiService', ['getSafetyIncidentById', 'updateSafetyIncident', 'uploadIncidentImage']);
    toastSpy = jasmine.createSpyObj('ToastService', ['success', 'error']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    apiSpy.getSafetyIncidentById.and.returnValue(of(MOCK_INCIDENT));

    await TestBed.configureTestingModule({
      declarations: [IncidentDetailComponent, PhotoUploaderComponent, FeedbackFormComponent],
      providers: [
        { provide: ApiService, useValue: apiSpy },
        { provide: ToastService, useValue: toastSpy },
        { provide: Router, useValue: routerSpy },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'inc-abc-123' } } },
        },
      ],
    })
      .overrideComponent(IncidentDetailComponent, { set: { changeDetection: ChangeDetectionStrategy.Default } })
      .overrideComponent(PhotoUploaderComponent, { set: { changeDetection: ChangeDetectionStrategy.Default } })
      .overrideComponent(FeedbackFormComponent, { set: { changeDetection: ChangeDetectionStrategy.Default } })
      .compileComponents();

    fixture = TestBed.createComponent(IncidentDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders incident heading after load', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    const h1 = fixture.nativeElement.querySelector('.header-title');
    expect(h1).toBeTruthy();
    expect(h1.textContent).toContain('INC-ABC123');
  }));

  it('shows status badge with correct label', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.status-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent.trim()).toBe('Open');
  }));

  it('renders photo-uploader as available=false when status is OPEN', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    const uploader = fixture.debugElement.componentInstance;
    expect(component.isClosed).toBeFalse();
  }));

  it('shows feedback form when incident is resolved and no feedback', fakeAsync(() => {
    apiSpy.getSafetyIncidentById.and.returnValue(of({ ...MOCK_INCIDENT, status: 'RESOLVED', driver_feedback: null }));
    component.loadIncident();
    tick();
    fixture.detectChanges();
    expect(component.showFeedbackForm).toBeTrue();
  }));

  it('hides feedback form when driver_feedback already set', fakeAsync(() => {
    apiSpy.getSafetyIncidentById.and.returnValue(of({ ...MOCK_INCIDENT, status: 'CLOSED', driver_feedback: 'Great service!' }));
    component.loadIncident();
    tick();
    fixture.detectChanges();
    expect(component.showFeedbackForm).toBeFalse();
    expect(component.hasFeedback).toBeTrue();
  }));

  it('shows error banner on API failure', fakeAsync(() => {
    apiSpy.getSafetyIncidentById.and.returnValue(throwError(() => ({ error: { error: 'Not found' } })));
    component.loadIncident();
    tick();
    fixture.detectChanges();
    const err = fixture.nativeElement.querySelector('.inline-error');
    expect(err).toBeTruthy();
    expect(err.textContent).toContain('Not found');
  }));

  it('navigates back to driver-portal on goBack()', () => {
    component.goBack();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/driver-portal']);
  });

  it('builds stepper steps for OPEN status with 4 steps', fakeAsync(() => {
    tick();
    fixture.detectChanges();
    expect(component.stepperSteps.length).toBe(4);
    const current = component.stepperSteps.find(s => s.status === 'current');
    expect(current?.key).toBe('OPEN');
  }));

  it('calls loadIncident again after photo upload', fakeAsync(() => {
    tick();
    const callsBefore = apiSpy.getSafetyIncidentById.calls.count();
    component.onPhotoUploaded();
    tick();
    expect(apiSpy.getSafetyIncidentById.calls.count()).toBeGreaterThan(callsBefore);
    expect(toastSpy.success).toHaveBeenCalledWith('Photo uploaded successfully.');
  }));

  it('calls loadIncident again after feedback submitted', fakeAsync(() => {
    tick();
    const callsBefore = apiSpy.getSafetyIncidentById.calls.count();
    component.onFeedbackSubmitted();
    tick();
    expect(apiSpy.getSafetyIncidentById.calls.count()).toBeGreaterThan(callsBefore);
    expect(toastSpy.success).toHaveBeenCalledWith('Feedback submitted. Thank you!');
  }));
});
