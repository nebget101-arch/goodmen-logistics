import { Injectable } from '@angular/core';
import { HttpClient, HttpEventType, HttpResponse } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { filter, finalize, map, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export type FmcsaImportFile = 'census' | 'authority' | 'inspections' | 'crashes' | 'sms';
export type FmcsaImportStatus = 'queued' | 'running' | 'success' | 'error';
export type FmcsaImportTriggeredBy = 'manual' | 'cron';

export interface FmcsaImportRun {
  id: string;
  file: FmcsaImportFile;
  triggered_by: FmcsaImportTriggeredBy;
  triggered_by_user_id?: string | null;
  started_at: string | null;
  finished_at: string | null;
  status: FmcsaImportStatus;
  rows_inserted?: number | null;
  rows_updated?: number | null;
  rows_skipped?: number | null;
  error_message?: string | null;
  dry_run?: boolean;
}

export interface RunImportRequest {
  files: FmcsaImportFile[];
  dryRun?: boolean;
}

export interface RunImportResponse {
  success: boolean;
  data: { runIds: string[] };
}

export interface ListImportsResponse {
  success: boolean;
  data: FmcsaImportRun[];
}

export interface RunUploadResult {
  runId: string;
  file: string;
  uploadedSizeBytes: number;
}

export interface RunUploadResponse {
  success: boolean;
  data: RunUploadResult;
}

@Injectable({ providedIn: 'root' })
export class FmcsaImportsService {
  private readonly baseUrl = `${environment.apiUrl}/fmcsa/imports`;

  private readonly uploadProgressSubject = new BehaviorSubject<number>(0);
  // Per FN-1458: progress is exposed as a separate stream; the runUpload observable resolves with the final upload result.
  readonly uploadProgress$: Observable<number> = this.uploadProgressSubject.asObservable();

  constructor(private readonly http: HttpClient) {}

  list(): Observable<ListImportsResponse> {
    return this.http.get<ListImportsResponse>(this.baseUrl);
  }

  run(request: RunImportRequest): Observable<RunImportResponse> {
    return this.http.post<RunImportResponse>(`${this.baseUrl}/run`, request);
  }

  runUpload(file: File, fileType: FmcsaImportFile, dryRun: boolean): Observable<RunUploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('fileType', fileType);
    formData.append('dryRun', String(dryRun));

    this.uploadProgressSubject.next(0);

    return this.http
      .post<RunUploadResponse>(`${this.baseUrl}/run-upload`, formData, {
        reportProgress: true,
        observe: 'events',
      })
      .pipe(
        tap((event) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
            this.uploadProgressSubject.next(percent);
          }
        }),
        filter((event): event is HttpResponse<RunUploadResponse> => event.type === HttpEventType.Response),
        map((response) => {
          this.uploadProgressSubject.next(100);
          const body = response.body;
          if (!body || !body.data) {
            throw new Error('Malformed FMCSA upload response');
          }
          return body.data;
        }),
        finalize(() => this.uploadProgressSubject.next(0)),
      );
  }
}
