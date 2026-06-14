/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { AgreementSendComponent } from './agreement-send.component';
import { AgreementService } from '../agreement.service';
import { AgreementField, AgreementTemplateDetail } from '../agreement.model';

function field(overrides: Partial<AgreementField> = {}): AgreementField {
  return {
    id: 'f1',
    fieldKey: 'lessor_name',
    label: 'Lessor Name',
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
    status: 'ready',
    fields,
  };
}

/**
 * FN-1801 — the send screen routes through the equipment-lease adapter (FN-1800)
 * when reached with subject context, and through the generic engine otherwise.
 */
describe('AgreementSendComponent — equipment-lease routing (FN-1801)', () => {
  let fixture: ComponentFixture<AgreementSendComponent>;
  let component: AgreementSendComponent;
  let serviceStub: jasmine.SpyObj<AgreementService>;
  let routeQueryParams: Record<string, string>;

  function setup(): void {
    serviceStub.getTemplate.and.returnValue(of(detail([field()])));
    fixture = TestBed.createComponent(AgreementSendComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit → load()
    component.values['lessor_name'] = 'Acme Leasing';
    component.signer = { name: 'Pat Lessor', email: 'pat@example.com', phone: '', role: 'Lessor' };
  }

  beforeEach(() => {
    routeQueryParams = {};
    serviceStub = jasmine.createSpyObj<AgreementService>('AgreementService', [
      'getTemplate', 'createRequest', 'startEquipmentLeaseSigning',
    ]);
    serviceStub.createRequest.and.returnValue(of({ requestId: 'req-generic', status: 'sent' }));
    serviceStub.startEquipmentLeaseSigning.and.returnValue(
      of({ requestId: 'req-lease', status: 'sent', signerLink: 'https://x/sign/t', link: {} })
    );

    TestBed.configureTestingModule({
      declarations: [AgreementSendComponent],
      providers: [
        { provide: AgreementService, useValue: serviceStub },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => 't1' },
              queryParamMap: { get: (k: string) => routeQueryParams[k] ?? null },
            },
          },
        },
      ],
    }).overrideComponent(AgreementSendComponent, {
      set: { template: '<div></div>' },
    });
  });

  it('sends via the generic engine when there is no subject context', () => {
    setup();
    expect(component.hasSubjectContext).toBeFalse();
    component.send();
    expect(serviceStub.createRequest).toHaveBeenCalled();
    expect(serviceStub.startEquipmentLeaseSigning).not.toHaveBeenCalled();
    expect(component.result?.requestId).toBe('req-generic');
  });

  it('routes through the equipment-lease adapter when scoped to a subject', () => {
    routeQueryParams = { subjectType: 'vehicle', subjectId: 'veh-1', subjectLabel: 'Unit 12' };
    setup();
    expect(component.hasSubjectContext).toBeTrue();

    component.send();

    expect(serviceStub.startEquipmentLeaseSigning).toHaveBeenCalled();
    expect(serviceStub.createRequest).not.toHaveBeenCalled();
    const arg = serviceStub.startEquipmentLeaseSigning.calls.mostRecent().args[0];
    expect(arg.subjectType).toBe('vehicle');
    expect(arg.subjectId).toBe('veh-1');
    expect(arg.templateId).toBe('t1');
    expect(arg.fieldValues['lessor_name']).toBe('Acme Leasing');
    expect(arg.signer.name).toBe('Pat Lessor');
    expect(component.result?.requestId).toBe('req-lease');
  });
});
