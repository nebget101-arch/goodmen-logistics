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

@Injectable({ providedIn: 'root' })
export class AiPartsService {
  private readonly endpoint = `${environment.apiUrl}/ai/parts/identify-from-photo`;

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
}
