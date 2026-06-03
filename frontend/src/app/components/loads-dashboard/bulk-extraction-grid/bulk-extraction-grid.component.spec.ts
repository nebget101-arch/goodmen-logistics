/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';

import { BulkExtractionGridComponent } from './bulk-extraction-grid.component';
import { LoadsService } from '../../../services/loads.service';
import {
  LoadAiEndpointExtraction,
  LoadDetail
} from '../../../models/load-dashboard.model';

// ───────────────────────────────────────────────────────────────────────────
// FN-1085 — coverage for the missing RATE_CONFIRMATION attachment fix.
//
// `processFile` previously stopped after `createLoad`, which left bulk-
// extracted loads with zero attachments. The fix calls `uploadAttachment`
// after the load is created and surfaces a PARTIAL_SUCCESS state when the
// upload fails (so the user sees the load link plus a warning rather than a
// green tick).
//
// Construction is side-effect-free; we instantiate with `new` and stub
// dependencies. After FN-1083 ngOnInit no longer auto-starts processing,
// each test still wires its `files`/`rows` input before invoking
// `startProcessing` directly.
// ───────────────────────────────────────────────────────────────────────────

function makePdfFn1085(name = 'rate-conf.pdf'): File {
  return new File([new Blob(['%PDF-1.4'], { type: 'application/pdf' })], name, {
    type: 'application/pdf'
  });
}

function makeExtraction(): LoadAiEndpointExtraction {
  return {
    brokerName: 'Acme Logistics',
    poNumber: 'PO-12345',
    rate: 1850,
    pickup: {
      date: '2026-06-01',
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
      address1: null
    },
    delivery: {
      date: '2026-06-02',
      city: 'Atlanta',
      state: 'GA',
      zip: '30303',
      address1: null
    },
    notes: 'Handle with care',
    provider: 'openai'
  };
}

function makeLoad(): LoadDetail {
  return {
    id: 'load-uuid-1',
    load_number: 1042
  } as unknown as LoadDetail;
}

interface SpyServices {
  aiExtractFromPdf: jasmine.Spy;
  createLoad: jasmine.Spy;
  uploadAttachment: jasmine.Spy;
}

function makeComponent(spies: SpyServices): BulkExtractionGridComponent {
  const loadsService: any = {
    aiExtractFromPdf: spies.aiExtractFromPdf,
    createLoad: spies.createLoad,
    uploadAttachment: spies.uploadAttachment
  };
  const cdr: any = { markForCheck: () => {} };
  return new BulkExtractionGridComponent(loadsService, cdr);
}

describe('BulkExtractionGridComponent — processFile attachment upload (FN-1085)', () => {
  let aiExtractSpy: jasmine.Spy;
  let createLoadSpy: jasmine.Spy;
  let uploadAttachmentSpy: jasmine.Spy;
  let component: BulkExtractionGridComponent;
  let pdf: File;

  beforeEach(() => {
    aiExtractSpy = jasmine.createSpy('aiExtractFromPdf');
    createLoadSpy = jasmine.createSpy('createLoad');
    uploadAttachmentSpy = jasmine.createSpy('uploadAttachment');
    pdf = makePdfFn1085();
    component = makeComponent({
      aiExtractFromPdf: aiExtractSpy,
      createLoad: createLoadSpy,
      uploadAttachment: uploadAttachmentSpy
    });
    // Skip ngOnInit so we control the row state explicitly.
    component.files = [pdf];
    component.rows = [
      {
        file: pdf,
        status: 'QUEUED',
        autoApproved: false,
        load: null,
        extraction: null,
        errorMessage: '',
        attachmentError: ''
      }
    ];
  });

  it('happy path: aiExtract → createLoad → uploadAttachment all succeed → row resolves to SUCCESS', async () => {
    const extraction = makeExtraction();
    const load = makeLoad();
    aiExtractSpy.and.returnValue(of({ success: true, data: extraction }));
    createLoadSpy.and.returnValue(of({ success: true, data: load }));
    uploadAttachmentSpy.and.returnValue(
      of({ success: true, data: { id: 'att-1', type: 'RATE_CONFIRMATION' } as any })
    );

    await component.startProcessing();

    expect(aiExtractSpy).toHaveBeenCalledOnceWith(pdf);
    expect(createLoadSpy).toHaveBeenCalledTimes(1);
    expect(uploadAttachmentSpy).toHaveBeenCalledOnceWith(load.id, pdf, 'RATE_CONFIRMATION');

    const row = component.rows[0];
    expect(row.status).toBe('SUCCESS');
    expect(row.load).toBe(load);
    expect(row.errorMessage).toBe('');
    expect(row.attachmentError).toBe('');
    expect(component.completed).toBeTrue();
    expect(component.failedCount).toBe(0);
    expect(component.partialSuccessCount).toBe(0);
  });

  it('partial success: createLoad succeeds but uploadAttachment fails → row resolves to PARTIAL_SUCCESS with load link + warning', async () => {
    const extraction = makeExtraction();
    const load = makeLoad();
    aiExtractSpy.and.returnValue(of({ success: true, data: extraction }));
    createLoadSpy.and.returnValue(of({ success: true, data: load }));
    uploadAttachmentSpy.and.returnValue(
      throwError(() => ({ error: { message: 'storage write failed' } }))
    );

    await component.startProcessing();

    expect(createLoadSpy).toHaveBeenCalledTimes(1);
    expect(uploadAttachmentSpy).toHaveBeenCalledOnceWith(load.id, pdf, 'RATE_CONFIRMATION');

    const row = component.rows[0];
    expect(row.status).toBe('PARTIAL_SUCCESS');
    // Load link must still be available so the user can open it and attach manually.
    expect(row.load).toBe(load);
    expect(row.attachmentError).toBe('storage write failed');
    expect(row.errorMessage).toBe('');
    expect(component.completed).toBeTrue();
    expect(component.partialSuccessCount).toBe(1);
    expect(component.failedCount).toBe(0);
    // Not green-tick SUCCESS.
    expect(component.autoApprovedCount).toBe(0);
    expect(component.needsReviewCount).toBe(0);
  });

  it('full failure: createLoad fails → row ERROR, no attachment call', async () => {
    const extraction = makeExtraction();
    aiExtractSpy.and.returnValue(of({ success: true, data: extraction }));
    createLoadSpy.and.returnValue(
      throwError(() => ({ error: { message: 'duplicate po_number' } }))
    );

    await component.startProcessing();

    expect(createLoadSpy).toHaveBeenCalledTimes(1);
    expect(uploadAttachmentSpy).not.toHaveBeenCalled();

    const row = component.rows[0];
    expect(row.status).toBe('FAILED');
    expect(row.load).toBeNull();
    expect(row.errorMessage).toBe('duplicate po_number');
    expect(component.failedCount).toBe(1);
    expect(component.partialSuccessCount).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// FN-1083: review-gate behavior. The grid must NOT auto-start extraction on
// open — the user must explicitly click "Start extraction" after reviewing
// the queued files (and may add/remove files first).
// ───────────────────────────────────────────────────────────────────────────

describe('BulkExtractionGridComponent — review gate (FN-1083)', () => {
  let component: BulkExtractionGridComponent;
  let fixture: ComponentFixture<BulkExtractionGridComponent>;
  let aiExtractSpy: jasmine.Spy;
  let createLoadSpy: jasmine.Spy;

  function makePdf(name: string): File {
    return new File([new Blob(['%PDF-1.4'])], name, { type: 'application/pdf' });
  }

  function makeFileList(files: File[]): FileList {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    return dt.files;
  }

  beforeEach(async () => {
    aiExtractSpy = jasmine.createSpy('aiExtractFromPdf').and.returnValue(of({ data: null }));
    createLoadSpy = jasmine.createSpy('createLoad').and.returnValue(of({ data: null }));

    const loadsServiceStub = {
      aiExtractFromPdf: aiExtractSpy,
      createLoad: createLoadSpy,
    };

    await TestBed.configureTestingModule({
      declarations: [BulkExtractionGridComponent],
      providers: [{ provide: LoadsService, useValue: loadsServiceStub }],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(BulkExtractionGridComponent);
    component = fixture.componentInstance;
  });

  describe('ngOnInit()', () => {
    it('builds rows from inputs but does NOT call startProcessing() — user must confirm', () => {
      const startSpy = spyOn(component, 'startProcessing').and.callThrough();
      component.files = [makePdf('a.pdf'), makePdf('b.pdf')];

      fixture.detectChanges(); // triggers ngOnInit

      expect(component.rows.length).toBe(2);
      expect(component.rows[0].file.name).toBe('a.pdf');
      expect(component.rows.every((r) => r.status === 'QUEUED')).toBeTrue();
      expect(component.processing).toBeFalse();
      expect(component.completed).toBeFalse();
      expect(component.inReview).toBeTrue();
      expect(startSpy).not.toHaveBeenCalled();
      expect(aiExtractSpy).not.toHaveBeenCalled();
    });
  });

  describe('onStartExtraction()', () => {
    it('calls startProcessing() when in review with queued rows', () => {
      const startSpy = spyOn(component, 'startProcessing').and.returnValue(Promise.resolve());
      component.files = [makePdf('a.pdf'), makePdf('b.pdf')];
      fixture.detectChanges();

      component.onStartExtraction();

      expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when there are no rows', () => {
      const startSpy = spyOn(component, 'startProcessing').and.returnValue(Promise.resolve());
      component.files = [];
      fixture.detectChanges();

      component.onStartExtraction();

      expect(startSpy).not.toHaveBeenCalled();
    });

    it('is a no-op once processing has begun', () => {
      const startSpy = spyOn(component, 'startProcessing').and.returnValue(Promise.resolve());
      component.files = [makePdf('a.pdf')];
      fixture.detectChanges();
      component.processing = true;

      component.onStartExtraction();

      expect(startSpy).not.toHaveBeenCalled();
    });
  });

  describe('onRemoveReviewFile()', () => {
    it('removes the row at the given index', () => {
      component.files = [makePdf('a.pdf'), makePdf('b.pdf'), makePdf('c.pdf')];
      fixture.detectChanges();

      component.onRemoveReviewFile(1);

      expect(component.rows.length).toBe(2);
      expect(component.rows.map((r) => r.file.name)).toEqual(['a.pdf', 'c.pdf']);
    });

    it('emits close when removing the last row', () => {
      const closeSpy = spyOn(component.close, 'emit');
      component.files = [makePdf('a.pdf')];
      fixture.detectChanges();

      component.onRemoveReviewFile(0);

      expect(component.rows.length).toBe(0);
      expect(closeSpy).toHaveBeenCalled();
    });

    it('ignores out-of-range indices', () => {
      component.files = [makePdf('a.pdf')];
      fixture.detectChanges();

      component.onRemoveReviewFile(5);
      component.onRemoveReviewFile(-1);

      expect(component.rows.length).toBe(1);
    });

    it('does nothing once processing has begun', () => {
      component.files = [makePdf('a.pdf'), makePdf('b.pdf')];
      fixture.detectChanges();
      component.processing = true;

      component.onRemoveReviewFile(0);

      expect(component.rows.length).toBe(2);
    });
  });

  describe('onReviewFileInput()', () => {
    it('appends additional PDFs to the review list', () => {
      component.files = [makePdf('a.pdf')];
      fixture.detectChanges();

      const newPdfs = makeFileList([makePdf('b.pdf'), makePdf('c.pdf')]);
      const inputEl = document.createElement('input');
      Object.defineProperty(inputEl, 'files', { value: newPdfs, configurable: true });

      component.onReviewFileInput({ target: inputEl } as unknown as Event);

      expect(component.rows.map((r) => r.file.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
      expect(component.reviewNotice).toContain('Added 2 file');
    });

    it('caps additions at MAX_FILES (10) and reports overflow', () => {
      component.files = Array.from({ length: 9 }, (_, i) => makePdf(`f${i}.pdf`));
      fixture.detectChanges();

      const newPdfs = makeFileList([makePdf('x.pdf'), makePdf('y.pdf'), makePdf('z.pdf')]);
      const inputEl = document.createElement('input');
      Object.defineProperty(inputEl, 'files', { value: newPdfs, configurable: true });

      component.onReviewFileInput({ target: inputEl } as unknown as Event);

      expect(component.rows.length).toBe(10);
      expect(component.reviewNotice).toContain('not added');
    });
  });
});
