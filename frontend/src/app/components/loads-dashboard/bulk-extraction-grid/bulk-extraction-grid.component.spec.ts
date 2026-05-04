/// <reference types="jasmine" />

import { of, throwError } from 'rxjs';

import { BulkExtractionGridComponent } from './bulk-extraction-grid.component';
import {
  LoadAiEndpointExtraction,
  LoadDetail
} from '../../../models/load-dashboard.model';

/**
 * FN-1085 — coverage for the missing RATE_CONFIRMATION attachment fix.
 *
 * `processFile` previously stopped after `createLoad`, which left bulk-
 * extracted loads with zero attachments. The fix calls `uploadAttachment`
 * after the load is created and surfaces a PARTIAL_SUCCESS state when the
 * upload fails (so the user sees the load link plus a warning rather than a
 * green tick).
 *
 * Construction is side-effect-free; we instantiate with `new` and stub
 * dependencies. ngOnInit kicks off processing, so each test wires its
 * `files` input before invoking `startProcessing` directly.
 */

function makePdf(name = 'rate-conf.pdf'): File {
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
    pdf = makePdf();
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
