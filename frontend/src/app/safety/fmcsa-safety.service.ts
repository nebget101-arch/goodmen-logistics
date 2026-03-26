import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface SmsScores {
  unsafe_driving_score: number | null;
  hos_compliance_score: number | null;
  vehicle_maintenance_score: number | null;
  controlled_substances_score: number | null;
  driver_fitness_score: number | null;
  crash_indicator_score: number | null;
  hazmat_score: number | null;
}

export interface MonitoredCarrier extends SmsScores {
  id: string;
  dot_number: string;
  mc_number: string | null;
  legal_name: string;
  dba_name: string | null;
  monitoring_active: boolean;
  source: string;
  scraped_at: string | null;
  operating_status: string | null;
  safety_rating: string | null;
  total_drivers: number | null;
  total_power_units: number | null;
  bipd_insurance_on_file: string | null;
  cargo_insurance_on_file: string | null;
  bond_insurance_on_file: string | null;
  authority_common: string | null;
  authority_contract: string | null;
  authority_broker: string | null;
}

export interface AlertItem {
  type: 'high_score' | 'insurance_lapse' | 'authority_issue' | 'score_increase';
  carrier_id: string;
  carrier_name: string;
  dot_number: string;
  category?: string;
  score?: number;
  detail?: string;
}

export interface FmcsaDashboard {
  carriers: MonitoredCarrier[];
  alerts: AlertItem[];
  total_carriers: number;
  alerts_count: number;
  last_scrape_job: ScrapeJob | null;
}

export interface SafetySnapshot {
  id: string;
  monitored_carrier_id: string;
  scraped_at: string;
  source: string;
  unsafe_driving_score: number | null;
  hos_compliance_score: number | null;
  vehicle_maintenance_score: number | null;
  controlled_substances_score: number | null;
  driver_fitness_score: number | null;
  crash_indicator_score: number | null;
  hazmat_score: number | null;
  operating_status: string | null;
  authority_common: string | null;
  authority_contract: string | null;
  authority_broker: string | null;
  bipd_insurance_required: string | null;
  bipd_insurance_on_file: string | null;
  cargo_insurance_required: string | null;
  cargo_insurance_on_file: string | null;
  bond_insurance_required: string | null;
  bond_insurance_on_file: string | null;
  safety_rating: string | null;
  safety_rating_date: string | null;
  total_drivers: number | null;
  total_power_units: number | null;
  mcs150_mileage: number | null;
  mcs150_mileage_year: number | null;
  out_of_service_date: string | null;

  // Inspection data (24-month)
  vehicle_inspections: number | null;
  driver_inspections: number | null;
  hazmat_inspections: number | null;
  iep_inspections: number | null;
  vehicle_oos: number | null;
  driver_oos: number | null;
  hazmat_oos: number | null;
  vehicle_oos_rate: string | null;
  driver_oos_rate: string | null;
  hazmat_oos_rate: string | null;
  vehicle_oos_national_avg: string | null;
  driver_oos_national_avg: string | null;
  hazmat_oos_national_avg: string | null;

  // Crash data (24-month)
  crashes_fatal: number | null;
  crashes_injury: number | null;
  crashes_tow: number | null;
  crashes_total: number | null;

  // Carrier operations
  operation_classification: string | null;
  carrier_operation: string | null;
  cargo_carried: string | null;
}

export interface ScrapeJob {
  id: string;
  job_type: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  total_carriers: number;
  completed_count: number;
  failed_count: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  triggered_by: string | null;
  created_at: string;
}

export interface SnapshotHistoryResponse {
  snapshots: SafetySnapshot[];
  total: number;
  limit: number;
  offset: number;
}

export interface MyScoresResponse {
  carriers: MonitoredCarrier[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class FmcsaSafetyService {
  private base: string;

  constructor(private http: HttpClient) {
    this.base = `${environment.apiUrl}/fmcsa/safety`;
  }

  // ─── Internal dashboard ───────────────────────────────────────────────────

  getDashboard(): Observable<FmcsaDashboard> {
    return this.http.get<FmcsaDashboard>(`${this.base}/dashboard`);
  }

  // ─── Carriers CRUD ────────────────────────────────────────────────────────

  getCarriers(): Observable<MonitoredCarrier[]> {
    return this.http.get<MonitoredCarrier[]>(`${this.base}/carriers`);
  }

  addCarrier(data: { dot_number: string; mc_number?: string; legal_name?: string; dba_name?: string }): Observable<MonitoredCarrier> {
    return this.http.post<MonitoredCarrier>(`${this.base}/carriers`, data);
  }

  removeCarrier(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/carriers/${id}`);
  }

  getCarrierHistory(id: string, limit = 30, offset = 0): Observable<SnapshotHistoryResponse> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<SnapshotHistoryResponse>(`${this.base}/carriers/${id}/history`, { params });
  }

  // ─── Scrape triggers ──────────────────────────────────────────────────────

  triggerScrape(): Observable<{ message: string; job: ScrapeJob }> {
    return this.http.post<{ message: string; job: ScrapeJob }>(`${this.base}/scrape`, {});
  }

  triggerCarrierScrape(carrierId: string): Observable<{ message: string; job: ScrapeJob }> {
    return this.http.post<{ message: string; job: ScrapeJob }>(`${this.base}/scrape/${carrierId}`, {});
  }

  // ─── Jobs ─────────────────────────────────────────────────────────────────

  getJobs(limit = 20): Observable<ScrapeJob[]> {
    const params = new HttpParams().set('limit', limit);
    return this.http.get<ScrapeJob[]>(`${this.base}/jobs`, { params });
  }

  // ─── Client-facing (my scores) ────────────────────────────────────────────

  getMyScores(): Observable<MyScoresResponse> {
    return this.http.get<MyScoresResponse>(`${this.base}/my-scores`);
  }

  getMyScoreHistory(dotNumber: string, limit = 30, offset = 0): Observable<SnapshotHistoryResponse> {
    const params = new HttpParams().set('limit', limit).set('offset', offset);
    return this.http.get<SnapshotHistoryResponse>(`${this.base}/my-scores/${dotNumber}/history`, { params });
  }
}
