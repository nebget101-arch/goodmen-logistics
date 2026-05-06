import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type ComebackRisk = 'low' | 'medium' | 'high';

export interface RepairHistoryPatternRef {
  workOrderId: string;
  workOrderNumber?: string;
  date?: string;
}

export interface RepairHistoryPattern {
  label: string;
  occurrences: number;
  lastDate?: string | null;
  workOrders: RepairHistoryPatternRef[];
}

export interface RepairHistorySummary {
  vehicleId: string;
  vin?: string | null;
  windowDays: number;
  priorWoCount: number;
  lastVisitDate?: string | null;
  comebackRisk?: ComebackRisk | null;
  insufficientHistory: boolean;
  summary?: string | null;
  patterns: RepairHistoryPattern[];
}

@Injectable({ providedIn: 'root' })
export class VehicleService {
  private readonly baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getRepairHistorySummary(vehicleId: string, windowDays = 365): Observable<RepairHistorySummary> {
    const params = new HttpParams().set('windowDays', String(windowDays));
    return this.http.get<RepairHistorySummary>(
      `${this.baseUrl}/vehicles/${vehicleId}/repair-history-summary`,
      { params }
    );
  }
}
