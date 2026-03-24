import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PastEmployerInvestigation {
  id: string;
  driverId: string;
  employerName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  dotRegulated: boolean;
  status: 'not_started' | 'inquiry_sent' | 'follow_up_sent' | 'response_received' | 'no_response_documented' | 'complete';
  deadline: string;
  inquirySentAt: string | null;
  followUpSentAt: string | null;
  responseReceivedAt: string | null;
  noResponseDocumentedAt: string | null;
  completedAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvestigationStatus {
  driverId: string;
  overallStatus: 'not_started' | 'in_progress' | 'complete';
  completedCount: number;
  totalCount: number;
  pastEmployers: PastEmployerInvestigation[];
}

export interface RecordResponsePayload {
  responseType: string;
  receivedVia: string;
  notes: string;
  documentId?: string;
}

export interface HistoryFileEntry {
  id: string;
  driverId: string;
  entryType: 'inquiry_sent' | 'follow_up_sent' | 'response_received' | 'no_response_documented' | 'investigation_initiated' | 'investigation_completed';
  summary: string;
  employerName: string;
  createdBy: string;
  createdAt: string;
  documentId: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class EmployerInvestigationService {
  private baseUrl = `${environment.apiUrl}/employer-investigations`;

  constructor(private http: HttpClient) {}

  getInvestigationStatus(driverId: string): Observable<InvestigationStatus> {
    return this.http.get<InvestigationStatus>(`${this.baseUrl}/driver/${driverId}`);
  }

  initiateInvestigation(driverId: string): Observable<InvestigationStatus> {
    return this.http.post<InvestigationStatus>(`${this.baseUrl}/driver/${driverId}/initiate`, {});
  }

  sendInquiry(pastEmployerId: string): Observable<PastEmployerInvestigation> {
    return this.http.post<PastEmployerInvestigation>(`${this.baseUrl}/${pastEmployerId}/send-inquiry`, {});
  }

  sendFollowUp(pastEmployerId: string): Observable<PastEmployerInvestigation> {
    return this.http.post<PastEmployerInvestigation>(`${this.baseUrl}/${pastEmployerId}/send-follow-up`, {});
  }

  recordResponse(pastEmployerId: string, data: RecordResponsePayload): Observable<PastEmployerInvestigation> {
    return this.http.post<PastEmployerInvestigation>(`${this.baseUrl}/${pastEmployerId}/record-response`, data);
  }

  documentNoResponse(pastEmployerId: string, notes: string): Observable<PastEmployerInvestigation> {
    return this.http.post<PastEmployerInvestigation>(`${this.baseUrl}/${pastEmployerId}/document-no-response`, { notes });
  }

  getOverdue(): Observable<PastEmployerInvestigation[]> {
    return this.http.get<PastEmployerInvestigation[]>(`${this.baseUrl}/overdue`);
  }

  getHistoryFile(driverId: string): Observable<HistoryFileEntry[]> {
    return this.http.get<HistoryFileEntry[]>(`${this.baseUrl}/driver/${driverId}/history-file`);
  }
}
