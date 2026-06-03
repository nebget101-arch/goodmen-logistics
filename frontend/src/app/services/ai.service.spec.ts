/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AiService, TollInvoiceExtractionResponse } from './ai.service';
import { environment } from '../../environments/environment';

const VISION_URL = `${environment.apiUrl}/ai/tolls/invoice-vision`;

function makeJpegFile(name = 'invoice.jpg'): File {
  // 1x1 JPEG would be ideal but FileReader runs against a real Blob; an empty Blob is fine.
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' });
}

function makePdfFile(name = 'invoice.pdf'): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
}

describe('AiService.extractTollInvoice (FN-1449)', () => {
  let service: AiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AiService],
    });
    service = TestBed.inject(AiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('maps a successful response to ExtractedTollTransaction[] (success render)', async () => {
    const file = makeJpegFile();
    const promise = firstValueFrom(service.extractTollInvoice(file));

    const req = await waitForRequest(httpMock, VISION_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.mediaType).toBe('image/jpeg');
    expect(typeof req.request.body.imageBase64).toBe('string');

    const apiResponse: TollInvoiceExtractionResponse = {
      success: true,
      data: {
        invoiceMeta: { providerName: 'E-ZPass' },
        transactions: [
          {
            transaction_date: '2026-04-12',
            provider_name: 'E-ZPass',
            plaza_name: 'NJ Turnpike — Exit 11',
            entry_location: 'Exit 8A',
            exit_location: 'Exit 11',
            city: 'Edison',
            state: 'NJ',
            amount: 4.25,
            external_transaction_id: 'EZ-998877',
            notes: 'Class 2',
          },
        ],
        confidence: 0.92,
        warnings: [],
      },
      processingTimeMs: 1234,
    };
    req.flush(apiResponse);

    const result = await promise;
    expect(result.transactions.length).toBe(1);
    const row = result.transactions[0];
    expect(row.transaction_date).toBe('2026-04-12');
    expect(row.provider_name).toBe('E-ZPass');
    expect(row.entry_point).toBe('Exit 8A');
    expect(row.exit_point).toBe('Exit 11');
    expect(row.amount).toBe(4.25);
    expect(row.low_confidence).toBeFalsy();
    expect(result.confidence).toBe(0.92);
  });

  it('flags every row low_confidence when overall confidence < 0.7 (low-confidence highlight)', async () => {
    const file = makeJpegFile();
    const promise = firstValueFrom(service.extractTollInvoice(file));
    const req = await waitForRequest(httpMock, VISION_URL);

    req.flush({
      success: true,
      data: {
        invoiceMeta: {},
        transactions: [
          { transaction_date: '2026-04-12', provider_name: 'SunPass', plaza_name: null, amount: 1.5 },
          { transaction_date: '2026-04-12', provider_name: 'SunPass', plaza_name: null, amount: 2.0 },
        ],
        confidence: 0.55,
        warnings: ['Image was blurry'],
      },
      processingTimeMs: 800,
    } as TollInvoiceExtractionResponse);

    const result = await promise;
    expect(result.transactions.length).toBe(2);
    expect(result.transactions.every(t => t.low_confidence === true)).toBeTrue();
    expect(result.warnings).toEqual(['Image was blurry']);
  });

  it('propagates HTTP errors so callers can show an error toast (error render)', async () => {
    const file = makeJpegFile();
    const promise = firstValueFrom(service.extractTollInvoice(file));
    const req = await waitForRequest(httpMock, VISION_URL);

    req.flush(
      { success: false, error: 'AI toll invoice extraction failed', code: 'AI_VISION_ERROR' },
      { status: 502, statusText: 'Bad Gateway' },
    );

    let caught: any = null;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(caught.status).toBe(502);
  });

  it('rejects unsupported file types without making a request', async () => {
    const file = makePdfFile();
    let caught: any = null;
    try {
      await firstValueFrom(service.extractTollInvoice(file));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(String(caught?.message || '')).toMatch(/Unsupported file type/i);
    httpMock.expectNone(VISION_URL);
  });
});

/**
 * The service uses FileReader.readAsDataURL which resolves asynchronously, so
 * the HTTP request is not posted synchronously inside extractTollInvoice. Poll
 * the test controller until the request lands (typical tick lands within 1–2
 * macrotasks).
 */
async function waitForRequest(httpMock: HttpTestingController, url: string) {
  for (let i = 0; i < 25; i++) {
    const matched = httpMock.match(url);
    if (matched.length) return matched[0];
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
