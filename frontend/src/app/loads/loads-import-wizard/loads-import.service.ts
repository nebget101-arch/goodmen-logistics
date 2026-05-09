// HTTP client for the loads-import wizard.
// Wraps backend endpoints delivered by FN-1584 / FN-1590:
//   POST /loads/import/preview          (multipart, file)
//   POST /loads/import/stage            (JSON body with batchId + columnMapping)
//   POST /loads/import/commit/:batchId
//   GET  /loads/import/batches
//   GET  /loads/import/batches/:id
// All loads-import responses are wrapped in `{ success, data }`; we unwrap
// here so callers see the inner payload directly.

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  AiColumnSuggestion,
  CommitDuplicate,
  ImportPreviewResponse,
  StageResponse,
  CommitResponse,
  ImportBatchSummary,
  MultiStopPattern,
} from './loads-import.model';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface StageRequest {
  batchId: string;
  columnMapping: Record<string, AiColumnSuggestion>;
  multiStopPattern: MultiStopPattern;
  statusEnumMapping?: Record<string, string>;
  billingStatusEnumMapping?: Record<string, string>;
  groupByColumn?: string | null;
}

// Wire shape returned by the BE (`backend/packages/goodmen-shared/services/loads-import-service.js`
// — `commitBatch` returns `{ batchId, created: { auto, needsReview }, duplicates, errors }`).
// Kept private to this file; consumers see the FE-flat `CommitResponse`.
interface CommitWireResponse {
  batchId: string;
  created?: { auto?: number; needsReview?: number };
  duplicates?: Array<{
    rowIndex: number;
    loadNumber: string;
    existingLoadId?: string | null;
    existingLoadKey?: string | null;
  }>;
  errors?: Array<{ rowIndex: number; message: string }>;
  idempotent?: boolean;
}

function adaptCommitResponse(r: CommitWireResponse): CommitResponse {
  const duplicates: CommitDuplicate[] = (r.duplicates || []).map((d) => ({
    rowIndex: d.rowIndex,
    loadNumber: d.loadNumber,
    existingLoadId: d.existingLoadId ?? null,
    existingLoadKey: d.existingLoadKey ?? null,
  }));
  return {
    batchId: r.batchId,
    autoCreatedCount: r.created?.auto ?? 0,
    needsReviewCount: r.created?.needsReview ?? 0,
    duplicatesSkippedCount: duplicates.length,
    errorCount: (r.errors || []).length,
    duplicates,
    errors: r.errors,
  };
}

@Injectable({ providedIn: 'root' })
export class LoadsImportService {
  private base = `${environment.apiUrl}/loads/import`;

  constructor(private http: HttpClient) {}

  preview(file: File): Observable<ImportPreviewResponse> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<ApiEnvelope<ImportPreviewResponse>>(`${this.base}/preview`, fd).pipe(
      map((r) => r.data),
    );
  }

  stage(req: StageRequest): Observable<StageResponse> {
    return this.http.post<ApiEnvelope<StageResponse>>(`${this.base}/stage`, req).pipe(
      map((r) => r.data),
    );
  }

  commit(batchId: string, importNeedsReview = true): Observable<CommitResponse> {
    return this.http
      .post<ApiEnvelope<CommitWireResponse>>(`${this.base}/commit/${encodeURIComponent(batchId)}`, {
        import_needs_review: importNeedsReview,
      })
      .pipe(map((r) => adaptCommitResponse(r.data)));
  }

  listBatches(limit = 50, offset = 0): Observable<{ rows: ImportBatchSummary[]; total: number }> {
    const p = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http
      .get<ApiEnvelope<{ rows: ImportBatchSummary[]; total: number }>>(`${this.base}/batches`, { params: p })
      .pipe(map((r) => r.data));
  }

  getBatch(id: string): Observable<{ batch: ImportBatchSummary }> {
    return this.http
      .get<ApiEnvelope<{ batch: ImportBatchSummary }>>(`${this.base}/batches/${encodeURIComponent(id)}`)
      .pipe(map((r) => r.data));
  }
}
