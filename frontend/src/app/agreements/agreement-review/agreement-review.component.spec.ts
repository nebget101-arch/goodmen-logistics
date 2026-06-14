/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

import { AgreementReviewComponent } from './agreement-review.component';
import { AgreementService } from '../agreement.service';
import { AgreementField, AgreementTemplateDetail } from '../agreement.model';

function field(overrides: Partial<AgreementField> = {}): AgreementField {
  return {
    id: 'f1',
    fieldKey: 'carrier_name',
    label: 'Carrier Name',
    fieldType: 'text',
    page: 1,
    role: 'internal',
    suggestedRole: 'internal',
    confidence: 0.95,
    sortOrder: 0,
    ...overrides,
  };
}

function detail(fields: AgreementField[]): AgreementTemplateDetail {
  return {
    id: 't1',
    name: 'Lease',
    documentType: 'lease_agreement',
    pageCount: 3,
    status: 'draft',
    fields,
  };
}

describe('AgreementReviewComponent', () => {
  let fixture: ComponentFixture<AgreementReviewComponent>;
  let component: AgreementReviewComponent;
  let serviceStub: jasmine.SpyObj<AgreementService>;

  function setup(fields: AgreementField[]): void {
    serviceStub.getTemplate.and.returnValue(of(detail(fields)));
    fixture = TestBed.createComponent(AgreementReviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit → load()
  }

  beforeEach(() => {
    serviceStub = jasmine.createSpyObj<AgreementService>('AgreementService', [
      'getTemplate', 'saveFields',
    ]);
    serviceStub.saveFields.and.returnValue(of(detail([])));

    TestBed.configureTestingModule({
      declarations: [AgreementReviewComponent],
      providers: [
        { provide: AgreementService, useValue: serviceStub },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 't1' } } },
        },
      ],
    }).overrideComponent(AgreementReviewComponent, {
      set: { template: '<div></div>' }, // bypass the real template for unit isolation
    });
  });

  it('loads and sorts the field map on init', () => {
    setup([
      field({ id: 'b', fieldKey: 'b', sortOrder: 2 }),
      field({ id: 'a', fieldKey: 'a', sortOrder: 1 }),
    ]);
    expect(component.fields.map(f => f.fieldKey)).toEqual(['a', 'b']);
  });

  it('toggleFieldRole flips a single field between internal and signer', () => {
    setup([field({ role: 'internal' })]);
    const f = component.fields[0];
    component.toggleFieldRole(f);
    expect(f.role).toBe('signer');
    component.toggleFieldRole(f);
    expect(f.role).toBe('internal');
  });

  it('setFieldRole assigns the role explicitly', () => {
    setup([field({ role: 'internal' })]);
    component.setFieldRole(component.fields[0], 'signer');
    expect(component.fields[0].role).toBe('signer');
  });

  it('isRoleOverridden detects divergence from the AI suggestion', () => {
    setup([field({ role: 'internal', suggestedRole: 'signer' })]);
    expect(component.isRoleOverridden(component.fields[0])).toBeTrue();
    component.setFieldRole(component.fields[0], 'signer');
    expect(component.isRoleOverridden(component.fields[0])).toBeFalse();
  });

  it('flags low-confidence fields and counts them', () => {
    setup([
      field({ confidence: 0.99 }),
      field({ confidence: 0.4 }),
      field({ confidence: 0.6 }),
    ]);
    expect(component.isLowConfidence(component.fields[1])).toBeTrue();
    expect(component.isLowConfidence(component.fields[0])).toBeFalse();
    expect(component.lowConfidenceCount).toBe(2);
  });

  it('respects the backend lowConfidence flag even at high confidence', () => {
    setup([field({ confidence: 0.98, lowConfidence: true })]);
    expect(component.isLowConfidence(component.fields[0])).toBeTrue();
    expect(component.lowConfidenceCount).toBe(1);
  });

  it('confidencePercent renders a whole-number percentage', () => {
    setup([field({ confidence: 0.832 })]);
    expect(component.confidencePercent(component.fields[0])).toBe(83);
  });

  it('save(true) finalizes with the reviewed roles and navigates away', () => {
    setup([field({ role: 'internal' })]);
    component.setFieldRole(component.fields[0], 'signer');
    const router = TestBed.inject(Router);

    component.save(true);

    expect(serviceStub.saveFields).toHaveBeenCalled();
    const [id, patch, finalize] = serviceStub.saveFields.calls.mostRecent().args;
    expect(id).toBe('t1');
    expect(finalize).toBeTrue();
    expect(patch[0].role).toBe('signer');
    expect(patch[0].id).toBe('f1');
    expect(router.navigate).toHaveBeenCalledWith(['/agreements']);
  });

  it('save(false) persists a draft without navigating', () => {
    setup([field()]);
    const router = TestBed.inject(Router);
    component.save(false);
    const [, , finalize] = serviceStub.saveFields.calls.mostRecent().args;
    expect(finalize).toBeFalse();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
