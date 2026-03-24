import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ComplianceDashboardSummary,
  ComplianceGridRow,
  MedicalExpiryRow,
  DriverComplianceResponse,
  ComplianceItem,
  OverdueItem,
  UpcomingItem,
  CompleteItemPayload,
} from '../models/annual-compliance.model';

@Injectable({ providedIn: 'root' })
export class AnnualComplianceService {
  private base: string;

  constructor(private http: HttpClient) {
    this.base = `${environment.apiUrl}/annual-compliance`;
  }

  /** Fleet-wide dashboard summary (card counts, percentages). */
  getDashboardSummary(): Observable<ComplianceDashboardSummary> {
    return this.http.get<ComplianceDashboardSummary>(`${this.base}/dashboard`);
  }

  /** All overdue compliance items across the fleet. */
  getOverdueItems(): Observable<OverdueItem[]> {
    return this.http.get<OverdueItem[]>(`${this.base}/overdue`);
  }

  /** Upcoming compliance items due within N days (default 30). */
  getUpcomingItems(days = 30): Observable<UpcomingItem[]> {
    const params = new HttpParams().set('days', String(days));
    return this.http.get<UpcomingItem[]>(`${this.base}/upcoming`, { params });
  }

  /** Medical cert expiry report with urgency bands. */
  getMedicalExpiryReport(): Observable<MedicalExpiryRow[]> {
    return this.http.get<MedicalExpiryRow[]>(`${this.base}/medical-expiry`);
  }

  /** Compliance grid rows for table display. */
  getComplianceGrid(): Observable<ComplianceGridRow[]> {
    return this.http.get<ComplianceGridRow[]>(`${this.base}/grid`);
  }

  /** Per-driver compliance for a given year. */
  getDriverCompliance(driverId: string, year?: number): Observable<DriverComplianceResponse> {
    let params = new HttpParams();
    if (year != null) {
      params = params.set('year', String(year));
    }
    return this.http.get<DriverComplianceResponse>(`${this.base}/driver/${driverId}`, { params });
  }

  /** Mark a compliance item as complete. */
  completeItem(itemId: string, data: CompleteItemPayload): Observable<ComplianceItem> {
    return this.http.post<ComplianceItem>(`${this.base}/${itemId}/complete`, data);
  }

  /** Generate annual compliance items for all drivers for a given year. */
  generateAnnualItems(year: number): Observable<{ generated: number }> {
    return this.http.post<{ generated: number }>(`${this.base}/generate/${year}`, {});
  }

  /** Export compliance report as CSV (returns blob). */
  exportReport(year?: number): Observable<Blob> {
    let params = new HttpParams();
    if (year != null) {
      params = params.set('year', String(year));
    }
    return this.http.get(`${this.base}/export`, {
      params,
      responseType: 'blob',
    });
  }
}
