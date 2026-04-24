/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { LoadWizardBasicsComponent } from './basics.component';
import { LoadsService, BrokerOption } from '../../../../services/loads.service';

const buildBasicsGroup = (fb: FormBuilder): FormGroup =>
  fb.group({
    loadNumber:    [''],
    status:        ['DRAFT',   Validators.required],
    billingStatus: ['PENDING', Validators.required],
    brokerId:      [null as string | null],
    poNumber:      [''],
    rate:          [0, Validators.required],
    dispatcherId:  [null as string | null],
    notes:         [''],
  });

describe('LoadWizardBasicsComponent (FN-875)', () => {
  let fixture: ComponentFixture<LoadWizardBasicsComponent>;
  let component: LoadWizardBasicsComponent;
  let loadsService: jasmine.SpyObj<LoadsService>;
  let basics: FormGroup;

  beforeEach(async () => {
    loadsService = jasmine.createSpyObj<LoadsService>('LoadsService', [
      'getBrokers',
      'createBroker',
    ]);
    loadsService.getBrokers.and.returnValue(of({ success: true, data: [] }));

    await TestBed.configureTestingModule({
      imports: [LoadWizardBasicsComponent, ReactiveFormsModule],
      providers: [{ provide: LoadsService, useValue: loadsService }],
    }).compileComponents();

    const fb = TestBed.inject(FormBuilder);
    basics = buildBasicsGroup(fb);

    fixture = TestBed.createComponent(LoadWizardBasicsComponent);
    component = fixture.componentInstance;
    component.basics = basics;
    component.mode = 'create';
    fixture.detectChanges();
  });

  it('limits status options to DRAFT and NEW in create mode', () => {
    expect(component.statusOptions).toEqual(['DRAFT', 'NEW']);
  });

  it('opens the full status list when mode is edit', () => {
    component.mode = 'edit';
    component.ngOnChanges({
      mode: { previousValue: 'create', currentValue: 'edit', firstChange: false, isFirstChange: () => false },
    });
    expect(component.statusOptions.length).toBeGreaterThan(2);
    expect(component.statusOptions).toContain('IN_TRANSIT');
  });

  it('auto-prefills load number when blank in create mode', () => {
    expect(basics.get('loadNumber')!.value).toMatch(/^LD-\d{6}-\d{4}$/);
    expect(basics.get('loadNumber')!.valid).toBe(true);
  });

  it('marks rate invalid when negative', () => {
    basics.get('rate')!.setValue(-5);
    basics.get('rate')!.markAsTouched();
    expect(basics.get('rate')!.errors).toBeTruthy();
    expect(basics.valid).toBe(false);
  });

  it('marks rate invalid when non-numeric', () => {
    basics.get('rate')!.setValue('abc' as any);
    expect(basics.get('rate')!.hasError('numeric')).toBe(true);
  });

  it('formatRate rounds to 2 decimals', () => {
    basics.get('rate')!.setValue(1234.5678);
    component.formatRate();
    expect(basics.get('rate')!.value).toBe(1234.57);
  });

  it('disables the basics group in view mode', () => {
    component.mode = 'view';
    component.ngOnChanges({
      mode: { previousValue: 'create', currentValue: 'view', firstChange: false, isFirstChange: () => false },
    });
    expect(basics.disabled).toBe(true);
  });

  it('selectBroker writes brokerId and updates the search label', () => {
    const broker: BrokerOption = { id: 'b-1', legal_name: 'Alpha Logistics' };
    component.selectBroker(broker);
    expect(basics.get('brokerId')!.value).toBe('b-1');
    expect(component.brokerSearch).toBe('Alpha Logistics');
    expect(component.showBrokerDropdown).toBe(false);
  });

  it('clearBroker resets brokerId and the search label', () => {
    component.selectBroker({ id: 'b-1', legal_name: 'Alpha' });
    component.clearBroker();
    expect(basics.get('brokerId')!.value).toBeNull();
    expect(component.brokerSearch).toBe('');
  });

  it('saveNewBroker posts via service and auto-selects the created broker', () => {
    const created: BrokerOption = { id: 'b-9', legal_name: 'New Co' };
    loadsService.createBroker.and.returnValue(of({ success: true, data: created }));

    component.openBrokerModal();
    component.newBrokerName = 'New Co';
    component.saveNewBroker();

    expect(loadsService.createBroker).toHaveBeenCalledWith(
      jasmine.objectContaining({ companyName: 'New Co', legal_name: 'New Co' }),
    );
    expect(basics.get('brokerId')!.value).toBe('b-9');
    expect(component.brokerSearch).toBe('New Co');
    expect(component.showBrokerModal).toBe(false);
    expect(component.brokers.length).toBe(1);
  });

  it('saveNewBroker surfaces server error and keeps the modal open', () => {
    loadsService.createBroker.and.returnValue(
      throwError(() => ({ error: { error: 'Duplicate broker' } })),
    );
    component.openBrokerModal();
    component.newBrokerName = 'Dup';
    component.saveNewBroker();
    expect(component.brokerCreateError).toBe('Duplicate broker');
    expect(component.showBrokerModal).toBe(true);
    expect(component.creatingBroker).toBe(false);
  });
});
