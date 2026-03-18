import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SafetyOverview {
  openIncidents: number;
  openClaims: number;
  totalEstimatedLoss: number;
  totalPaid: number;
  overdueFollowUps: number;
  openIncidentsByOperatingEntity?: Array<{ operating_entity_id: string | null; operating_entity_name: string; count: number }>;
  openClaimsByOperatingEntity?: Array<{ operating_entity_id: string | null; operating_entity_name: string; count: number }>;
}

export interface SafetyIncidentFilters {
  page?: number;
  pageSize?: number;
  status?: string;
  severity?: string;
  incident_type?: string;
  preventability?: string;
  driver_id?: string;
  vehicle_id?: string;
  operating_entity_id?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface SafetyClaimFilters {
  page?: number;
  pageSize?: number;
  status?: string;
  claim_type?: string;
  overdue_only?: boolean;
}

@Injectable({ providedIn: 'root' })
export class SafetyService {
  private base: string;

  constructor(private http: HttpClient) {
    this.base = `${environment.apiUrl}/safety`;
  }

  getOverview(): Observable<SafetyOverview> {
    return this.http.get<SafetyOverview>(`${this.base}/overview`);
  }

  // ─── Incidents ──────────────────────────────────────────────────────────────

  getIncidents(filters: SafetyIncidentFilters = {}): Observable<any> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => { if (v != null && v !== '') params = params.set(k, String(v)); });
    return this.http.get(`${this.base}/incidents`, { params });
  }

  createIncident(data: any): Observable<any> {
    return this.http.post(`${this.base}/incidents`, data);
  }

  getIncident(id: string): Observable<any> {
    return this.http.get(`${this.base}/incidents/${id}`);
  }

  updateIncident(id: string, data: any): Observable<any> {
    return this.http.patch(`${this.base}/incidents/${id}`, data);
  }

  closeIncident(id: string): Observable<any> {
    return this.http.delete(`${this.base}/incidents/${id}`);
  }

  // ─── Child resources ────────────────────────────────────────────────────────

  getParties(incidentId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/incidents/${incidentId}/parties`);
  }
  addParty(incidentId: string, data: any): Observable<any> {
    return this.http.post(`${this.base}/incidents/${incidentId}/parties`, data);
  }
  deleteParty(incidentId: string, partyId: string): Observable<any> {
    return this.http.delete(`${this.base}/incidents/${incidentId}/parties/${partyId}`);
  }

  getWitnesses(incidentId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/incidents/${incidentId}/witnesses`);
  }
  addWitness(incidentId: string, data: any): Observable<any> {
    return this.http.post(`${this.base}/incidents/${incidentId}/witnesses`, data);
  }
  deleteWitness(incidentId: string, witnessId: string): Observable<any> {
    return this.http.delete(`${this.base}/incidents/${incidentId}/witnesses/${witnessId}`);
  }

  getNotes(incidentId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/incidents/${incidentId}/notes`);
  }
  addNote(incidentId: string, data: any): Observable<any> {
    return this.http.post(`${this.base}/incidents/${incidentId}/notes`, data);
  }

  getDocuments(incidentId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/incidents/${incidentId}/documents`);
  }
  uploadDocument(incidentId: string, file: File, documentType: string, claimId?: string): Observable<any> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('document_type', documentType);
    if (claimId) fd.append('claim_id', claimId);
    return this.http.post(`${this.base}/incidents/${incidentId}/documents`, fd);
  }
  deleteDocument(incidentId: string, docId: string): Observable<any> {
    return this.http.delete(`${this.base}/incidents/${incidentId}/documents/${docId}`);
  }

  getTasks(incidentId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/incidents/${incidentId}/tasks`);
  }
  createTask(incidentId: string, data: any): Observable<any> {
    return this.http.post(`${this.base}/incidents/${incidentId}/tasks`, data);
  }
  updateTask(incidentId: string, taskId: string, data: any): Observable<any> {
    return this.http.patch(`${this.base}/incidents/${incidentId}/tasks/${taskId}`, data);
  }
  deleteTask(incidentId: string, taskId: string): Observable<any> {
    return this.http.delete(`${this.base}/incidents/${incidentId}/tasks/${taskId}`);
  }

  getAuditLog(incidentId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/incidents/${incidentId}/audit-log`);
  }

  // ─── Claims ─────────────────────────────────────────────────────────────────

  getIncidentClaims(incidentId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/incidents/${incidentId}/claims`);
  }
  createClaim(incidentId: string, data: any): Observable<any> {
    return this.http.post(`${this.base}/incidents/${incidentId}/claims`, data);
  }

  getClaims(filters: SafetyClaimFilters = {}): Observable<any> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => { if (v != null && v !== '') params = params.set(k, String(v)); });
    return this.http.get(`${this.base}/claims`, { params });
  }
  getClaim(id: string): Observable<any> {
    return this.http.get(`${this.base}/claims/${id}`);
  }
  updateClaim(id: string, data: any): Observable<any> {
    return this.http.patch(`${this.base}/claims/${id}`, data);
  }

  // ─── Global tasks / reports ──────────────────────────────────────────────────

  getAllTasks(filters: { overdue_only?: boolean; status?: string; assigned_to?: string } = {}): Observable<any[]> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => { if (v != null && v !== '') params = params.set(k, String(v)); });
    return this.http.get<any[]>(`${this.base}/tasks`, { params });
  }

  getReports(filters: { dateFrom?: string; dateTo?: string } = {}): Observable<any> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([k, v]) => { if (v != null) params = params.set(k, String(v)); });
    return this.http.get(`${this.base}/reports`, { params });
  }
}
