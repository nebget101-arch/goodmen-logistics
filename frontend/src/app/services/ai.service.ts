import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, throwError } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ExtractedTollTransaction } from '../tolls/tolls.model';

const SUPPORTED_VISION_MEDIA_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
];

const LOW_CONFIDENCE_THRESHOLD = 0.7;

export interface TollInvoiceExtractionResponse {
  success: boolean;
  data: {
    invoiceMeta: Record<string, unknown>;
    transactions: Array<{
      transaction_date: string | null;
      provider_name: string;
      plaza_name: string | null;
      entry_location?: string | null;
      exit_location?: string | null;
      city?: string | null;
      state?: string | null;
      amount: number;
      external_transaction_id?: string | null;
      notes?: string | null;
    }>;
    confidence: number;
    warnings: string[];
  };
  processingTimeMs: number;
}

export interface TollInvoiceExtractionResult {
  transactions: ExtractedTollTransaction[];
  warnings: string[];
  confidence: number;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly visionUrl = `${environment.apiUrl}/ai/tolls/invoice-vision`;

  constructor(private http: HttpClient) {}

  /**
   * Extract toll transactions from an invoice image via Claude Vision.
   * Maps the AI service's transaction shape (entry_location/exit_location)
   * to the dialog's ExtractedTollTransaction shape (entry_point/exit_point)
   * and flags rows as low_confidence when overall confidence is below threshold.
   */
  extractTollInvoice(file: File): Observable<TollInvoiceExtractionResult> {
    const mediaType = this.resolveMediaType(file);
    if (!SUPPORTED_VISION_MEDIA_TYPES.includes(mediaType)) {
      return throwError(() => new Error(
        `Unsupported file type: ${file.type || 'unknown'}. Use JPG, PNG, WebP, or GIF.`,
      ));
    }

    return from(this.fileToBase64(file)).pipe(
      switchMap(imageBase64 =>
        this.http.post<TollInvoiceExtractionResponse>(this.visionUrl, { imageBase64, mediaType }),
      ),
      map(res => this.toExtractionResult(res)),
    );
  }

  private toExtractionResult(res: TollInvoiceExtractionResponse): TollInvoiceExtractionResult {
    const data = res?.data || { transactions: [], warnings: [], confidence: 0, invoiceMeta: {} };
    const overallConfidence = typeof data.confidence === 'number' ? data.confidence : 0;
    const lowConfidence = overallConfidence < LOW_CONFIDENCE_THRESHOLD;

    const transactions: ExtractedTollTransaction[] = (data.transactions || []).map(t => ({
      transaction_date: t.transaction_date || '',
      provider_name: t.provider_name || '',
      plaza_name: t.plaza_name || '',
      plate_number: '',
      amount: typeof t.amount === 'number' ? t.amount : Number(t.amount) || 0,
      entry_point: t.entry_location || undefined,
      exit_point: t.exit_location || undefined,
      city: t.city || undefined,
      state: t.state || undefined,
      external_transaction_id: t.external_transaction_id || undefined,
      notes: t.notes || undefined,
      low_confidence: lowConfidence,
    }));

    return {
      transactions,
      warnings: data.warnings || [],
      confidence: overallConfidence,
    };
  }

  private resolveMediaType(file: File): string {
    if (file.type) return file.type.toLowerCase();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      case 'pdf':
        return 'application/pdf';
      default:
        return '';
    }
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const commaIdx = result.indexOf(',');
        resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }
}
