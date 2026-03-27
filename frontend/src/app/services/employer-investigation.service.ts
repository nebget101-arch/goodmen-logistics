import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface EmployerResponse {
  id: string;
  responseType: string;
  receivedVia: string;
  documentId: string | null;
  createdAt: string;
}

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
  responses: EmployerResponse[];
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
    return this.http.get<any>(`${this.baseUrl}/driver/${driverId}`).pipe(
      map((resp: any) => {
        // FN-232: Map API response to frontend InvestigationStatus interface
        const employers = resp.employers || resp.pastEmployers || [];
        return {
          driverId: resp.driver?.id || driverId,
          overallStatus: resp.driver?.investigationFileStatus || 'not_started',
          completedCount: resp.summary?.completedEmployers ?? resp.completedCount ?? 0,
          totalCount: resp.summary?.totalEmployers ?? resp.totalCount ?? 0,
          pastEmployers: employers.map((e: any) => ({
            id: e.id,
            driverId: e.driverId || driverId,
            employerName: e.employerName || e.employer_name || '',
            contactName: e.contactName || e.contact_name || '',
            contactEmail: e.contactEmail || e.contact_email || '',
            contactPhone: e.contactPhone || e.contact_phone || '',
            dotRegulated: e.dotRegulated ?? e.isDotRegulated ?? e.is_dot_regulated ?? false,
            status: e.investigationStatus || e.status || 'not_started',
            deadline: e.deadlineDate || e.deadline || '',
            inquirySentAt: e.inquirySentAt || e.inquiry_sent_at || null,
            followUpSentAt: e.followUpSentAt || e.follow_up_sent_at || null,
            responseReceivedAt: e.responseReceivedAt || e.response_received_at || null,
            noResponseDocumentedAt: e.noResponseDocumentedAt || null,
            completedAt: e.completedAt || null,
            notes: e.notes || '',
            responses: (e.responses || []).map((r: any) => ({
              id: r.id,
              responseType: r.response_type || r.responseType || '',
              receivedVia: r.received_via || r.receivedVia || '',
              documentId: r.document_id || r.documentId || null,
              createdAt: r.created_at || r.createdAt || ''
            })),
            createdAt: e.createdAt || e.created_at || '',
            updatedAt: e.updatedAt || e.updated_at || ''
          }))
        } as InvestigationStatus;
      })
    );
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

  downloadResponseDocument(documentId: string): Observable<Blob> {
    return this.http.get(`${environment.apiUrl}/dqf/documents/${documentId}/download`, {
      responseType: 'blob'
    });
  }
}
