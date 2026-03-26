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

// ─── BASIC Detail Interfaces ──────────────────────────────────────────────────

export interface BasicMeasureHistory {
  id: string;
  basic_detail_id: string;
  snapshot_date: string;
  measure_value: number | null;
  history_value: number | null;
  release_type: string | null;
  release_id: number | null;
}

export interface BasicViolation {
  id: string;
  basic_detail_id: string;
  violation_code: string | null;
  description: string | null;
  violation_count: number | null;
  oos_violation_count: number | null;
  severity_weight: number | null;
}

export interface InspectionViolation {
  code: string | null;
  description: string | null;
  weight: number | null;
}

export interface BasicInspection {
  id: string;
  basic_detail_id: string;
  inspection_date: string | null;
  report_number: string | null;
  report_state: string | null;
  plate_number: string | null;
  plate_state: string | null;
  vehicle_type: string | null;
  severity_weight: number | null;
  time_weight: number | null;
  total_weight: number | null;
  violations: InspectionViolation[];
}

export interface BasicDetail {
  id: string;
  monitored_carrier_id: string;
  basic_name: string;
  measure_value: number | null;
  percentile: number | null;
  threshold: number | null;
  safety_event_group: string | null;
  acute_critical_violations: number;
  investigation_results_text: string | null;
  record_period: string | null;
  scraped_at: string;
  measures_history: BasicMeasureHistory[];
  violations: BasicViolation[];
  inspections: BasicInspection[];
}

export interface BasicDetailsResponse {
  basic_details: BasicDetail[];
}

export interface InspectionVehicle {
  unit: string;
  type: string;
  make: string;
  plate_state: string;
  plate_number: string;
  vin: string;
}

export interface InspectionDetailViolation {
  vio_code: string;
  section: string;
  unit: string;
  oos: string;
  description: string;
  included_in_sms: string;
  basic: string;
  reason_not_included: string | null;
}

export interface InspectionDetail {
  id: string;
  monitored_carrier_id: string;
  inspection_id: string;
  report_number: string | null;
  report_state: string | null;
  state: string | null;
  inspection_date: string | null;
  start_time: string | null;
  end_time: string | null;
  level: string | null;
  facility: string | null;
  post_crash: string | null;
  hazmat_placard: string | null;
  vehicles: InspectionVehicle[];
  violations: InspectionDetailViolation[];
  scraped_at: string;
}

export interface InspectionDetailsResponse {
  inspection_details: InspectionDetail[];
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

  triggerBasicDetailScrape(): Observable<{ message: string; job: ScrapeJob }> {
    return this.http.post<{ message: string; job: ScrapeJob }>(`${this.base}/scrape/basic-details`, {});
  }

  triggerCarrierBasicDetailScrape(carrierId: string): Observable<{ message: string; job: ScrapeJob }> {
    return this.http.post<{ message: string; job: ScrapeJob }>(`${this.base}/scrape/${carrierId}/basic-details`, {});
  }

  // ─── Jobs ─────────────────────────────────────────────────────────────────

  getJobs(limit = 20): Observable<ScrapeJob[]> {
    const params = new HttpParams().set('limit', limit);
    return this.http.get<ScrapeJob[]>(`${this.base}/jobs`, { params });
  }

  // ─── Client-facing (my scores) ────────────────────────────────────────────

  // ─── BASIC Details ──────────────────────────────────────────────────────────

  getCarrierBasicDetails(carrierId: string): Observable<BasicDetailsResponse> {
    return this.http.get<BasicDetailsResponse>(`${this.base}/carriers/${carrierId}/basic-details`);
  }

  getCarrierInspectionDetails(carrierId: string): Observable<InspectionDetailsResponse> {
    return this.http.get<InspectionDetailsResponse>(`${this.base}/carriers/${carrierId}/inspection-details`);
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
