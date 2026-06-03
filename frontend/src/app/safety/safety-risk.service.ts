import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type RiskTrend = 'improving' | 'stable' | 'worsening';

export interface HighRiskDriver {
  driver_id: string;
  name: string;
  score: number;
  risk_level: RiskLevel;
  trend: RiskTrend;
  calculated_at: string;
}

// FN-504: lightweight badge entry for all scored drivers
export interface DriverRiskBadge {
  driver_id: string;
  score: number;
  risk_level: RiskLevel;
  trend: RiskTrend;
}

export interface FleetRiskSummary {
  total_drivers_scored: number;
  by_level: { low: number; medium: number; high: number; critical: number };
  by_trend: { improving: number; stable: number; worsening: number };
  average_score: number;
  high_risk_drivers: HighRiskDriver[];
  all_scores?: DriverRiskBadge[];
}

export interface CategoryScores {
  mvr?: number;
  psp?: number;
  fmcsa?: number;
  incidents?: number;
  claims?: number;
  hos?: number;
  training?: number;
}

export interface DriverRiskRecord {
  id: string;
  driver_id: string;
  score: number | null;
  risk_level: RiskLevel | null;
  trend: RiskTrend | null;
  category_scores: CategoryScores | null;
  event_count: number;
  calculated_at: string;
}

export interface DriverRiskHistoryRecord {
  id: string;
  score: number;
  risk_level: string;
  trend: string;
  calculated_at: string;
}

export interface DriverRiskScore {
  current: DriverRiskRecord | null;
  history: DriverRiskHistoryRecord[];
}

export interface DriverRiskTimelineEntry {
  score: number;
  risk_level: string;
  trend: string;
  category_scores: CategoryScores;
  calculated_at: string;
}

export interface DriverRiskTimeline {
  driver_id: string;
  timeline: DriverRiskTimelineEntry[];
}

export interface RiskEvent {
  id: string;
  event_type: string;
  event_date: string;
  severity: RiskLevel;
  title: string;
  description: string;
  source_id: string | null;
  source_table: string | null;
  weight_applied: number | null;
  recency_multiplier: number | null;
  score_before: number | null;
  score_after: number | null;
  is_resolved: boolean;
}

export interface DriverRiskEventsResponse {
  driver_id: string;
  data: RiskEvent[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class SafetyRiskService {
  private base = `${environment.apiUrl}/safety/driver-risk-scores`;

  constructor(private http: HttpClient) {}

  getFleetSummary(): Observable<FleetRiskSummary> {
    return this.http.get<FleetRiskSummary>(`${this.base}/fleet-summary`);
  }

  getDriverScore(driverId: string): Observable<DriverRiskScore> {
    return this.http.get<DriverRiskScore>(`${this.base}/${driverId}`);
  }

  getDriverTimeline(driverId: string): Observable<DriverRiskTimeline> {
    return this.http.get<DriverRiskTimeline>(`${this.base}/${driverId}/timeline`);
  }

  getDriverEvents(driverId: string, page = 1, pageSize = 25): Observable<DriverRiskEventsResponse> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<DriverRiskEventsResponse>(`${this.base}/${driverId}/events`, { params });
  }

  recalculate(driverId: string): Observable<DriverRiskRecord> {
    return this.http.post<DriverRiskRecord>(`${this.base}/${driverId}/recalculate`, {});
  }
}
