import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { MasterEntity } from './manufacturers.service';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export interface VendorLocation {
  lat: number;
  lng: number;
}

export interface Vendor {
  vendor_id: string;
  tenant_id: string;
  name: string;
  skills: string[];
  capacity: number;
  base_location: VendorLocation | null;
  status: 'active' | 'suspended';
  created_at?: string;
  updated_at?: string;
}

export interface VendorPayload {
  name: string;
  skills: string[];
  capacity: number;
  base_location: VendorLocation | null;
  status?: 'active' | 'suspended';
}

export interface VendorListParams {
  status?: 'active' | 'suspended';
  limit?: number;
  offset?: number;
}

@Injectable({ providedIn: 'root' })
export class VendorsService {
  private readonly baseUrl = `${environment.apiUrl}/vendors`;
  private readonly adminUrl = `${environment.apiUrl}/logistics/vendors`;

  constructor(private http: HttpClient) {}

  // ─── Legacy master-entity vendor search (unchanged) ─────────────────────
  search(q: string, limit = 10): Observable<MasterEntity[]> {
    const params = new HttpParams()
      .set('q', (q ?? '').trim())
      .set('limit', String(limit));
    return this.http
      .get<ApiEnvelope<MasterEntity[]>>(`${this.baseUrl}/search`, { params })
      .pipe(map((r) => (r && r.data) || []));
  }

  create(name: string): Observable<MasterEntity> {
    return this.http
      .post<ApiEnvelope<MasterEntity>>(this.baseUrl, { name: (name ?? '').trim() })
      .pipe(map((r) => r.data));
  }

  // ─── Admin CRUD: logistics-service v2 vendors (FN-1201) ─────────────────
  listVendors(params?: VendorListParams): Observable<Vendor[]> {
    let httpParams = new HttpParams();
    if (params?.status) httpParams = httpParams.set('status', params.status);
    if (params?.limit != null) httpParams = httpParams.set('limit', String(params.limit));
    if (params?.offset != null) httpParams = httpParams.set('offset', String(params.offset));
    return this.http
      .get<ApiEnvelope<Vendor[]>>(this.adminUrl, { params: httpParams })
      .pipe(map((r) => (r && r.data) || []));
  }

  getVendor(vendorId: string): Observable<Vendor> {
    return this.http
      .get<ApiEnvelope<Vendor>>(`${this.adminUrl}/${vendorId}`)
      .pipe(map((r) => r.data));
  }

  createVendor(payload: VendorPayload): Observable<Vendor> {
    return this.http
      .post<ApiEnvelope<Vendor>>(this.adminUrl, payload)
      .pipe(map((r) => r.data));
  }

  updateVendor(vendorId: string, payload: Partial<VendorPayload>): Observable<Vendor> {
    return this.http
      .put<ApiEnvelope<Vendor>>(`${this.adminUrl}/${vendorId}`, payload)
      .pipe(map((r) => r.data));
  }

  setVendorStatus(vendorId: string, status: 'active' | 'suspended'): Observable<Vendor> {
    return this.http
      .patch<ApiEnvelope<Vendor>>(`${this.adminUrl}/${vendorId}/status`, { status })
      .pipe(map((r) => r.data));
  }
}
