import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface InboundEmailAddress {
  address: string;
  is_active: boolean;
}

export type InboundEmailLogStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'rejected_whitelist'
  | 'rejected_rate_limit'
  | 'rejected_virus';

export interface InboundEmailLog {
  id: string;
  from_email: string;
  subject: string | null;
  body_text?: string | null;
  body_html?: string | null;
  received_at: string;
  load_id: string | null;
  load_number?: string | null;
  processing_status: InboundEmailLogStatus;
  error_message?: string | null;
}

export interface InboundEmailWhitelistEntry {
  id: string;
  sender_email: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class InboundEmailService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  private get rootUrl(): string {
    return `${this.baseUrl}/tenants/me/inbound-email`;
  }

  getAddress(): Observable<{ success: boolean; data: InboundEmailAddress }> {
    return this.http.get<{ success: boolean; data: InboundEmailAddress }>(this.rootUrl);
  }

  listLogs(params: { limit?: number; offset?: number } = {}): Observable<{
    success: boolean;
    data: InboundEmailLog[];
    meta?: { total: number };
  }> {
    const search: Record<string, string> = {};
    if (params.limit != null) search['limit'] = String(params.limit);
    if (params.offset != null) search['offset'] = String(params.offset);
    return this.http.get<{ success: boolean; data: InboundEmailLog[]; meta?: { total: number } }>(
      `${this.rootUrl}/logs`,
      { params: search }
    );
  }

  getLog(id: string): Observable<{ success: boolean; data: InboundEmailLog }> {
    return this.http.get<{ success: boolean; data: InboundEmailLog }>(`${this.rootUrl}/logs/${id}`);
  }

  sendTestEmail(): Observable<{ success: boolean; message?: string }> {
    return this.http.post<{ success: boolean; message?: string }>(`${this.rootUrl}/test`, {});
  }

  listWhitelist(): Observable<{ success: boolean; data: InboundEmailWhitelistEntry[] }> {
    return this.http.get<{ success: boolean; data: InboundEmailWhitelistEntry[] }>(
      `${this.rootUrl}/whitelist`
    );
  }

  addWhitelistEntry(senderEmail: string): Observable<{ success: boolean; data: InboundEmailWhitelistEntry }> {
    return this.http.post<{ success: boolean; data: InboundEmailWhitelistEntry }>(
      `${this.rootUrl}/whitelist`,
      { sender_email: senderEmail }
    );
  }

  removeWhitelistEntry(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.rootUrl}/whitelist/${id}`);
  }
}
