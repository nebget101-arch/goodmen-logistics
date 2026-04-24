/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { LoadWizardComponent } from './load-wizard.component';
import { LoadsService } from '../../services/loads.service';
import { AccessControlService } from '../../services/access-control.service';
import { LoadAttachment, LoadDetail, LoadStop } from '../../models/load-dashboard.model';

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

// FN-867: a fully-populated LoadDetail used for edit-mode prefill tests.
const mockEditLoad: LoadDetail = {
  id: 'load-edit-1',
  load_number: 'LD-250101-AAAA',
  status: 'NEW',
  billing_status: 'PENDING',
  rate: 3400,
  completed_date: null,
  pickup_city: 'Dallas',
  pickup_state: 'TX',
  delivery_city: 'Atlanta',
  delivery_state: 'GA',
  driver_name: 'Jane Driver',
  broker_name: 'Acme Logistics',
  attachment_count: 2,
  attachment_types: ['RATE_CONFIRMATION', 'BOL'],
  po_number: 'PO-987',
  notes: 'Handle with care.',
  driver_id: 'driver-42',
  truck_id: 'truck-7',
  trailer_id: 'trailer-9',
  broker_id: 'broker-abc',
  dispatcher_user_id: 'dispatcher-1',
  stops: [
    {
      id: 'stop-1',
      stop_type: 'PICKUP',
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
      sequence: 1,
      stop_date: '2026-05-01',
      stop_time: '09:00',
      facility_name: 'Warehouse A',
    } as LoadStop,
    {
      id: 'stop-2',
      stop_type: 'DELIVERY',
      city: 'Atlanta',
      state: 'GA',
      zip: '30301',
      sequence: 2,
      stop_date: '2026-05-03',
      stop_time: '14:00',
      facility_name: 'Store 5',
    } as LoadStop,
  ],
  attachments: [
    {
      id: 'att-rc',
      load_id: 'load-edit-1',
      type: 'RATE_CONFIRMATION',
      file_name: 'ratecon.pdf',
      file_url: '/uploads/loads/load-edit-1/ratecon.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
      created_at: '2026-04-20T12:00:00Z',
    } as LoadAttachment,
    {
      id: 'att-bol',
      load_id: 'load-edit-1',
      type: 'BOL',
      file_name: 'bol.pdf',
      file_url: '/uploads/loads/load-edit-1/bol.pdf',
      mime_type: 'application/pdf',
      size_bytes: 2048,
      created_at: '2026-04-20T12:05:00Z',
    } as LoadAttachment,
  ],
};

describe('LoadWizardComponent (FN-862)', () => {
  let fixture: ComponentFixture<LoadWizardComponent>;
  let component: LoadWizardComponent;
  let loadsService: jasmine.SpyObj<LoadsService>;
  let access: jasmine.SpyObj<AccessControlService>;

  beforeEach(async () => {
    loadsService = jasmine.createSpyObj<LoadsService>('LoadsService', [
      'createLoad',
      'updateLoad',
      'getLoad',
      'uploadAttachment',
      'getBrokers',
      'createBroker',
      'getActiveDrivers',
      'getEquipment',
      // FN-881: attachments step immediate-upload + delete paths.
      'uploadAttachmentWithProgress',
      'deleteAttachment',
    ]);
    // FN-875: Step 1 basics sub-component eagerly fetches brokers on init.
    loadsService.getBrokers.and.returnValue(of({ success: true, data: [] }));
    // FN-879: Step 3 driver-equipment sub-component eagerly fetches drivers/equipment.
    loadsService.getActiveDrivers.and.returnValue(of([]));
    loadsService.getEquipment.and.returnValue(of({ success: true, data: [] }));

    // FN-885: AccessControlService drives the Edit button permission gate.
    access = jasmine.createSpyObj<AccessControlService>('AccessControlService', [
      'hasPermission',
    ]);
    access.hasPermission.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [LoadWizardComponent, ReactiveFormsModule],
      providers: [
        { provide: LoadsService, useValue: loadsService },
        { provide: AccessControlService, useValue: access },
      ],
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

  // ─── FN-867 / S7: Edit-mode prefill + updateLoad submit ────────────────
  describe('edit-mode prefill (FN-867)', () => {
    /** Build a fresh component instance in edit mode with the given hooks. */
    const buildEditComponent = (opts: {
      preload?: LoadDetail | null;
      getLoadResponse?: any;
    } = {}): { fx: ComponentFixture<LoadWizardComponent>; cmp: LoadWizardComponent } => {
      loadsService.getLoad.and.returnValue(
        opts.getLoadResponse ?? of({ success: true, data: mockEditLoad }),
      );
      const fx = TestBed.createComponent(LoadWizardComponent);
      const cmp = fx.componentInstance;
      cmp.mode = 'edit';
      cmp.loadId = 'load-edit-1';
      if (opts.preload !== undefined) cmp.loadDetail = opts.preload;
      fx.detectChanges();
      return { fx, cmp };
    };

    it('calls getLoad and prefills all four steps from the response', () => {
      const { cmp } = buildEditComponent();

      expect(loadsService.getLoad).toHaveBeenCalledOnceWith('load-edit-1');
      expect(cmp.basics.get('loadNumber')!.value).toBe('LD-250101-AAAA');
      expect(cmp.basics.get('status')!.value).toBe('NEW');
      expect(cmp.basics.get('billingStatus')!.value).toBe('PENDING');
      expect(cmp.basics.get('rate')!.value).toBe(3400);
      expect(cmp.basics.get('brokerId')!.value).toBe('broker-abc');
      expect(cmp.basics.get('poNumber')!.value).toBe('PO-987');
      expect(cmp.basics.get('dispatcherId')!.value).toBe('dispatcher-1');
      expect(cmp.basics.get('notes')!.value).toBe('Handle with care.');

      expect(cmp.stops.length).toBe(2);
      expect(cmp.stops.at(0).get('stop_type')!.value).toBe('PICKUP');
      expect(cmp.stops.at(0).get('city')!.value).toBe('Dallas');
      expect(cmp.stops.at(0).get('zip')!.value).toBe('75201');
      expect(cmp.stops.at(0).get('id')!.value).toBe('stop-1');
      expect(cmp.stops.at(1).get('stop_type')!.value).toBe('DELIVERY');
      expect(cmp.stops.at(1).get('city')!.value).toBe('Atlanta');
      expect(cmp.stops.at(1).get('id')!.value).toBe('stop-2');

      expect(cmp.driverEquipment.get('driverId')!.value).toBe('driver-42');
      expect(cmp.driverEquipment.get('truckId')!.value).toBe('truck-7');
      expect(cmp.driverEquipment.get('trailerId')!.value).toBe('trailer-9');
      expect(cmp.driverEquipment.get('showAllTrucks')!.value).toBe(true);

      expect(cmp.existingAttachments.length).toBe(2);
      expect(cmp.sourcePdfUrl).toBeTruthy(); // RATE_CONFIRMATION attachment present
    });

    it('skips getLoad when loadDetail is preloaded with the matching id', () => {
      const { cmp } = buildEditComponent({ preload: mockEditLoad });

      expect(loadsService.getLoad).not.toHaveBeenCalled();
      expect(cmp.basics.get('loadNumber')!.value).toBe('LD-250101-AAAA');
      expect(cmp.stops.length).toBe(2);
    });

    it('falls back to fetching when the preloaded detail is for a different load', () => {
      const other: LoadDetail = { ...mockEditLoad, id: 'load-other' };
      buildEditComponent({ preload: other });
      expect(loadsService.getLoad).toHaveBeenCalledOnceWith('load-edit-1');
    });

    it('surfaces an error when getLoad fails', () => {
      const { cmp } = buildEditComponent({
        getLoadResponse: throwError(() => ({ error: { error: 'Not found' } })),
      });
      expect(cmp.errorMessage).toBe('Not found');
      expect(cmp.loading).toBe(false);
    });

    it('does not set sourcePdfUrl when no RATE_CONFIRMATION attachment exists', () => {
      const detail: LoadDetail = {
        ...mockEditLoad,
        attachments: [mockEditLoad.attachments[1]], // only BOL
      };
      const { cmp } = buildEditComponent({ preload: detail });
      expect(cmp.sourcePdfUrl).toBeNull();
    });

    it('refreshes sourcePdfUrl when a new RATE_CONFIRMATION is uploaded in edit mode', () => {
      const detail: LoadDetail = { ...mockEditLoad, attachments: [] };
      const { cmp } = buildEditComponent({ preload: detail });
      expect(cmp.sourcePdfUrl).toBeNull();

      cmp.onAttachmentUploaded({
        id: 'att-new',
        load_id: 'load-edit-1',
        type: 'RATE_CONFIRMATION',
        file_name: 'new-rc.pdf',
        file_url: '/uploads/loads/load-edit-1/new-rc.pdf',
        created_at: '2026-04-23T12:00:00Z',
      } as LoadAttachment);

      expect(cmp.sourcePdfUrl).toBeTruthy();
    });

    it('clears sourcePdfUrl when the source RATE_CONFIRMATION is deleted', () => {
      const { cmp } = buildEditComponent();
      expect(cmp.sourcePdfUrl).toBeTruthy();

      cmp.onExistingDeleted('att-rc');

      expect(cmp.sourcePdfUrl).toBeNull();
    });

    it('showSourcePdf is only true on the attachments step with a PDF present', () => {
      const { cmp } = buildEditComponent();
      cmp.currentStepId = 'basics';
      expect(cmp.showSourcePdf).toBe(false);
      cmp.currentStepId = 'attachments';
      expect(cmp.showSourcePdf).toBe(true);
    });
  });

  // ─── FN-867 / S7: updateLoad submit ────────────────────────────────────
  describe('edit-mode submit (FN-867)', () => {
    beforeEach(() => {
      loadsService.getLoad.and.returnValue(of({ success: true, data: mockEditLoad }));
      fixture = TestBed.createComponent(LoadWizardComponent);
      component = fixture.componentInstance;
      component.mode = 'edit';
      component.loadId = 'load-edit-1';
      component.loadDetail = mockEditLoad;
      fixture.detectChanges();
      component.currentStepId = 'attachments';
    });

    it('calls updateLoad with a payload that preserves stop ids and sequence', () => {
      loadsService.updateLoad.and.returnValue(of({ success: true, data: mockEditLoad }));
      const updatedSpy = jasmine.createSpy('updated');
      component.updated.subscribe(updatedSpy);

      component.onSubmit();

      expect(loadsService.updateLoad).toHaveBeenCalledOnceWith(
        'load-edit-1',
        jasmine.any(Object),
      );
      const [passedId, payload] = loadsService.updateLoad.calls.mostRecent().args;
      expect(passedId).toBe('load-edit-1');
      expect(payload.status).toBe('NEW');
      expect(payload.rate).toBe(3400);
      expect(payload.driverId).toBe('driver-42');
      expect(Array.isArray(payload.stops)).toBe(true);
      expect(payload.stops.length).toBe(2);
      expect(payload.stops[0].id).toBe('stop-1');
      expect(payload.stops[0].sequence).toBe(1);
      expect(payload.stops[1].id).toBe('stop-2');
      expect(payload.stops[1].sequence).toBe(2);

      expect(updatedSpy).toHaveBeenCalledWith(mockEditLoad);
      expect(component.submitting).toBe(false);
    });

    it('does not call createLoad in edit mode', () => {
      loadsService.updateLoad.and.returnValue(of({ success: true, data: mockEditLoad }));
      component.onSubmit();
      expect(loadsService.createLoad).not.toHaveBeenCalled();
    });

    it('surfaces inline error on updateLoad failure and preserves form state', () => {
      loadsService.updateLoad.and.returnValue(
        throwError(() => ({ error: { error: 'Update rejected' } })),
      );
      const updatedSpy = jasmine.createSpy('updated');
      component.updated.subscribe(updatedSpy);

      component.onSubmit();

      expect(component.submitting).toBe(false);
      expect(component.errorMessage).toBe('Update rejected');
      expect(updatedSpy).not.toHaveBeenCalled();
      // Form state still intact
      expect(component.basics.get('rate')!.value).toBe(3400);
      expect(component.stops.length).toBe(2);
    });

    it('onTimelineStopClick does not throw when the target row is missing from the DOM', () => {
      // The Stops step isn't mounted here (we're on attachments), so no row
      // with the data-attribute exists. The handler must be a safe no-op.
      expect(() => component.onTimelineStopClick(0)).not.toThrow();
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

  describe('view mode (FN-868 / FN-885)', () => {
    const mockLoad: LoadDetail = {
      id: 'load-view-1',
      load_number: 'L-VIEW-1',
      status: 'DISPATCHED',
      billing_status: 'PENDING',
      rate: 2500,
      completed_date: null,
      pickup_city: 'Chicago',
      pickup_state: 'IL',
      delivery_city: 'Dallas',
      delivery_state: 'TX',
      driver_name: 'Jane Doe',
      broker_name: 'Acme Brokers',
      attachment_count: 1,
      attachment_types: ['BOL'],
      po_number: 'PO-42',
      notes: 'Read-only test',
      broker_id: 'broker-1',
      dispatcher_user_id: 'disp-1',
      driver_id: 'driver-1',
      truck_id: 'truck-1',
      trailer_id: 'trailer-1',
      stops: [
        { stop_type: 'PICKUP',   city: 'Chicago', state: 'IL', zip: '60601', sequence: 1 },
        { stop_type: 'DELIVERY', city: 'Dallas',  state: 'TX', zip: '75201', sequence: 2 },
      ],
      attachments: [
        {
          id: 'att-1',
          load_id: 'load-view-1',
          type: 'BOL',
          file_name: 'bol.pdf',
          file_url: 'https://example.com/bol.pdf',
          mime_type: 'application/pdf',
          size_bytes: 1024,
          created_at: '2026-04-20T00:00:00Z',
        },
      ],
    };

    function initViewMode(): void {
      loadsService.getLoad.and.returnValue(of({ success: true, data: mockLoad }));
      fixture = TestBed.createComponent(LoadWizardComponent);
      component = fixture.componentInstance;
      component.mode = 'view';
      component.loadId = 'load-view-1';
      fixture.detectChanges();
    }

    it('calls getLoad and disables every step FormGroup', () => {
      initViewMode();

      expect(loadsService.getLoad).toHaveBeenCalledWith('load-view-1');
      expect(component.basics.disabled).toBe(true);
      expect(component.stops.disabled).toBe(true);
      expect(component.driverEquipment.disabled).toBe(true);
      expect(component.form.disabled).toBe(true);
    });

    it('prefills basics/stops/driverEquipment/existingAttachments from the load detail', () => {
      initViewMode();

      expect(component.basics.get('loadNumber')!.value).toBe('L-VIEW-1');
      expect(component.basics.get('status')!.value).toBe('DISPATCHED');
      expect(component.basics.get('brokerId')!.value).toBe('broker-1');
      expect(component.basics.get('rate')!.value).toBe(2500);
      expect(component.basics.get('dispatcherId')!.value).toBe('disp-1');
      expect(component.basics.get('poNumber')!.value).toBe('PO-42');

      expect(component.stops.length).toBe(2);
      expect(component.stops.at(0).get('zip')!.value).toBe('60601');
      expect(component.stops.at(1).get('zip')!.value).toBe('75201');

      expect(component.driverEquipment.get('driverId')!.value).toBe('driver-1');
      expect(component.driverEquipment.get('truckId')!.value).toBe('truck-1');
      expect(component.driverEquipment.get('trailerId')!.value).toBe('trailer-1');

      expect(component.existingAttachments.length).toBe(1);
      expect(component.existingAttachments[0].id).toBe('att-1');
    });

    it('renders the Edit button when canEdit is true and flips mode to edit on click', () => {
      access.hasPermission.and.returnValue(true);
      initViewMode();

      const editBtn = fixture.nativeElement.querySelector(
        '[data-testid="load-wizard-edit"]',
      ) as HTMLButtonElement;
      expect(editBtn).toBeTruthy();

      editBtn.click();
      fixture.detectChanges();

      expect(component.mode).toBe('edit');
      expect(component.shellMode).toBe('edit');
      const editBtnAfter = fixture.nativeElement.querySelector(
        '[data-testid="load-wizard-edit"]',
      );
      expect(editBtnAfter).toBeNull();
    });

    it('preserves the current step when flipping from view → edit', () => {
      access.hasPermission.and.returnValue(true);
      initViewMode();

      component.currentStepId = 'driver';
      fixture.detectChanges();

      component.onEditClick();
      expect(component.mode).toBe('edit');
      expect(component.currentStepId).toBe('driver');
    });

    it('hides the Edit button when the user lacks loads.edit permission', () => {
      access.hasPermission.and.returnValue(false);
      initViewMode();

      const editBtn = fixture.nativeElement.querySelector(
        '[data-testid="load-wizard-edit"]',
      );
      expect(editBtn).toBeNull();
      component.onEditClick();
      expect(component.mode).toBe('view');
    });

    it('re-enables step FormGroups after flipping to edit mode', () => {
      access.hasPermission.and.returnValue(true);
      initViewMode();
      expect(component.basics.disabled).toBe(true);

      component.onEditClick();
      fixture.detectChanges();

      expect(component.basics.enabled).toBe(true);
      expect(component.stops.enabled).toBe(true);
      expect(component.driverEquipment.enabled).toBe(true);
    });
  });
});
