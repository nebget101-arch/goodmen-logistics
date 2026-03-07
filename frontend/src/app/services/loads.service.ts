import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
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
  role?: string;
  driver_id?: string | null;
}

export interface BrokerOption {
  id: string;
  name?: string;
  display_name?: string | null;
  legal_name?: string | null;
  mc_number?: string | null;
  dot_number?: string | null;
  city?: string | null;
  state?: string | null;
  dba_name?: string | null;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  zip?: string | null;
  country?: string | null;
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

  deleteAttachment(loadId: string, attachmentId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.baseUrl}/loads/${loadId}/attachments/${attachmentId}`);
  }

  updateAttachment(
    loadId: string,
    attachmentId: string,
    file?: File,
    type?: LoadAttachmentType,
    notes?: string | null
  ): Observable<{ success: boolean; data: LoadAttachment }> {
    const form = new FormData();
    if (file) form.append('file', file);
    if (type) form.append('type', type);
    if (notes !== undefined) form.append('notes', notes ?? '');
    return this.http.put<{ success: boolean; data: LoadAttachment }>(
      `${this.baseUrl}/loads/${loadId}/attachments/${attachmentId}`,
      form
    );
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

  lookupZip(zip: string): Observable<{ success: boolean; data: { zip: string; city: string; state: string; lat?: number; lon?: number } }> {
    return this.http.get<{ success: boolean; data: { zip: string; city: string; state: string; lat?: number; lon?: number } }>(`${this.baseUrl}/geo/zip/${encodeURIComponent(zip)}`);
  }

  /** Get route geometry (GeoJSON coordinates) between waypoints via backend OSRM proxy. */
  getRouteGeometry(waypoints: { lat: number; lon: number }[]): Observable<{ coordinates: [number, number][] } | null> {
    if (waypoints.length < 2) return of(null);
    const waypointsParam = waypoints.map((w) => `${w.lon},${w.lat}`).join(';');
    return this.http.get<{ success: boolean; data?: { coordinates: [number, number][] } }>(`${this.baseUrl}/geo/route`, {
      params: { waypoints: waypointsParam }
    }).pipe(
      map((res) => (res?.data?.coordinates?.length ? res.data : null)),
      catchError(() => of(null))
    );
  }

  getBrokers(search?: string, page = 1, pageSize = 50): Observable<{ success: boolean; data: BrokerOption[]; meta?: { total: number } }> {
    let params = new HttpParams().set('page', String(page)).set('pageSize', String(pageSize));
    if (search != null && search !== '') {
      params = params.set('q', search);
    }
    return this.http.get<{ success: boolean; data: BrokerOption[]; meta?: { total: number } }>(`${this.baseUrl}/brokers`, { params });
  }

  createBroker(payload: Partial<{
    legal_name: string;
    companyName: string;
    dba_name: string;
    mc_number: string;
    dot_number: string;
    phone: string;
    email: string;
    street: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    authority_type: string;
    status: string;
    notes: string;
  }>): Observable<{ success: boolean; data: BrokerOption }> {
    const body: any = { ...payload };
    if (payload?.companyName && !body.legal_name) body.legal_name = payload.companyName;
    return this.http.post<{ success: boolean; data: BrokerOption }>(`${this.baseUrl}/brokers`, body);
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
