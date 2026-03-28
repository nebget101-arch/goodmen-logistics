import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  TollAccount,
  TollDevice,
  TollImportBatch,
  TollOverview,
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

  getImportBatches(limit = 50, offset = 0): Observable<{ rows: TollImportBatch[]; total: number }> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<{ rows: TollImportBatch[]; total: number }>(`${this.base}/import/batches`, { params });
  }

  /** Upload invoice image(s) for AI extraction */
  uploadInvoiceImage(files: File[]): Observable<InvoiceExtractionResponse> {
    const formData = new FormData();
    files.forEach(f => formData.append('invoices', f, f.name));
    return this.http.post<InvoiceExtractionResponse>(`${this.base}/import/invoice-image`, formData);
  }

  /** Create a single toll transaction */
  createTransaction(payload: CreateTollTransactionPayload): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/transactions`, payload);
  }

  /** Create multiple toll transactions in a batch */
  createTransactions(payloads: CreateTollTransactionPayload[]): Observable<{ success: boolean; created: number }> {
    return this.http.post<{ success: boolean; created: number }>(`${this.base}/transactions/batch`, { transactions: payloads });
  }
}
