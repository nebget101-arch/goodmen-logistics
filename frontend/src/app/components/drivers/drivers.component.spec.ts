import { ElementRef } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';

import { DriversComponent } from './drivers.component';
import { CdlExtractionResponse } from '../../services/api.service';

// FN-1628 — focused logic spec for the CDL upload + AI prefill flow.
// We avoid TestBed because DriversComponent's full module graph (operating-entity
// context, access control, safety risk, onboarding modal, route, etc.) is heavy
// and irrelevant to the methods under test. The CDL methods are self-contained
// and can be exercised by constructing the component with stub dependencies.

function makeComponent(opts: {
  extractCdl?: ReturnType<typeof jasmine.createSpy>,
  extractCdls?: ReturnType<typeof jasmine.createSpy>
} = {}): DriversComponent {
  const apiServiceStub: any = {
    extractCdl: opts.extractCdl ?? jasmine.createSpy('extractCdl').and.returnValue(of({ success: false, extracted: null })),
    extractCdls: opts.extractCdls ?? jasmine.createSpy('extractCdls').and.returnValue(of({ results: [] }))
  };
  const onboardingModalStub: any = {};
  const routeStub: any = { queryParams: new Subject() };
  const operatingEntityContextStub: any = { context$: () => new Subject() };
  const accessControlStub: any = { hasAnyRole: () => true, hasAnyPermission: () => true };
  const safetyRiskStub: any = { getFleetSummary: () => new Subject() };

  return new DriversComponent(
    apiServiceStub,
    onboardingModalStub,
    routeStub,
    operatingEntityContextStub,
    accessControlStub,
    safetyRiskStub
  );
}

function makeFile(name: string, type: string, size: number): File {
  const file = new File([new Uint8Array(Math.max(size, 1))], name, { type });
  if (file.size !== size) {
    Object.defineProperty(file, 'size', { value: size });
  }
  return file;
}

function makeChangeEvent(file: File | null): Event {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', {
    value: file ? [file] as any : [],
    configurable: true
  });
  return { target: input } as unknown as Event;
}

function makeMultiChangeEvent(files: File[]): Event {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', {
    value: files as any,
    configurable: true
  });
  return { target: input } as unknown as Event;
}

describe('DriversComponent — CDL upload + AI prefill (FN-1628)', () => {
  describe('applyCdlExtraction', () => {
    it('populates newDriver with extracted fields and tracks them as AI-prefilled', () => {
      const c = makeComponent();
      const resp: CdlExtractionResponse = {
        success: true,
        extracted: {
          firstName: 'John', lastName: 'Doe', dateOfBirth: '1985-04-12',
          streetAddress: '123 Main St', city: 'Dallas', state: 'TX', zipCode: '75201',
          cdlNumber: '12345678', cdlState: 'TX', cdlClass: 'A', cdlExpiry: '2028-04-12'
        },
        extractedFields: ['firstName', 'lastName', 'dateOfBirth', 'streetAddress', 'city', 'state', 'zipCode', 'cdlNumber', 'cdlState', 'cdlClass', 'cdlExpiry']
      };

      c.applyCdlExtraction(resp);

      expect(c.showAddForm).toBeTrue();
      expect(c.newDriver.firstName).toBe('John');
      expect(c.newDriver.cdlNumber).toBe('12345678');
      expect(c.newDriver.cdlExpiry).toBe('2028-04-12');
      expect(c.aiPrefilledFields.has('firstName')).toBeTrue();
      expect(c.aiPrefilledFields.has('cdlExpiry')).toBeTrue();
      expect(c.cdlExtractionMessage?.kind).toBe('success');
    });

    it('leaves phone, hireDate, and medicalCertExpiry untouched even if backend smuggles them in', () => {
      const c = makeComponent();
      const resp: CdlExtractionResponse = {
        success: true,
        extracted: {
          firstName: 'Jane'
        } as any,
        // Backend should never send these, but defend the contract regardless.
        extractedFields: ['firstName', 'phone', 'hireDate', 'medicalCertExpiry']
      };
      // Inject the values the backend should never send.
      (resp.extracted as any).phone = '555-0100';
      (resp.extracted as any).hireDate = '2026-01-01';
      (resp.extracted as any).medicalCertExpiry = '2027-01-01';

      c.applyCdlExtraction(resp);

      expect(c.newDriver.firstName).toBe('Jane');
      expect(c.newDriver.phone).toBe('');
      expect(c.newDriver.hireDate).toBe('');
      expect(c.newDriver.medicalCertExpiry).toBe('');
      expect(c.aiPrefilledFields.has('phone')).toBeFalse();
      expect(c.aiPrefilledFields.has('hireDate')).toBeFalse();
    });

    it('opens an empty modal with an error message when success=false', () => {
      const c = makeComponent();
      c.applyCdlExtraction({ success: false, extracted: null, reason: 'low_confidence' });

      expect(c.showAddForm).toBeTrue();
      expect(c.newDriver.firstName).toBe('');
      expect(c.aiPrefilledFields.size).toBe(0);
      expect(c.cdlExtractionMessage?.kind).toBe('error');
      expect(c.cdlExtractionMessage?.text).toContain("Couldn't read CDL");
    });

    it('treats success=true with no usable fields as a soft failure', () => {
      const c = makeComponent();
      c.applyCdlExtraction({
        success: true,
        extracted: { firstName: null, lastName: '' } as any,
        extractedFields: []
      });

      expect(c.showAddForm).toBeTrue();
      expect(c.aiPrefilledFields.size).toBe(0);
      expect(c.cdlExtractionMessage?.kind).toBe('error');
    });
  });

  describe('clearAiFields', () => {
    it('resets all CDL-extractable fields and drops the AI marker set', () => {
      const c = makeComponent();
      c.applyCdlExtraction({
        success: true,
        extracted: {
          firstName: 'John', lastName: 'Doe', cdlNumber: 'X1', cdlClass: 'B', cdlExpiry: '2030-01-01'
        },
        extractedFields: ['firstName', 'lastName', 'cdlNumber', 'cdlClass', 'cdlExpiry']
      });
      expect(c.aiPrefilledFields.size).toBeGreaterThan(0);

      c.clearAiFields();

      expect(c.newDriver.firstName).toBe('');
      expect(c.newDriver.lastName).toBe('');
      expect(c.newDriver.cdlNumber).toBe('');
      expect(c.newDriver.cdlExpiry).toBe('');
      expect(c.newDriver.cdlClass).toBe('A'); // dropdown default restored
      expect(c.aiPrefilledFields.size).toBe(0);
      expect(c.cdlExtractionMessage).toBeNull();
    });
  });

  // FN-1633 — Multi-file picker now seeds a queue instead of opening the modal
  // directly. Single-file UX is preserved through the same queue (1 row → Review).
  describe('onCdlFileSelected — multi-file queue (FN-1633)', () => {
    it('selecting 3 valid files calls extractCdls once with 3 files and seeds the queue', () => {
      const extractCdls = jasmine.createSpy('extractCdls').and.returnValue(of({
        results: [
          { success: true, extracted: { firstName: 'A', cdlNumber: 'A1' }, extractedFields: ['firstName', 'cdlNumber'] },
          { success: true, extracted: { firstName: 'B', cdlNumber: 'B2' }, extractedFields: ['firstName', 'cdlNumber'] },
          { success: true, extracted: { firstName: 'C', cdlNumber: 'C3' }, extractedFields: ['firstName', 'cdlNumber'] }
        ] as CdlExtractionResponse[]
      }));
      const c = makeComponent({ extractCdls });
      const files = [
        makeFile('a.jpg', 'image/jpeg', 1024),
        makeFile('b.pdf', 'application/pdf', 2048),
        makeFile('c.png', 'image/png', 4096)
      ];

      c.onCdlFileSelected(makeMultiChangeEvent(files));

      expect(extractCdls).toHaveBeenCalledTimes(1);
      expect(extractCdls.calls.mostRecent().args[0].length).toBe(3);
      expect(c.cdlBatchQueue.length).toBe(3);
      expect(c.cdlBatchQueue.map(r => r.status)).toEqual(['ready', 'ready', 'ready']);
      // Reviewing the first row opens the modal pre-filled with that file's fields.
      c.reviewQueueRow(c.cdlBatchQueue[0]);
      expect(c.showAddForm).toBeTrue();
      expect(c.newDriver.firstName).toBe('A');
      expect(c.newDriver.cdlNumber).toBe('A1');
    });

    it('client-side oversize rejection lists the bad row in the queue and only POSTs the accepted files', () => {
      const extractCdls = jasmine.createSpy('extractCdls').and.returnValue(of({
        results: [{ success: true, extracted: { firstName: 'A' }, extractedFields: ['firstName'] }] as CdlExtractionResponse[]
      }));
      const c = makeComponent({ extractCdls });
      const ok = makeFile('ok.jpg', 'image/jpeg', 1024);
      const tooBig = makeFile('huge.pdf', 'application/pdf', 11 * 1024 * 1024);

      c.onCdlFileSelected(makeMultiChangeEvent([ok, tooBig]));

      expect(extractCdls).toHaveBeenCalledTimes(1);
      expect(extractCdls.calls.mostRecent().args[0]).toEqual([ok]);
      const failedRow = c.cdlBatchQueue.find(r => r.filename === 'huge.pdf');
      const okRow = c.cdlBatchQueue.find(r => r.filename === 'ok.jpg');
      expect(failedRow?.status).toBe('failed');
      expect(failedRow?.reason).toContain('10 MB');
      expect(okRow?.status).toBe('ready');
    });

    it('mixed server response: failed rows show the fallback reason; the success row stays Reviewable', () => {
      const extractCdls = jasmine.createSpy('extractCdls').and.returnValue(of({
        results: [
          { success: true, extracted: { firstName: 'Win', cdlNumber: 'W1' }, extractedFields: ['firstName', 'cdlNumber'] },
          { success: false, extracted: null, reason: 'low_confidence' },
          { success: false, extracted: null, reason: 'ai_unavailable' }
        ] as CdlExtractionResponse[]
      }));
      const c = makeComponent({ extractCdls });
      const files = [
        makeFile('a.jpg', 'image/jpeg', 1024),
        makeFile('b.jpg', 'image/jpeg', 1024),
        makeFile('c.jpg', 'image/jpeg', 1024)
      ];

      c.onCdlFileSelected(makeMultiChangeEvent(files));

      expect(c.cdlBatchQueue.map(r => r.status)).toEqual(['ready', 'failed', 'failed']);
      expect(c.cdlBatchQueue[1].reason).toContain("Couldn't read CDL");
      expect(c.cdlBatchQueue[2].reason).toContain("Couldn't read CDL");
      // Ready row still opens the modal pre-filled.
      c.reviewQueueRow(c.cdlBatchQueue[0]);
      expect(c.newDriver.firstName).toBe('Win');
      // reviewQueueRow on a failed row is a no-op — modal stays in its current
      // state and the row status doesn't flip.
      const before = c.cdlBatchQueue[1].status;
      c.reviewQueueRow(c.cdlBatchQueue[1]);
      expect(c.cdlBatchQueue[1].status).toBe(before);
    });

    it('selecting more than 10 files shows a toast and does not POST', () => {
      const extractCdls = jasmine.createSpy('extractCdls');
      const c = makeComponent({ extractCdls });
      const files = Array.from({ length: 11 }, (_, i) => makeFile(`cdl${i}.jpg`, 'image/jpeg', 1024));

      c.onCdlFileSelected(makeMultiChangeEvent(files));

      expect(extractCdls).not.toHaveBeenCalled();
      expect(c.cdlBatchQueue.length).toBe(0);
      expect(c.cdlExtractionMessage?.kind).toBe('error');
      expect(c.cdlExtractionMessage?.text).toContain('10');
    });

    it('falls back to per-file failed rows when the API request errors out', () => {
      const extractCdls = jasmine.createSpy('extractCdls').and.returnValue(throwError(() => new Error('boom')));
      const c = makeComponent({ extractCdls });
      const files = [
        makeFile('a.png', 'image/png', 1024),
        makeFile('b.png', 'image/png', 1024)
      ];

      c.onCdlFileSelected(makeMultiChangeEvent(files));

      expect(c.extractingCdl).toBeFalse();
      expect(c.cdlBatchQueue.length).toBe(2);
      expect(c.cdlBatchQueue.every(r => r.status === 'failed')).toBeTrue();
    });

    it('regression: a single file selected via the multi picker still ends up reviewable in the queue', () => {
      const extractCdls = jasmine.createSpy('extractCdls').and.returnValue(of({
        results: [{ success: true, extracted: { firstName: 'Solo', cdlNumber: 'S1' }, extractedFields: ['firstName', 'cdlNumber'] }] as CdlExtractionResponse[]
      }));
      const c = makeComponent({ extractCdls });
      const file = makeFile('solo.jpg', 'image/jpeg', 1024);

      c.onCdlFileSelected(makeChangeEvent(file));

      expect(extractCdls).toHaveBeenCalledTimes(1);
      expect(c.cdlBatchQueue.length).toBe(1);
      expect(c.cdlBatchQueue[0].status).toBe('ready');
      c.reviewQueueRow(c.cdlBatchQueue[0]);
      expect(c.showAddForm).toBeTrue();
      expect(c.newDriver.firstName).toBe('Solo');
    });
  });

  describe('reviewQueueRow → completeActiveQueueRow (FN-1633)', () => {
    it('marks the active row Done when the modal is closed via toggleAddForm', () => {
      const extractCdls = jasmine.createSpy('extractCdls').and.returnValue(of({
        results: [{ success: true, extracted: { firstName: 'X' }, extractedFields: ['firstName'] }] as CdlExtractionResponse[]
      }));
      const c = makeComponent({ extractCdls });
      c.onCdlFileSelected(makeChangeEvent(makeFile('x.jpg', 'image/jpeg', 1024)));
      c.reviewQueueRow(c.cdlBatchQueue[0]);
      expect(c.cdlBatchQueue[0].status).toBe('ready');

      c.toggleAddForm(); // closes the modal

      expect(c.cdlBatchQueue[0].status).toBe('done');
    });

    it('clears the queue card when dismissCdlQueue is called', () => {
      const extractCdls = jasmine.createSpy('extractCdls').and.returnValue(of({
        results: [{ success: true, extracted: { firstName: 'X' }, extractedFields: ['firstName'] }] as CdlExtractionResponse[]
      }));
      const c = makeComponent({ extractCdls });
      c.onCdlFileSelected(makeChangeEvent(makeFile('x.jpg', 'image/jpeg', 1024)));
      expect(c.cdlBatchQueue.length).toBe(1);

      c.dismissCdlQueue();

      expect(c.cdlBatchQueue.length).toBe(0);
    });
  });

  describe('openCdlPicker — concurrency guard', () => {
    it('ignores clicks while an extraction is already in flight', () => {
      const c = makeComponent();
      const click = jasmine.createSpy('click');
      c.cdlFileInput = { nativeElement: { click } as unknown as HTMLInputElement } as ElementRef<HTMLInputElement>;
      c.extractingCdl = true;

      c.openCdlPicker();

      expect(click).not.toHaveBeenCalled();
    });

    it('opens the file picker when no extraction is in flight', () => {
      const c = makeComponent();
      const click = jasmine.createSpy('click');
      c.cdlFileInput = { nativeElement: { click } as unknown as HTMLInputElement } as ElementRef<HTMLInputElement>;

      c.openCdlPicker();

      expect(click).toHaveBeenCalledTimes(1);
    });
  });

  describe('isAiPrefilled / isCdlManualOnly', () => {
    it('reflects whether a field is currently AI-marked', () => {
      const c = makeComponent();
      expect(c.isAiPrefilled('firstName')).toBeFalse();
      c.aiPrefilledFields.add('firstName');
      expect(c.isAiPrefilled('firstName')).toBeTrue();
    });

    it('marks phone, hireDate, and medicalCertExpiry as manual-only', () => {
      const c = makeComponent();
      expect(c.isCdlManualOnly('phone')).toBeTrue();
      expect(c.isCdlManualOnly('hireDate')).toBeTrue();
      expect(c.isCdlManualOnly('medicalCertExpiry')).toBeTrue();
      expect(c.isCdlManualOnly('firstName')).toBeFalse();
    });
  });

  describe('toggleAddForm — clears AI state on close', () => {
    it('drops aiPrefilledFields and cdlExtractionMessage when the modal closes', () => {
      const c = makeComponent();
      c.showAddForm = true;
      c.aiPrefilledFields.add('firstName');
      c.cdlExtractionMessage = { kind: 'success', text: 'AI extracted these fields...' };

      c.toggleAddForm(); // closes

      expect(c.showAddForm).toBeFalse();
      expect(c.aiPrefilledFields.size).toBe(0);
      expect(c.cdlExtractionMessage).toBeNull();
    });
  });
});
