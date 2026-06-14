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

/** Per-required-document state derived from the readiness contract (FN-1782). */
export type ReadinessDocState = 'valid' | 'missing' | 'expired';

/**
 * Response shape of `GET /api/vehicles/:id/readiness` (FN-1782 contract).
 * The required set is server-driven (keyed by vehicle_type) — never hardcode it
 * on the client. `missing` and `expired` are subsets of `requiredDocuments`.
 */
export interface VehicleReadiness {
  vehicleId?: string;
  vehicleType?: 'truck' | 'trailer';
  ready: boolean;
  requiredDocuments: string[];
  missing: string[];
  expired: string[];
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

  /**
   * Fetch DOT document readiness for a vehicle (FN-1782).
   * Backs the activation gate, the readiness checklist, and the list/detail badge.
   */
  getReadiness(vehicleId: string): Observable<VehicleReadiness> {
    return this.http.get<VehicleReadiness>(
      `${this.baseUrl}/vehicles/${vehicleId}/readiness`
    );
  }
}
