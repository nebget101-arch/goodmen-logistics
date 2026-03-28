import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { TollAccount, TollDevice, TollImportBatch, TollOverview, TollTransaction } from './tolls.model';

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

  getTransactions(filters: {
    limit?: number; offset?: number; sort_by?: string; sort_dir?: string;
    date_from?: string; date_to?: string; truck_id?: string; driver_id?: string; matched_status?: string;
  } = {}): Observable<{ rows: TollTransaction[]; total: number }> {
    let params = new HttpParams();
    if (filters.limit) params = params.set('limit', filters.limit);
    if (filters.offset) params = params.set('offset', filters.offset);
    if (filters.sort_by) params = params.set('sort_by', filters.sort_by);
    if (filters.sort_dir) params = params.set('sort_dir', filters.sort_dir);
    if (filters.date_from) params = params.set('date_from', filters.date_from);
    if (filters.date_to) params = params.set('date_to', filters.date_to);
    if (filters.truck_id) params = params.set('truck_id', filters.truck_id);
    if (filters.driver_id) params = params.set('driver_id', filters.driver_id);
    if (filters.matched_status) params = params.set('matched_status', filters.matched_status);
    return this.http.get<{ rows: TollTransaction[]; total: number }>(`${this.base}/transactions`, { params });
  }

  createTransaction(payload: Partial<TollTransaction>): Observable<TollTransaction> {
    return this.http.post<TollTransaction>(`${this.base}/transactions`, payload);
  }

  getImportBatches(limit = 50, offset = 0): Observable<{ rows: TollImportBatch[]; total: number }> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<{ rows: TollImportBatch[]; total: number }>(`${this.base}/import/batches`, { params });
  }
}
