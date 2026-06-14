/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';

import { SignerPageComponent } from './signer-page.component';
import { PublicSignService } from '../public-sign.service';
import { SignerField, SignerView } from '../../agreements/signature-request.model';

function sfield(overrides: Partial<SignerField> = {}): SignerField {
  return {
    id: 'f1',
    fieldKey: 'signer_name',
    label: 'Your Name',
    fieldType: 'text',
    page: 1,
    role: 'signer',
    suggestedRole: 'signer',
    confidence: 0.95,
    sortOrder: 0,
    ...overrides,
  };
}

function view(overrides: Partial<SignerView> = {}): SignerView {
  return {
    document: { name: 'Equipment Lease', documentType: 'lease_agreement' },
    fields: [
      sfield({ id: 'i1', fieldKey: 'carrier_name', label: 'Carrier', role: 'internal', value: 'Acme Co' }),
      sfield({ id: 's1', fieldKey: 'signer_address', label: 'Address', role: 'signer' }),
    ],
    status: 'sent',
    ...overrides,
  };
}

describe('SignerPageComponent', () => {
  let fixture: ComponentFixture<SignerPageComponent>;
  let component: SignerPageComponent;
  let serviceStub: jasmine.SpyObj<PublicSignService>;

  function setup(token: string, viewValue?: SignerView): void {
    if (viewValue) serviceStub.getSignerView.and.returnValue(of(viewValue));
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => token } } },
    });
    fixture = TestBed.createComponent(SignerPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // ngOnInit → load()
  }

  beforeEach(() => {
    serviceStub = jasmine.createSpyObj<PublicSignService>('PublicSignService', [
      'getSignerView', 'submit',
    ]);

    TestBed.configureTestingModule({
      declarations: [SignerPageComponent],
      providers: [
        { provide: PublicSignService, useValue: serviceStub },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'tok' } } } },
      ],
    }).overrideComponent(SignerPageComponent, {
      set: { template: '<div></div>' },
    });
  });

  it('loads the view and splits internal vs signer fields', () => {
    setup('tok', view());
    expect(component.loading).toBeFalse();
    expect(component.internalFields.map(f => f.fieldKey)).toEqual(['carrier_name']);
    expect(component.signerFields.map(f => f.fieldKey)).toEqual(['signer_address']);
    // signer field values are seeded blank
    expect(component.values['signer_address']).toBe('');
  });

  it('errors gracefully when the token is missing (no service call)', () => {
    setup('', undefined);
    expect(serviceStub.getSignerView).not.toHaveBeenCalled();
    expect(component.loadError).toContain('missing');
  });

  it('surfaces a friendly message on load failure', () => {
    serviceStub.getSignerView.and.returnValue(throwError(() => ({ error: { message: 'boom' } })));
    setup('tok');
    expect(component.loadError).toBe('boom');
  });

  it('treats an already-signed link idempotently (shows confirmation)', () => {
    setup('tok', view({ status: 'signed', signedPdfUrl: 'https://r2/signed.pdf' }));
    expect(component.done).toBeTrue();
    expect(component.signedPdfUrl).toBe('https://r2/signed.pdf');
  });

  it('exposes expired / voided token states', () => {
    setup('tok', view({ status: 'expired' }));
    expect(component.isExpired).toBeTrue();
    expect(component.canSign).toBeFalse();
  });

  it('canSubmit requires name, signature, consent and all required fields', () => {
    setup('tok', view());
    expect(component.canSubmit).toBeFalse();

    component.signerName = 'Jordan Rivera';
    component.onSignatureChange({ value: 'Jordan Rivera', type: 'typed' });
    component.consent = true;
    expect(component.canSubmit).toBeFalse(); // required signer_address still blank

    component.values['signer_address'] = '123 Main St';
    expect(component.canSubmit).toBeTrue();
  });

  it('submit posts the signer field values + signature and records the signed PDF', () => {
    serviceStub.submit.and.returnValue(of({ status: 'signed', signedPdfUrl: 'https://r2/x.pdf' }));
    setup('tok', view());
    component.signerName = 'Jordan Rivera';
    component.values['signer_address'] = '123 Main St';
    component.onSignatureChange({ value: 'Jordan Rivera', type: 'typed' });
    component.consent = true;

    component.submit();

    expect(serviceStub.submit).toHaveBeenCalled();
    const [token, payload] = serviceStub.submit.calls.mostRecent().args;
    expect(token).toBe('tok');
    expect(payload.signerName).toBe('Jordan Rivera');
    expect(payload.signatureValue).toBe('Jordan Rivera');
    expect(payload.signatureType).toBe('typed');
    expect(payload.consent).toBeTrue();
    expect(payload.fieldValues['signer_address']).toBe('123 Main St');
    // does not leak internal fields into the signer submission
    expect(payload.fieldValues['carrier_name']).toBeUndefined();

    expect(component.done).toBeTrue();
    expect(component.signedPdfUrl).toBe('https://r2/x.pdf');
  });

  it('shows an error and stays on the form when submit fails', () => {
    serviceStub.submit.and.returnValue(throwError(() => ({ error: { message: 'rejected' } })));
    setup('tok', view());
    component.signerName = 'A';
    component.values['signer_address'] = 'x';
    component.onSignatureChange({ value: 'A', type: 'typed' });
    component.consent = true;

    component.submit();

    expect(component.submitError).toBe('rejected');
    expect(component.done).toBeFalse();
  });

  it('displayValue renders checkboxes as Yes/No and falls back to a dash', () => {
    setup('tok', view());
    expect(component.displayValue(sfield({ fieldType: 'checkbox', value: 'true' }))).toBe('Yes');
    expect(component.displayValue(sfield({ fieldType: 'checkbox', value: null }))).toBe('No');
    expect(component.displayValue(sfield({ value: '' }))).toBe('—');
    expect(component.displayValue(sfield({ value: 'Acme' }))).toBe('Acme');
  });
});
