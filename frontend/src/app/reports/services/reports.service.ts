import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { ReportFilters } from '../reports.models';

@Injectable({ providedIn: 'root' })
export class ReportsService {
  constructor() {}

  invalidateCache(): void {
    // Stub: clear any client cache when filters change
  }

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
}
