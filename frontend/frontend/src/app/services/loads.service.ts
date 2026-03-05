import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  LoadsListResponse,
  LoadDetail,
  LoadAttachment,
  LoadAttachmentType,
  LoadAiEndpointExtraction
} from '../models/load-dashboard.model';

export interface LoadFilters {
  status?: string;
  billingStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  driverId?: string;
  brokerId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export interface DriverOption {
  id: string;
  firstName: string;
  lastName: string;
}

export interface EquipmentOption {
  id: string;
  unit_number: string;
  vehicle_type: string;
  status: string;
  make?: string;
  model?: string;
}

export interface UserProfile {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  email?: string;
}

export interface BrokerOption {
  id: string;
  name: string;
  mc_number?: string | null;
  dot_number?: string | null;
  city?: string | null;
  state?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class LoadsService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  listLoads(filters: LoadFilters): Observable<LoadsListResponse> {
    let params = new HttpParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });
    return this.http.get<LoadsListResponse>(`${this.baseUrl}/loads`, { params });
  }

  getLoad(id: string): Observable<{ success: boolean; data: LoadDetail }> {
    return this.http.get<{ success: boolean; data: LoadDetail }>(`${this.baseUrl}/loads/${id}`);
  }

  createLoad(payload: any): Observable<{ success: boolean; data: LoadDetail }> {
    return this.http.post<{ success: boolean; data: LoadDetail }>(`${this.baseUrl}/loads`, payload);
  }

  updateLoad(id: string, payload: any): Observable<{ success: boolean; data: LoadDetail }> {
    return this.http.put<{ success: boolean; data: LoadDetail }>(`${this.baseUrl}/loads/${id}`, payload);
  }

  uploadAttachment(loadId: string, file: File, type: LoadAttachmentType, notes?: string): Observable<{ success: boolean; data: LoadAttachment }> {
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    if (notes) form.append('notes', notes);
    return this.http.post<{ success: boolean; data: LoadAttachment }>(`${this.baseUrl}/loads/${loadId}/attachments`, form);
  }

  getAttachments(loadId: string): Observable<{ success: boolean; data: LoadAttachment[] }> {
    return this.http.get<{ success: boolean; data: LoadAttachment[] }>(`${this.baseUrl}/loads/${loadId}/attachments`);
  }

  getActiveDrivers(): Observable<DriverOption[]> {
    return this.http.get<DriverOption[]>(`${this.baseUrl}/drivers`, { params: { status: 'active' } });
  }

  getEquipment(type: 'truck' | 'trailer'): Observable<{ success: boolean; data: EquipmentOption[] }> {
    return this.http.get<{ success: boolean; data: EquipmentOption[] }>(`${this.baseUrl}/equipment`, { params: { type, status: 'active' } });
  }

  getCurrentUser(): Observable<{ success: boolean; data: UserProfile }> {
    return this.http.get<{ success: boolean; data: UserProfile }>(`${this.baseUrl}/users/me`);
  }

  lookupZip(zip: string): Observable<{ success: boolean; data: { zip: string; city: string; state: string } }> {
    return this.http.get<{ success: boolean; data: { zip: string; city: string; state: string } }>(`${this.baseUrl}/geo/zip/${encodeURIComponent(zip)}`);
  }

  getBrokers(search?: string): Observable<{ success: boolean; data: BrokerOption[] }> {
    let params = new HttpParams();
    if (search != null && search !== '') {
      params = params.set('q', search);
    }
    return this.http.get<{ success: boolean; data: BrokerOption[] }>(`${this.baseUrl}/brokers`, { params });
  }

  aiExtractFromPdf(file: File): Observable<{ success: boolean; data: LoadAiEndpointExtraction }> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ success: boolean; data: LoadAiEndpointExtraction }>(
      `${this.baseUrl}/loads/ai-extract`,
      form
    );
  }
}
