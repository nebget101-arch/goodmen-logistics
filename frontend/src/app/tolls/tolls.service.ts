import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { TollAccount, TollCommitResult, TollDevice, TollImportBatch, TollMappingProfile, TollOverview, TollUploadResult } from './tolls.model';

@Injectable({ providedIn: 'root' })
export class TollsService {
  private base = `${environment.apiUrl}/tolls`;

  constructor(private http: HttpClient) {}

  getOverview(): Observable<TollOverview> {
    return this.http.get<TollOverview>(`${this.base}/overview`);
  }

  getAccounts(): Observable<TollAccount[]> {
    return this.http.get<TollAccount[]>(`${this.base}/accounts`);
  }

  createAccount(payload: Partial<TollAccount>): Observable<TollAccount> {
    return this.http.post<TollAccount>(`${this.base}/accounts`, payload);
  }

  updateAccount(id: string, payload: Partial<TollAccount>): Observable<TollAccount> {
    return this.http.patch<TollAccount>(`${this.base}/accounts/${id}`, payload);
  }

  getDevices(): Observable<TollDevice[]> {
    return this.http.get<TollDevice[]>(`${this.base}/devices`);
  }

  createDevice(payload: Partial<TollDevice>): Observable<TollDevice> {
    return this.http.post<TollDevice>(`${this.base}/devices`, payload);
  }

  updateDevice(id: string, payload: Partial<TollDevice>): Observable<TollDevice> {
    return this.http.patch<TollDevice>(`${this.base}/devices/${id}`, payload);
  }

  getImportBatches(limit = 50, offset = 0): Observable<{ rows: TollImportBatch[]; total: number }> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<{ rows: TollImportBatch[]; total: number }>(`${this.base}/import/batches`, { params });
  }

  uploadImportCSV(file: File, tollAccountId?: string): Observable<TollUploadResult> {
    const fd = new FormData();
    fd.append('file', file);
    if (tollAccountId) fd.append('toll_account_id', tollAccountId);
    return this.http.post<TollUploadResult>(`${this.base}/import/upload`, fd);
  }

  commitImport(batchId: string, rows: Record<string, string>[], columnMap: Record<string, string>): Observable<TollCommitResult> {
    return this.http.post<TollCommitResult>(`${this.base}/import/commit`, {
      batch_id: batchId,
      rows,
      column_map: columnMap
    });
  }

  getMappingProfiles(): Observable<{ rows: TollMappingProfile[] }> {
    return this.http.get<{ rows: TollMappingProfile[] }>(`${this.base}/import/mapping-profiles`);
  }

  saveMappingProfile(profile: { profile_name: string; provider_name?: string; column_map: Record<string, string>; is_default?: boolean }): Observable<TollMappingProfile> {
    return this.http.post<TollMappingProfile>(`${this.base}/import/mapping-profiles`, profile);
  }
}
