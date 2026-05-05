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
});
