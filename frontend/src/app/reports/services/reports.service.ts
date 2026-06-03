import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  NlParseRequest,
  NlParseResponse,
  ReportAnomaliesRequest,
  ReportAnomaliesResponse,
  ReportChatRequest,
  ReportChatResponse,
  ReportFilters,
  ReportKey,
  ReportNarrative,
  ReportNarrativeRequest,
  ReportResponse
} from '../reports.models';

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly baseUrl = `${environment.apiUrl}/reports/v2`;
  private readonly aiBaseUrl = `${environment.apiUrl}/ai/reports`;

  constructor(private http: HttpClient) {}

  getAnomalies(reportKey: ReportKey, payload: ReportAnomaliesRequest): Observable<ReportAnomaliesResponse> {
    return this.http.post<ReportAnomaliesResponse>(
      `${this.aiBaseUrl}/${encodeURIComponent(reportKey)}/anomalies`,
      payload
    );
  }

  chatWithReport(payload: ReportChatRequest): Observable<ReportChatResponse> {
    return this.http.post<ReportChatResponse>(`${this.aiBaseUrl}/chat`, payload);
  }

  parseNlQuery(
    reportKey: ReportKey,
    naturalQuery: string,
    currentFilters: ReportFilters
  ): Observable<NlParseResponse> {
    const payload: NlParseRequest = { reportKey, naturalQuery, currentFilters };
    return this.http.post<NlParseResponse>(`${this.aiBaseUrl}/parse-query`, payload);
  }

  invalidateCache(): void {
    // server-side cache is key-based; frontend keeps this hook for future client caching
  }

  getReport<T = Record<string, unknown>>(endpoint: string, filters: ReportFilters): Observable<ReportResponse<T>> {
    return this.http.get<ReportResponse<T>>(`${this.baseUrl}/${endpoint}`, {
      params: this.toParams(filters)
    });
  }

  exportReport(reportKey: ReportKey, format: 'csv' | 'pdf', filters: ReportFilters): Observable<Blob> {
    let params = this.toParams(filters).set('format', format);
    if (format === 'pdf') {
      params = params.set('includeNarrative', 'true');
    }
    return this.http.get(`${this.baseUrl}/export/${reportKey}`, {
      params,
      responseType: 'blob'
    });
  }

  getNarrative(reportKey: ReportKey, payload: ReportNarrativeRequest): Observable<ReportNarrative> {
    return this.http.post<ReportNarrative>(`${this.aiBaseUrl}/${reportKey}/narrative`, payload || {});
  }

  // Legacy compatibility methods for old reports component.
  getDashboardKpis(_filters: ReportFilters): Observable<{ success: boolean; data: unknown }> {
    return of({ success: true, data: null });
  }

  getDashboardCharts(_filters: ReportFilters): Observable<{ success: boolean; data: Record<string, unknown> }> {
    return of({ success: true, data: {} });
  }

  getFinancialSummary(_filters: ReportFilters): Observable<{ success: boolean; data: { summary: unknown; revenueByLocation: unknown[] } }> {
    return of({ success: true, data: { summary: null, revenueByLocation: [] } });
  }

  getWorkOrderSummary(_filters: ReportFilters): Observable<{ success: boolean; data: { summary: unknown; byStatus: unknown[] } }> {
    return of({ success: true, data: { summary: null, byStatus: [] } });
  }

  getInventoryStatus(_params: ReportFilters): Observable<{ success: boolean; data: unknown[] }> {
    return of({ success: true, data: [] });
  }

  getLowStock(_params: ReportFilters): Observable<{ success: boolean; data: unknown[] }> {
    return of({ success: true, data: [] });
  }

  getInventoryValuation(_params: ReportFilters): Observable<{ success: boolean; data: unknown[] }> {
    return of({ success: true, data: [] });
  }

  getVehicleSummary(_params: ReportFilters): Observable<{ success: boolean; data: unknown[] }> {
    return of({ success: true, data: [] });
  }

  getVehicleStatus(_params: ReportFilters): Observable<{ success: boolean; data: unknown[] }> {
    return of({ success: true, data: [] });
  }

  getVehicleMaintenance(_params: ReportFilters): Observable<{ success: boolean; data: unknown[] }> {
    return of({ success: true, data: [] });
  }

  getCustomerSummary(_params: ReportFilters): Observable<{ success: boolean; data: unknown[] }> {
    return of({ success: true, data: [] });
  }

  getCustomerActivity(_params: ReportFilters): Observable<{ success: boolean; data: unknown[] }> {
    return of({ success: true, data: [] });
  }

  getCustomerAging(_params: ReportFilters): Observable<{ success: boolean; data: unknown[] }> {
    return of({ success: true, data: [] });
  }

  private toParams(filters: ReportFilters): HttpParams {
    let params = new HttpParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });
    return params;
  }
}
