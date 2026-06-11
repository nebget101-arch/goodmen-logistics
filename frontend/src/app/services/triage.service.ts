import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TriageRecord {
  id: string;
  incident_id: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: string;
  urgency: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  vendor_skills: string[];
  rationale: string;
  prompt_version: string;
  model_name: string;
  created_at: string;
}

export interface TriageOverrideRequest {
  hint?: string;
}

@Injectable({ providedIn: 'root' })
export class TriageService {
  private readonly baseUrl = environment.apiUrl?.replace(/\/$/, '');

  constructor(private http: HttpClient) {}

  getTriage(incidentId: string): Observable<TriageRecord> {
    return this.http.get<TriageRecord>(`${this.baseUrl}/incidents/${incidentId}/triage`);
  }

  overrideTriage(incidentId: string, payload: TriageOverrideRequest): Observable<TriageRecord> {
    return this.http.post<TriageRecord>(
      `${this.baseUrl}/incidents/${incidentId}/triage/override`,
      payload
    );
  }
}
