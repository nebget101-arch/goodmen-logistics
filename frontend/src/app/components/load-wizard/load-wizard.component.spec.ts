/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { LoadWizardComponent } from './load-wizard.component';
import { LoadsService } from '../../services/loads.service';
import { LoadDetail } from '../../models/load-dashboard.model';

const makeFile = (name = 'rc.pdf'): File =>
  new File([new Blob([''])], name, { type: 'application/pdf' });

const mockCreatedLoad: LoadDetail = {
  id: 'load-123',
  load_number: 'L-0001',
  status: 'DRAFT',
  billing_status: 'PENDING',
  rate: 1200,
  completed_date: null,
  pickup_city: null,
  pickup_state: null,
  delivery_city: null,
  delivery_state: null,
  driver_name: null,
  broker_name: null,
  attachment_count: 0,
  attachment_types: [],
  stops: [],
  attachments: [],
};

describe('LoadWizardComponent (FN-862)', () => {
  let fixture: ComponentFixture<LoadWizardComponent>;
  let component: LoadWizardComponent;
  let loadsService: jasmine.SpyObj<LoadsService>;

  beforeEach(async () => {
    loadsService = jasmine.createSpyObj<LoadsService>('LoadsService', [
      'createLoad',
      'uploadAttachment',
    ]);

    await TestBed.configureTestingModule({
      imports: [LoadWizardComponent, ReactiveFormsModule],
      providers: [{ provide: LoadsService, useValue: loadsService }],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadWizardComponent);
    component = fixture.componentInstance;
    component.mode = 'create';
    fixture.detectChanges();
  });

  it('builds the nested FormGroup with defaults for 2 stops', () => {
    expect(component.form).toBeTruthy();
    expect(component.basics.get('status')!.value).toBe('DRAFT');
    expect(component.basics.get('billingStatus')!.value).toBe('PENDING');
    expect(component.stops.length).toBe(2);
    expect(component.stops.at(0).get('stop_type')!.value).toBe('PICKUP');
    expect(component.stops.at(1).get('stop_type')!.value).toBe('DELIVERY');
    expect(component.driverEquipment).toBeTruthy();
    expect(component.queuedAttachments.length).toBe(0);
  });

  describe('canProceed gating', () => {
    it('basics is valid when required fields are filled', () => {
      component.currentStepId = 'basics';
      expect(component.canProceed).toBe(true);
    });

    it('basics blocks progression when rate is cleared (required)', () => {
      component.currentStepId = 'basics';
      component.basics.get('rate')!.setValue(null);
      expect(component.canProceed).toBe(false);
    });

    it('stops requires at least 2 entries', () => {
      component.currentStepId = 'stops';
      expect(component.stops.length).toBe(2);
      expect(component.canProceed).toBe(true);

      component.stops.removeAt(1);
      expect(component.canProceed).toBe(false);
    });

    it('driver step is always reachable (no required fields)', () => {
      component.currentStepId = 'driver';
      expect(component.canProceed).toBe(true);
    });

    it('attachments step is valid by default and blocks while submitting', () => {
      component.currentStepId = 'attachments';
      expect(component.canProceed).toBe(true);
      component.submitting = true;
      expect(component.canProceed).toBe(false);
    });
  });

  describe('step navigation', () => {
    it('onNext advances when canProceed is true', () => {
      component.currentStepId = 'basics';
      component.onNext();
      expect(component.currentStepId).toBe('stops');
    });

    it('onNext is a no-op when canProceed is false', () => {
      component.currentStepId = 'basics';
      component.basics.get('rate')!.setValue(null);
      component.onNext();
      expect(component.currentStepId).toBe('basics');
    });

    it('onBack moves to the previous step', () => {
      component.currentStepId = 'driver';
      component.onBack();
      expect(component.currentStepId).toBe('stops');
    });

    it('onStepChange accepts valid step ids only', () => {
      component.onStepChange('attachments');
      expect(component.currentStepId).toBe('attachments');
      component.onStepChange('nonsense');
      expect(component.currentStepId).toBe('attachments');
    });
  });

  describe('create-mode submit', () => {
    beforeEach(() => {
      component.mode = 'create';
      component.currentStepId = 'attachments';
    });

    it('calls createLoad with payload built from the form then emits created', () => {
      loadsService.createLoad.and.returnValue(of({ success: true, data: mockCreatedLoad }));
      const createdSpy = jasmine.createSpy('created');
      component.created.subscribe(createdSpy);

      component.onSubmit();

      expect(loadsService.createLoad).toHaveBeenCalledTimes(1);
      const payload = loadsService.createLoad.calls.mostRecent().args[0];
      expect(payload.status).toBe('DRAFT');
      expect(payload.billingStatus).toBe('PENDING');
      expect(Array.isArray(payload.stops)).toBe(true);
      expect(payload.stops.length).toBe(2);
      expect(payload.stops[0].sequence).toBe(1);

      expect(createdSpy).toHaveBeenCalledWith(mockCreatedLoad);
      expect(component.submitting).toBe(false);
      expect(component.errorMessage).toBe('');
    });

    it('uploads queued attachments after createLoad succeeds', () => {
      loadsService.createLoad.and.returnValue(of({ success: true, data: mockCreatedLoad }));
      loadsService.uploadAttachment.and.returnValue(
        of({ success: true, data: { id: 'att-1' } as any }),
      );
      component.queueAttachment(makeFile('a.pdf'), 'RATE_CONFIRMATION');
      component.queueAttachment(makeFile('b.pdf'), 'BOL');

      const createdSpy = jasmine.createSpy('created');
      component.created.subscribe(createdSpy);
      component.onSubmit();

      expect(loadsService.uploadAttachment).toHaveBeenCalledTimes(2);
      expect(loadsService.uploadAttachment.calls.allArgs().map((a) => a[2])).toEqual([
        'RATE_CONFIRMATION',
        'BOL',
      ]);
      expect(createdSpy).toHaveBeenCalled();
      expect(component.errorMessage).toBe('');
    });

    it('surfaces inline error on createLoad failure and preserves form state', () => {
      loadsService.createLoad.and.returnValue(
        throwError(() => ({ error: { error: 'Server exploded' } })),
      );
      component.basics.get('rate')!.setValue(7500);
      component.basics.get('poNumber')!.setValue('PO-9');
      const createdSpy = jasmine.createSpy('created');
      component.created.subscribe(createdSpy);

      component.onSubmit();

      expect(component.submitting).toBe(false);
      expect(component.errorMessage).toBe('Server exploded');
      expect(createdSpy).not.toHaveBeenCalled();
      expect(component.basics.get('rate')!.value).toBe(7500);
      expect(component.basics.get('poNumber')!.value).toBe('PO-9');
      expect(component.stops.length).toBe(2);
    });

    it('reports partial attachment failure but still emits created', () => {
      loadsService.createLoad.and.returnValue(of({ success: true, data: mockCreatedLoad }));
      loadsService.uploadAttachment.and.returnValues(
        of({ success: true, data: { id: 'att-1' } as any }),
        throwError(() => new Error('upload failed')),
      );
      component.queueAttachment(makeFile('a.pdf'), 'RATE_CONFIRMATION');
      component.queueAttachment(makeFile('b.pdf'), 'BOL');

      const createdSpy = jasmine.createSpy('created');
      component.created.subscribe(createdSpy);
      component.onSubmit();

      expect(createdSpy).toHaveBeenCalledWith(mockCreatedLoad);
      expect(component.errorMessage).toContain('1 attachment upload(s) failed');
    });
  });

  it('emits closed when onClose is called', () => {
    const spy = jasmine.createSpy('closed');
    component.closed.subscribe(spy);
    component.onClose();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('maps ai-extract mode to create in shell mode', () => {
    component.mode = 'ai-extract';
    expect(component.shellMode).toBe('create');
    component.mode = 'view';
    expect(component.shellMode).toBe('view');
    component.mode = 'edit';
    expect(component.shellMode).toBe('edit');
  });
});
