import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { FinancingSummary, LeaseAgreement, LeasePaymentTransaction, LeaseScheduleRow, RiskRow } from './lease-financing.models';

@Injectable({ providedIn: 'root' })
export class LeaseFinancingService {
  private readonly baseUrl = `${environment.apiUrl}`;

  constructor(private http: HttpClient) {}

  listAgreements(query: Record<string, string | number | undefined> = {}): Observable<{ rows: LeaseAgreement[]; total: number }> {
    return this.http.get<{ rows: LeaseAgreement[]; total: number }>(`${this.baseUrl}/lease-agreements`, {
      params: this.toParams(query)
    });
  }

  getAgreement(id: string): Observable<LeaseAgreement & { schedule: LeaseScheduleRow[]; payments: LeasePaymentTransaction[]; risk_snapshot?: any }> {
    return this.http.get<LeaseAgreement & { schedule: LeaseScheduleRow[]; payments: LeasePaymentTransaction[]; risk_snapshot?: any }>(`${this.baseUrl}/lease-agreements/${id}`);
  }

  getMyAgreement(): Observable<LeaseAgreement> {
    return this.http.get<LeaseAgreement>(`${this.baseUrl}/lease-financing/driver/me`);
  }

  createAgreement(payload: Record<string, unknown>): Observable<LeaseAgreement> {
    return this.http.post<LeaseAgreement>(`${this.baseUrl}/lease-agreements`, payload);
  }

  updateAgreement(id: string, payload: Record<string, unknown>): Observable<LeaseAgreement> {
    return this.http.put<LeaseAgreement>(`${this.baseUrl}/lease-agreements/${id}`, payload);
  }

  activateAgreement(id: string): Observable<LeaseAgreement> {
    return this.http.post<LeaseAgreement>(`${this.baseUrl}/lease-agreements/${id}/activate`, {});
  }

  terminateAgreement(id: string, payload: { reason?: string; notes?: string } = {}): Observable<LeaseAgreement> {
    return this.http.post<LeaseAgreement>(`${this.baseUrl}/lease-agreements/${id}/terminate`, payload);
  }

  signAgreement(id: string, payload: Record<string, unknown>): Observable<LeaseAgreement> {
    return this.http.post<LeaseAgreement>(`${this.baseUrl}/lease-agreements/${id}/sign`, payload);
  }

  uploadContract(id: string, file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${this.baseUrl}/lease-agreements/${id}/upload-contract`, formData);
  }

  getSchedule(id: string): Observable<LeaseScheduleRow[]> {
    return this.http.get<LeaseScheduleRow[]>(`${this.baseUrl}/lease-agreements/${id}/payment-schedule`);
  }

  recordManualPayment(id: string, payload: Record<string, unknown>): Observable<LeasePaymentTransaction> {
    return this.http.post<LeasePaymentTransaction>(`${this.baseUrl}/lease-agreements/${id}/manual-payment`, payload);
  }

  getSummary(): Observable<FinancingSummary> {
    return this.http.get<FinancingSummary>(`${this.baseUrl}/lease-financing/dashboard/summary`);
  }

  getCashflow(query: Record<string, string | number | undefined> = {}): Observable<{ rows: any[] }> {
    return this.http.get<{ rows: any[] }>(`${this.baseUrl}/lease-financing/dashboard/cashflow`, {
      params: this.toParams(query)
    });
  }

  getExposure(): Observable<any> {
    return this.http.get(`${this.baseUrl}/lease-financing/dashboard/exposure`);
  }

  getRisk(): Observable<{ counts: { low: number; medium: number; high: number }; rows: RiskRow[]; high_risk_agreements: RiskRow[] }> {
    return this.http.get<{ counts: { low: number; medium: number; high: number }; rows: RiskRow[]; high_risk_agreements: RiskRow[] }>(`${this.baseUrl}/lease-financing/dashboard/risk`);
  }

  private toParams(query: Record<string, string | number | undefined>): HttpParams {
    let params = new HttpParams();
    Object.entries(query || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    });
    return params;
  }
}
