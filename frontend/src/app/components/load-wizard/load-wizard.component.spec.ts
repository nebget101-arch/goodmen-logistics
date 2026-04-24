/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { LoadWizardComponent } from './load-wizard.component';
import { LoadsService } from '../../services/loads.service';
import { LoadAiEndpointExtraction, LoadDetail } from '../../models/load-dashboard.model';

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
      'getBrokers',
      'createBroker',
      'getActiveDrivers',
      'getEquipment',
      // FN-881: attachments step immediate-upload + delete paths.
      'uploadAttachmentWithProgress',
      'deleteAttachment',
      // FN-888: ai-extract Step 0 calls the backend extractor.
      'aiExtractFromPdf',
    ]);
    // FN-875: Step 1 basics sub-component eagerly fetches brokers on init.
    loadsService.getBrokers.and.returnValue(of({ success: true, data: [] }));
    // FN-879: Step 3 driver-equipment sub-component eagerly fetches drivers/equipment.
    loadsService.getActiveDrivers.and.returnValue(of([]));
    loadsService.getEquipment.and.returnValue(of({ success: true, data: [] }));

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

    it('driver step requires driver + truck selection (FN-879)', () => {
      component.currentStepId = 'driver';
      fixture.detectChanges(); // mounts the child so Validators.required attach
      expect(component.canProceed).toBe(false);

      component.driverEquipment.get('driverId')!.setValue('driver-1');
      component.driverEquipment.get('truckId')!.setValue('truck-1');
      expect(component.canProceed).toBe(true);
    });

    it('driver step stays valid without a trailer (optional, FN-879)', () => {
      component.currentStepId = 'driver';
      fixture.detectChanges();
      component.driverEquipment.get('driverId')!.setValue('driver-1');
      component.driverEquipment.get('truckId')!.setValue('truck-1');
      // Trailer deliberately null — canProceed must still be true.
      expect(component.driverEquipment.get('trailerId')!.value).toBeNull();
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

  describe('FN-888 AI-Extract flow', () => {
    const mockExtraction: LoadAiEndpointExtraction = {
      brokerName: 'ACME Logistics',
      poNumber: 'PO-4242',
      loadId: 'EXT-9001',
      rate: 2500,
      pickup: {
        date: '2026-05-01',
        city: 'Chicago',
        state: 'IL',
        zip: '60601',
        address1: '100 S Wacker Dr',
      },
      delivery: {
        date: '2026-05-03',
        city: 'Dallas',
        state: 'TX',
        zip: '75201',
        address1: '500 N Akard St',
      },
      notes: null,
      fieldConfidences: {
        brokerName: 0.55,  // red — "Needs review"
        poNumber: 0.92,    // none (hidden)
        rate: 0.72,        // amber — "Verify"
        loadNumber: 0.5,
        'stops[0].city': 0.4,
        'stops[1].date': 0.78,
      },
    };

    const makePdf = (name = 'rate-con.pdf') =>
      new File([new Blob(['pdf'])], name, { type: 'application/pdf' });

    beforeEach(() => {
      component.mode = 'ai-extract';
      loadsService.createLoad.and.returnValue(of({ success: true, data: mockCreatedLoad }));
      loadsService.uploadAttachment.and.returnValue(
        of({ success: true, data: { id: 'att-1' } as any }),
      );
    });

    it('showExtractStep is true until extraction completes in ai-extract mode', () => {
      expect(component.showExtractStep).toBe(true);
      component.extractionComplete = true;
      expect(component.showExtractStep).toBe(false);
    });

    it('showExtractStep is false in create/edit/view modes', () => {
      component.mode = 'create';
      expect(component.showExtractStep).toBe(false);
      component.mode = 'edit';
      expect(component.showExtractStep).toBe(false);
      component.mode = 'view';
      expect(component.showExtractStep).toBe(false);
    });

    it('rejects non-PDF files with an inline error (does not call the service)', () => {
      const txt = new File([new Blob(['hi'])], 'readme.txt', { type: 'text/plain' });
      component.onPdfSelected(txt);
      expect(loadsService.aiExtractFromPdf).not.toHaveBeenCalled();
      expect(component.extractionError).toContain('PDF');
      expect(component.sourcePdfFile).toBeNull();
    });

    it('extracts, prefills Basics + Stops, sets field confidences, advances to Step 1', () => {
      loadsService.aiExtractFromPdf.and.returnValue(
        of({ success: true, data: mockExtraction }),
      );

      component.onPdfSelected(makePdf());

      expect(loadsService.aiExtractFromPdf).toHaveBeenCalledTimes(1);
      expect(component.extractionComplete).toBe(true);
      expect(component.extracting).toBe(false);
      expect(component.currentStepId).toBe('basics');
      expect(component.showExtractStep).toBe(false);

      expect(component.basics.get('loadNumber')!.value).toBe('EXT-9001');
      expect(component.basics.get('poNumber')!.value).toBe('PO-4242');
      expect(component.basics.get('rate')!.value).toBe(2500);

      expect(component.aiBrokerNameHint).toBe('ACME Logistics');

      expect(component.stops.length).toBe(2);
      expect(component.stops.at(0).get('stop_type')!.value).toBe('PICKUP');
      expect(component.stops.at(0).get('city')!.value).toBe('Chicago');
      expect(component.stops.at(0).get('zip')!.value).toBe('60601');
      expect(component.stops.at(1).get('stop_type')!.value).toBe('DELIVERY');
      expect(component.stops.at(1).get('city')!.value).toBe('Dallas');
      expect(component.stops.at(1).get('stop_date')!.value).toBe('2026-05-03');

      expect(component.fieldConfidences['brokerName']).toBe(0.55);
      expect(component.fieldConfidences['rate']).toBe(0.72);
      expect(component.fieldConfidences['stops[0].city']).toBe(0.4);
    });

    it('uses explicit stops[] over top-level pickup/delivery when provided', () => {
      const data: LoadAiEndpointExtraction = {
        ...mockExtraction,
        stops: [
          { type: 'PICKUP',   sequence: 1, date: '2026-06-01', city: 'Atlanta', state: 'GA', zip: '30301', address1: null },
          { type: 'PICKUP',   sequence: 2, date: '2026-06-02', city: 'Nashville', state: 'TN', zip: '37201', address1: null },
          { type: 'DELIVERY', sequence: 3, date: '2026-06-03', city: 'St. Louis', state: 'MO', zip: '63101', address1: null },
        ],
      };
      loadsService.aiExtractFromPdf.and.returnValue(of({ success: true, data }));

      component.onPdfSelected(makePdf());

      expect(component.stops.length).toBe(3);
      expect(component.stops.at(0).get('city')!.value).toBe('Atlanta');
      expect(component.stops.at(1).get('city')!.value).toBe('Nashville');
      expect(component.stops.at(2).get('city')!.value).toBe('St. Louis');
      expect(component.stops.at(2).get('stop_type')!.value).toBe('DELIVERY');
    });

    it('surfaces extraction error with retry and preserves the selected PDF for retry', () => {
      loadsService.aiExtractFromPdf.and.returnValue(
        throwError(() => ({ error: { warning: 'OCR timed out' } })),
      );

      const file = makePdf();
      component.onPdfSelected(file);

      expect(component.extractionComplete).toBe(false);
      expect(component.extracting).toBe(false);
      expect(component.extractionError).toBe('OCR timed out');
      expect(component.sourcePdfFile).toBe(file);
      expect(component.showExtractStep).toBe(true);
      expect(loadsService.aiExtractFromPdf).toHaveBeenCalledTimes(1);

      // Retry with the same file succeeds the second time.
      loadsService.aiExtractFromPdf.and.returnValue(
        of({ success: true, data: mockExtraction }),
      );
      component.onExtractionRetry();

      expect(loadsService.aiExtractFromPdf).toHaveBeenCalledTimes(2);
      expect(component.extractionComplete).toBe(true);
      expect(component.extractionError).toBe('');
    });

    it('onPdfClear drops the selected file so the user can pick a different one', () => {
      loadsService.aiExtractFromPdf.and.returnValue(
        throwError(() => new Error('boom')),
      );
      component.onPdfSelected(makePdf('bad.pdf'));
      expect(component.sourcePdfFile).toBeTruthy();

      component.onPdfClear();
      expect(component.sourcePdfFile).toBeNull();
      expect(component.extractionError).toBe('');
    });

    it('submitCreate auto-queues the source PDF as RATE_CONFIRMATION in ai-extract mode', () => {
      loadsService.aiExtractFromPdf.and.returnValue(
        of({ success: true, data: mockExtraction }),
      );
      const pdf = makePdf('rc.pdf');
      component.onPdfSelected(pdf);

      // Walk to the final step and submit.
      component.currentStepId = 'attachments';
      component.driverEquipment.get('driverId')!.setValue('driver-1');
      component.driverEquipment.get('truckId')!.setValue('truck-1');

      const createdSpy = jasmine.createSpy('created');
      component.created.subscribe(createdSpy);
      component.onSubmit();

      expect(loadsService.createLoad).toHaveBeenCalledTimes(1);
      expect(loadsService.uploadAttachment).toHaveBeenCalledTimes(1);
      const args = loadsService.uploadAttachment.calls.mostRecent().args;
      expect(args[1]).toBe(pdf);
      expect(args[2]).toBe('RATE_CONFIRMATION');
      expect(createdSpy).toHaveBeenCalledWith(mockCreatedLoad);
    });

    it('submitCreate does not double-queue the PDF if the user already attached the same file', () => {
      loadsService.aiExtractFromPdf.and.returnValue(
        of({ success: true, data: mockExtraction }),
      );
      const pdf = makePdf('rc.pdf');
      component.onPdfSelected(pdf);

      // User manually attached the same file on Step 4.
      component.queueAttachment(pdf, 'RATE_CONFIRMATION');
      component.currentStepId = 'attachments';
      component.driverEquipment.get('driverId')!.setValue('driver-1');
      component.driverEquipment.get('truckId')!.setValue('truck-1');

      component.onSubmit();

      expect(loadsService.uploadAttachment).toHaveBeenCalledTimes(1);
    });
  });
});
