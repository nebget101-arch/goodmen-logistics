import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/**
 * FN-1099: Quick Add Part — AI photo intake.
 *
 * Mirrors the BE contract from FN-1098
 * (`POST /api/ai/parts/identify-from-photo`):
 *
 *   request:  multipart `image` (preferred) — handler also accepts JSON
 *             { imageBase64, mimeType } but the FE only uploads multipart.
 *   response (200, success):
 *     {
 *       success: true,
 *       aiResult: {
 *         manufacturer, partNumber, category,
 *         descriptionGuess, dimensionsGuess,
 *         confidence: { manufacturer, partNumber, category, description, dimensions },
 *         isUnreadable: false,
 *         warnings: string[]
 *       },
 *       r2Key: 'parts/photos/<uuid>.<ext>',
 *       meta: { processingTimeMs, model }
 *     }
 *
 * Non-2xx responses (400, 413, 422, 502) are treated as failures by callers
 * — the catalog component opens the modal empty and shows a toast.
 *
 * 422 (AI_IMAGE_UNREADABLE) is unusual: the BE still returns `r2Key` so a
 * follow-up retry could reuse the upload. For Phase 1 we treat it as a
 * plain failure and surface the BE message; a later iteration may keep the
 * image attached.
 */
export interface PartConfidence {
  manufacturer?: number;
  partNumber?: number;
  category?: number;
  description?: number;
  dimensions?: number;
}

export interface PartAiResult {
  manufacturer: string | null;
  partNumber: string | null;
  category: string | null;
  descriptionGuess: string | null;
  dimensionsGuess: string | null;
  confidence: PartConfidence;
  isUnreadable: boolean;
  warnings: string[];
}

export interface PartPhotoIntakeResponse {
  success: boolean;
  aiResult: PartAiResult;
  r2Key: string;
  meta?: { processingTimeMs?: number; model?: string };
}

/**
 * FN-1104: Quick Add Part — AI Invoice OCR intake.
 *
 * Mirrors the BE contract from FN-1103
 * (`POST /api/ai/parts/extract-from-invoice`):
 *
 *   request:  multipart `image` field — handler accepts image/jpeg,
 *             image/png, image/webp, image/gif, application/pdf.
 *   response (200, success):
 *     {
 *       success: true,
 *       aiResult: {
 *         success: true,
 *         data: {
 *           vendor, invoiceNumber,
 *           confidence: { vendor, invoiceNumber },
 *           lineItems: [{ sku, description, qty, unitCost, manufacturer,
 *                         confidence: { sku, description, qty, unitCost,
 *                                       manufacturer } }],
 *           warnings: string[]
 *         },
 *         processingTimeMs
 *       },
 *       r2Key: 'parts/invoices/<uuid>.<ext>'
 *     }
 *
 * 422 (AI_INVOICE_UNREADABLE) and 502 (R2/AI failures) come back as
 * HttpErrorResponse with `body.aiResult.code` populated.
 */
export interface InvoiceLineConfidence {
  sku?: number;
  description?: number;
  qty?: number;
  unitCost?: number;
  manufacturer?: number;
}

export interface InvoiceLineItem {
  sku: string;
  description: string;
  qty: number;
  unitCost: number;
  manufacturer: string;
  confidence: InvoiceLineConfidence;
}

export interface InvoiceConfidence {
  vendor?: number;
  invoiceNumber?: number;
}

export interface InvoiceAiResult {
  vendor: string;
  invoiceNumber: string;
  confidence: InvoiceConfidence;
  lineItems: InvoiceLineItem[];
  warnings: string[];
}

export interface InvoiceIntakeResponse {
  success: boolean;
  data: InvoiceAiResult;
  r2Key: string;
  processingTimeMs?: number;
}

/**
 * Bulk-create parts payload — matches `POST /api/parts/bulk` (FN-1103).
 * `name` is required; the BE rejects rows missing sku or name with
 * `skipped[].reason = 'missing_sku_or_name'`.
 */
export interface BulkPartItem {
  sku: string;
  name: string;
  description?: string;
  manufacturer?: string;
  preferred_vendor_name?: string;
  unit_cost?: number;
  unit_price?: number;
  category?: string;
}

export interface BulkPartSkipped {
  sku: string;
  reason: 'duplicate_in_request' | 'sku_exists' | 'missing_sku_or_name' | string;
}

export interface BulkCreateResponse {
  success: boolean;
  created: Array<{ id?: string; sku: string; name: string }>;
  skipped: BulkPartSkipped[];
}

@Injectable({ providedIn: 'root' })
export class AiPartsService {
  private readonly endpoint = `${environment.apiUrl}/ai/parts/identify-from-photo`;
  private readonly invoiceEndpoint = `${environment.apiUrl}/ai/parts/extract-from-invoice`;
  private readonly bulkEndpoint = `${environment.apiUrl}/parts/bulk`;

  constructor(private http: HttpClient) {}

  /**
   * Upload a part photo and receive an AI extraction + R2 key.
   * Uses multipart/form-data; HttpClient sets the boundary automatically
   * — do NOT set Content-Type explicitly.
   */
  identifyFromPhoto(file: File): Observable<PartPhotoIntakeResponse> {
    const form = new FormData();
    form.append('image', file, file.name || 'part.jpg');

    return this.http
      .post<PartPhotoIntakeResponse>(this.endpoint, form)
      .pipe(
        map((res) => this.normalize(res)),
        catchError((err: HttpErrorResponse) => throwError(() => this.toFriendlyError(err))),
      );
  }

  /**
   * Upload a vendor parts invoice (image or PDF) and receive an AI
   * extraction (vendor, invoice number, line items) + R2 key. The BE
   * wraps the inner vision-handler payload as
   * `{ aiResult: { success, data, processingTimeMs }, r2Key }`; we
   * unwrap to a flat `{ data, r2Key, processingTimeMs }` so the modal
   * never has to care about the double envelope.
   */
  extractFromInvoice(file: File): Observable<InvoiceIntakeResponse> {
    const form = new FormData();
    form.append('image', file, file.name || 'invoice');

    return this.http.post<any>(this.invoiceEndpoint, form).pipe(
      map((res) => this.normalizeInvoice(res)),
      catchError((err: HttpErrorResponse) => throwError(() => this.toInvoiceError(err))),
    );
  }

  /**
   * Bulk-create parts after the user reviews the AI-extracted invoice.
   * The BE returns `{ created, skipped }`; both are surfaced so the
   * caller can show per-row outcomes inline.
   */
  bulkCreate(items: BulkPartItem[]): Observable<BulkCreateResponse> {
    return this.http.post<any>(this.bulkEndpoint, { items }).pipe(
      map((res) => this.normalizeBulkCreate(res)),
      catchError((err: HttpErrorResponse) => throwError(() => this.toBulkError(err))),
    );
  }

  private normalize(res: PartPhotoIntakeResponse): PartPhotoIntakeResponse {
    // Defensive: BE handler always returns `aiResult` + `r2Key`, but null
    // out missing nested fields so the UI doesn't blow up if the contract
    // drifts.
    const ai = res?.aiResult || ({} as PartAiResult);
    return {
      success: !!res?.success,
      aiResult: {
        manufacturer: ai.manufacturer ?? null,
        partNumber: ai.partNumber ?? null,
        category: ai.category ?? null,
        descriptionGuess: ai.descriptionGuess ?? null,
        dimensionsGuess: ai.dimensionsGuess ?? null,
        confidence: ai.confidence || {},
        isUnreadable: !!ai.isUnreadable,
        warnings: Array.isArray(ai.warnings) ? ai.warnings : [],
      },
      r2Key: res?.r2Key || '',
      meta: res?.meta,
    };
  }

  private toFriendlyError(err: HttpErrorResponse): Error {
    const code = err?.error?.code;
    const beMsg: string | undefined = err?.error?.error || err?.error?.message;

    if (code === 'AI_IMAGE_UNREADABLE') {
      return new Error(beMsg || 'We could not read the part in that photo. Try a closer, well-lit shot.');
    }
    if (code === 'AI_IMAGE_TOO_LARGE') {
      return new Error('That image is over 10MB. Please try a smaller photo.');
    }
    if (code === 'AI_BAD_REQUEST') {
      return new Error(beMsg || 'That image format is not supported. Use JPG, PNG, WebP, or GIF.');
    }
    if (code === 'R2_UPLOAD_FAILED') {
      return new Error('Could not save the photo to storage — please try again in a moment.');
    }
    if (err.status === 0) {
      return new Error('Network error — check your connection and try again.');
    }
    return new Error(beMsg || 'AI photo intake failed. Please fill the form manually.');
  }

  // ── FN-1104: Invoice intake normalization + error mapping ────────────────

  private normalizeInvoice(res: any): InvoiceIntakeResponse {
    // The intake handler nests the vision-handler payload under `aiResult`:
    //   { success, aiResult: { success, data, processingTimeMs }, r2Key }
    const inner = res?.aiResult || {};
    const rawData = inner?.data || {};
    const c = rawData?.confidence || {};
    const lineItems = Array.isArray(rawData?.lineItems)
      ? rawData.lineItems.map((line: any) => this.normalizeLine(line))
      : [];

    return {
      success: !!res?.success,
      r2Key: res?.r2Key || '',
      processingTimeMs: typeof inner?.processingTimeMs === 'number' ? inner.processingTimeMs : undefined,
      data: {
        vendor: typeof rawData?.vendor === 'string' ? rawData.vendor : '',
        invoiceNumber: typeof rawData?.invoiceNumber === 'string' ? rawData.invoiceNumber : '',
        confidence: {
          vendor: typeof c.vendor === 'number' ? c.vendor : undefined,
          invoiceNumber: typeof c.invoiceNumber === 'number' ? c.invoiceNumber : undefined,
        },
        lineItems,
        warnings: Array.isArray(rawData?.warnings)
          ? rawData.warnings.filter((w: unknown) => typeof w === 'string')
          : [],
      },
    };
  }

  private normalizeLine(raw: any): InvoiceLineItem {
    const c = raw?.confidence || {};
    return {
      sku: typeof raw?.sku === 'string' ? raw.sku : '',
      description: typeof raw?.description === 'string' ? raw.description : '',
      qty: typeof raw?.qty === 'number' && Number.isFinite(raw.qty) ? raw.qty : 1,
      unitCost: typeof raw?.unitCost === 'number' && Number.isFinite(raw.unitCost) ? raw.unitCost : 0,
      manufacturer: typeof raw?.manufacturer === 'string' ? raw.manufacturer : '',
      confidence: {
        sku: typeof c.sku === 'number' ? c.sku : undefined,
        description: typeof c.description === 'number' ? c.description : undefined,
        qty: typeof c.qty === 'number' ? c.qty : undefined,
        unitCost: typeof c.unitCost === 'number' ? c.unitCost : undefined,
        manufacturer: typeof c.manufacturer === 'number' ? c.manufacturer : undefined,
      },
    };
  }

  private toInvoiceError(err: HttpErrorResponse): Error {
    // The intake handler returns { success, aiResult: <inner-error-body>, r2Key }
    // even on 4xx/5xx, so the friendly code lives at err.error.aiResult.code.
    const inner = err?.error?.aiResult || err?.error || {};
    const code = inner?.code || err?.error?.code;
    const beMsg: string | undefined = inner?.error || err?.error?.error || err?.error?.message;

    if (code === 'AI_INVOICE_UNREADABLE') {
      return new Error(
        beMsg
          || 'We could not read this invoice. Try a clearer photo or upload the original PDF.',
      );
    }
    if (code === 'AI_FILE_TOO_LARGE') {
      return new Error('That file is over 20MB. Please try a smaller invoice.');
    }
    if (code === 'AI_BAD_REQUEST') {
      return new Error(
        beMsg || 'Unsupported file type. Use JPG, PNG, WebP, GIF, or PDF.',
      );
    }
    if (code === 'R2_UPLOAD_FAILED') {
      return new Error('Could not save the invoice to storage — please try again in a moment.');
    }
    if (code === 'AI_PARSE_ERROR' || code === 'AI_VISION_ERROR') {
      return new Error(beMsg || 'AI invoice extraction failed. Please try again or add parts manually.');
    }
    if (err.status === 0) {
      return new Error('Network error — check your connection and try again.');
    }
    return new Error(beMsg || 'AI invoice extraction failed. Please add parts manually.');
  }

  private normalizeBulkCreate(res: any): BulkCreateResponse {
    return {
      success: !!res?.success,
      created: Array.isArray(res?.created) ? res.created : [],
      skipped: Array.isArray(res?.skipped) ? res.skipped : [],
    };
  }

  private toBulkError(err: HttpErrorResponse): Error {
    const beMsg: string | undefined = err?.error?.error || err?.error?.message;
    if (err.status === 400) {
      return new Error(beMsg || 'No valid parts to create.');
    }
    if (err.status === 0) {
      return new Error('Network error — check your connection and try again.');
    }
    return new Error(beMsg || 'Bulk-create failed. Some parts may not have been saved.');
  }
}
