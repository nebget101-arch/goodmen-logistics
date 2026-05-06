import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
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

@Injectable({ providedIn: 'root' })
export class FmcsaImportsService {
  private readonly baseUrl = `${environment.apiUrl}/fmcsa/imports`;

  constructor(private readonly http: HttpClient) {}

  list(): Observable<ListImportsResponse> {
    return this.http.get<ListImportsResponse>(this.baseUrl);
  }

  run(request: RunImportRequest): Observable<RunImportResponse> {
    return this.http.post<RunImportResponse>(`${this.baseUrl}/run`, request);
  }
}
