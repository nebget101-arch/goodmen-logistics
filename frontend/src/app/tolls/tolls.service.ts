import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  TollAccount,
  TollAiNormalizeResult,
  TollCommitResult,
  TollDevice,
  TollException,
  TollImportBatch,
  TollMappingProfile,
  TollOverview,
  TollTransaction,
  TollUploadResult,
  InvoiceExtractionResponse,
  CreateTollTransactionPayload,
} from './tolls.model';

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

  getExceptions(filters: { limit?: number; offset?: number; status?: string } = {}): Observable<{ rows: TollException[]; total: number }> {
    let params = new HttpParams();
    if (filters.limit) params = params.set('limit', filters.limit);
    if (filters.offset) params = params.set('offset', filters.offset);
    if (filters.status) params = params.set('status', filters.status);
    return this.http.get<{ rows: TollException[]; total: number }>(`${this.base}/exceptions`, { params });
  }

  resolveException(id: string, payload: { resolution_status: string; resolution_notes?: string; truck_id?: string; driver_id?: string }): Observable<TollException> {
    return this.http.patch<TollException>(`${this.base}/exceptions/${id}`, payload);
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

  aiNormalize(batchId: string): Observable<TollAiNormalizeResult> {
    return this.http.post<TollAiNormalizeResult>(`${this.base}/import/ai-normalize`, { batch_id: batchId });
  }

  getTransactions(filters: {
    limit?: number; offset?: number;
    date_from?: string; date_to?: string;
    truck_id?: string; driver_id?: string;
    batch_id?: string; status?: string;
  } = {}): Observable<{ rows: TollTransaction[]; total: number }> {
    let p = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p = p.set(k, v.toString()); });
    return this.http.get<{ rows: TollTransaction[]; total: number }>(`${this.base}/transactions`, { params: p });
  }

  createTransaction(payload: Partial<TollTransaction>): Observable<TollTransaction> {
    return this.http.post<TollTransaction>(`${this.base}/transactions`, payload);
  }

  /** Upload invoice image(s) for AI extraction */
  uploadInvoiceImage(files: File[]): Observable<InvoiceExtractionResponse> {
    const formData = new FormData();
    files.forEach(f => formData.append('invoices', f, f.name));
    return this.http.post<InvoiceExtractionResponse>(`${this.base}/import/invoice-image`, formData);
  }

  /** Create multiple toll transactions in a batch */
  createTransactions(payloads: CreateTollTransactionPayload[]): Observable<{ success: boolean; created: number }> {
    return this.http.post<{ success: boolean; created: number }>(`${this.base}/transactions/batch`, { transactions: payloads });
  }
}
