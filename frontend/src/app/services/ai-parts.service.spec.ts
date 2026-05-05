import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { AiPartsService } from './ai-parts.service';
import { environment } from '../../environments/environment';

describe('AiPartsService', () => {
  let service: AiPartsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AiPartsService],
    });
    service = TestBed.inject(AiPartsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function makeFile(name = 'part.jpg', type = 'image/jpeg'): File {
    return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
  }

  it('POSTs multipart to /api/ai/parts/identify-from-photo and unwraps the response', (done) => {
    const file = makeFile();

    service.identifyFromPhoto(file).subscribe((res) => {
      expect(res.success).toBe(true);
      expect(res.aiResult.manufacturer).toBe('Bosch');
      expect(res.aiResult.confidence.manufacturer).toBe(0.9);
      expect(res.r2Key).toBe('parts/photos/abc.jpg');
      done();
    });

    const req = http.expectOne(`${environment.apiUrl}/ai/parts/identify-from-photo`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBe(true);
    const body = req.request.body as FormData;
    expect(body.get('image')).toBeTruthy();
    // HttpClient must NOT set Content-Type explicitly (boundary needed) —
    // but in tests it's the absence we care about.
    expect(req.request.headers.get('Content-Type')).toBeNull();

    req.flush({
      success: true,
      aiResult: {
        manufacturer: 'Bosch',
        partNumber: 'F002H20064',
        category: 'Filtration',
        descriptionGuess: 'Oil filter cartridge',
        dimensionsGuess: '4in x 4in',
        confidence: {
          manufacturer: 0.9,
          partNumber: 0.92,
          category: 0.88,
          description: 0.7,
          dimensions: 0.4,
        },
        isUnreadable: false,
        warnings: [],
      },
      r2Key: 'parts/photos/abc.jpg',
      meta: { processingTimeMs: 2100, model: 'claude-sonnet-4' },
    });
  });

  it('normalizes a sparse aiResult so the UI never blows up', (done) => {
    service.identifyFromPhoto(makeFile()).subscribe((res) => {
      expect(res.aiResult.manufacturer).toBeNull();
      expect(res.aiResult.warnings).toEqual([]);
      expect(res.aiResult.confidence).toEqual({});
      done();
    });

    const req = http.expectOne(`${environment.apiUrl}/ai/parts/identify-from-photo`);
    req.flush({ success: true, aiResult: {}, r2Key: 'parts/photos/x.jpg' });
  });

  it('maps AI_IMAGE_UNREADABLE → friendly error', (done) => {
    service.identifyFromPhoto(makeFile()).subscribe({
      next: () => fail('should have errored'),
      error: (e: Error) => {
        expect(e.message).toMatch(/could not read|Try a closer/i);
        done();
      },
    });

    const req = http.expectOne(`${environment.apiUrl}/ai/parts/identify-from-photo`);
    req.flush(
      { success: false, error: 'AI_IMAGE_UNREADABLE', code: 'AI_IMAGE_UNREADABLE' },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
  });

  it('maps AI_IMAGE_TOO_LARGE → friendly error', (done) => {
    service.identifyFromPhoto(makeFile()).subscribe({
      next: () => fail('should have errored'),
      error: (e: Error) => {
        expect(e.message).toMatch(/10MB/);
        done();
      },
    });

    const req = http.expectOne(`${environment.apiUrl}/ai/parts/identify-from-photo`);
    req.flush(
      { success: false, error: 'too big', code: 'AI_IMAGE_TOO_LARGE' },
      { status: 413, statusText: 'Payload Too Large' },
    );
  });

  it('falls back to a generic message when the BE returns no code', (done) => {
    service.identifyFromPhoto(makeFile()).subscribe({
      next: () => fail('should have errored'),
      error: (e: Error) => {
        expect(e.message).toBe('AI photo intake failed. Please fill the form manually.');
        done();
      },
    });

    const req = http.expectOne(`${environment.apiUrl}/ai/parts/identify-from-photo`);
    req.flush({}, { status: 500, statusText: 'Server Error' });
  });

  // ── FN-1104: Invoice intake + bulk-create ───────────────────────────────────

  function makeInvoiceFile(name = 'invoice.pdf', type = 'application/pdf'): File {
    return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
  }

  it('extractFromInvoice POSTs multipart to /ai/parts/extract-from-invoice and unwraps aiResult.data', (done) => {
    const file = makeInvoiceFile();

    service.extractFromInvoice(file).subscribe((res) => {
      expect(res.success).toBe(true);
      expect(res.r2Key).toBe('parts/invoices/uuid.pdf');
      expect(res.processingTimeMs).toBe(1200);
      expect(res.data.vendor).toBe('NAPA');
      expect(res.data.invoiceNumber).toBe('INV-001');
      expect(res.data.confidence.vendor).toBe(0.95);
      expect(res.data.lineItems.length).toBe(2);
      expect(res.data.lineItems[0].sku).toBe('FRAM-PH7317');
      expect(res.data.lineItems[0].confidence.sku).toBe(0.92);
      expect(res.data.warnings).toEqual([]);
      done();
    });

    const req = http.expectOne(`${environment.apiUrl}/ai/parts/extract-from-invoice`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBe(true);
    expect((req.request.body as FormData).get('image')).toBeTruthy();
    expect(req.request.headers.get('Content-Type')).toBeNull();

    req.flush({
      success: true,
      aiResult: {
        success: true,
        data: {
          vendor: 'NAPA',
          invoiceNumber: 'INV-001',
          confidence: { vendor: 0.95, invoiceNumber: 0.9 },
          lineItems: [
            {
              sku: 'FRAM-PH7317',
              description: 'Oil filter',
              qty: 12,
              unitCost: 4.5,
              manufacturer: 'Fram',
              confidence: {
                sku: 0.92,
                description: 0.9,
                qty: 0.95,
                unitCost: 0.85,
                manufacturer: 0.88,
              },
            },
            {
              sku: 'WIX-51515',
              description: 'Oil filter',
              qty: 6,
              unitCost: 5.25,
              manufacturer: 'Wix',
              confidence: {
                sku: 0.88,
                description: 0.7,
                qty: 0.95,
                unitCost: 0.65,
                manufacturer: 0.8,
              },
            },
          ],
          warnings: [],
        },
        processingTimeMs: 1200,
      },
      r2Key: 'parts/invoices/uuid.pdf',
    });
  });

  it('extractFromInvoice normalizes a sparse response so the UI never blows up', (done) => {
    service.extractFromInvoice(makeInvoiceFile()).subscribe((res) => {
      expect(res.success).toBe(false);
      expect(res.data.vendor).toBe('');
      expect(res.data.invoiceNumber).toBe('');
      expect(res.data.lineItems).toEqual([]);
      expect(res.data.warnings).toEqual([]);
      expect(res.r2Key).toBe('');
      done();
    });

    const req = http.expectOne(`${environment.apiUrl}/ai/parts/extract-from-invoice`);
    req.flush({});
  });

  it('extractFromInvoice maps AI_INVOICE_UNREADABLE → friendly error', (done) => {
    service.extractFromInvoice(makeInvoiceFile()).subscribe({
      next: () => fail('should have errored'),
      error: (e: Error) => {
        expect(e.message).toMatch(/could not read|clearer photo/i);
        done();
      },
    });

    const req = http.expectOne(`${environment.apiUrl}/ai/parts/extract-from-invoice`);
    req.flush(
      {
        success: false,
        aiResult: {
          success: false,
          error: 'Could not extract vendor or line items from invoice',
          code: 'AI_INVOICE_UNREADABLE',
          warnings: [],
        },
        r2Key: 'parts/invoices/x.pdf',
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
  });

  it('extractFromInvoice maps AI_FILE_TOO_LARGE → friendly error', (done) => {
    service.extractFromInvoice(makeInvoiceFile()).subscribe({
      next: () => fail('should have errored'),
      error: (e: Error) => {
        expect(e.message).toMatch(/20MB/);
        done();
      },
    });

    const req = http.expectOne(`${environment.apiUrl}/ai/parts/extract-from-invoice`);
    req.flush(
      { success: false, error: 'too big', code: 'AI_FILE_TOO_LARGE' },
      { status: 413, statusText: 'Payload Too Large' },
    );
  });

  it('bulkCreate POSTs JSON {items} to /parts/bulk and surfaces created/skipped', (done) => {
    const items = [
      { sku: 'A1', name: 'Filter' },
      { sku: 'A2', name: 'Hose' },
    ];

    service.bulkCreate(items).subscribe((res) => {
      expect(res.success).toBe(true);
      expect(res.created.length).toBe(1);
      expect(res.skipped.length).toBe(1);
      expect(res.skipped[0].reason).toBe('sku_exists');
      done();
    });

    const req = http.expectOne(`${environment.apiUrl}/parts/bulk`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ items });

    req.flush(
      {
        success: true,
        created: [{ id: 'p1', sku: 'A1', name: 'Filter' }],
        skipped: [{ sku: 'A2', reason: 'sku_exists' }],
      },
      { status: 201, statusText: 'Created' },
    );
  });

  it('bulkCreate normalizes 400 to a friendly error', (done) => {
    service.bulkCreate([]).subscribe({
      next: () => fail('should have errored'),
      error: (e: Error) => {
        expect(e.message).toMatch(/no valid parts|non-empty/i);
        done();
      },
    });

    const req = http.expectOne(`${environment.apiUrl}/parts/bulk`);
    req.flush(
      { error: 'items must be a non-empty array' },
      { status: 400, statusText: 'Bad Request' },
    );
  });
});
