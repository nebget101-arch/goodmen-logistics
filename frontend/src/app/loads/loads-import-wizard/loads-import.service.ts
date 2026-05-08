// FN-1594 — HTTP client for the loads-import wizard.
// Wraps backend endpoints delivered by FN-1584:
//   POST /loads/import/preview   (multipart)
//   POST /loads/import/stage     (multipart)
//   POST /loads/import/commit/:batchId
//   GET  /loads/import/batches
//   GET  /loads/import/batches/:id

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ImportPreviewResponse,
  StageResponse,
  CommitResponse,
  ImportBatchSummary,
  MultiStopPattern,
} from './loads-import.model';

@Injectable({ providedIn: 'root' })
export class LoadsImportService {
  private base = `${environment.apiUrl}/loads/import`;

  constructor(private http: HttpClient) {}

  preview(file: File): Observable<ImportPreviewResponse> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<ImportPreviewResponse>(`${this.base}/preview`, fd);
  }

  stage(
    file: File,
    columnMap: Record<string, string | null>,
    multiStopPattern: MultiStopPattern,
  ): Observable<StageResponse> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('column_map', JSON.stringify(columnMap));
    fd.append('multi_stop_pattern', multiStopPattern);
    return this.http.post<StageResponse>(`${this.base}/stage`, fd);
  }

  commit(batchId: string, importNeedsReview = true): Observable<CommitResponse> {
    return this.http.post<CommitResponse>(`${this.base}/commit/${encodeURIComponent(batchId)}`, {
      import_needs_review: importNeedsReview,
    });
  }

  listBatches(limit = 50, offset = 0): Observable<{ rows: ImportBatchSummary[]; total: number }> {
    const p = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<{ rows: ImportBatchSummary[]; total: number }>(`${this.base}/batches`, { params: p });
  }

  getBatch(id: string): Observable<{ batch: ImportBatchSummary }> {
    return this.http.get<{ batch: ImportBatchSummary }>(`${this.base}/batches/${encodeURIComponent(id)}`);
  }
}
