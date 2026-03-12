import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class RoadsideService {
  private readonly baseUrl = environment.apiUrl?.replace(/\/$/, '');
  private readonly gatewayBaseUrl = this.baseUrl.replace(/\/api\/?$/, '');

  constructor(private http: HttpClient) {}

  createCall(payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/roadside/calls`, payload);
  }

  listCalls(params?: any): Observable<any> {
    return this.http.get(`${this.baseUrl}/roadside/calls`, { params });
  }

  getCall(callId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/roadside/calls/${callId}`);
  }

  getTimeline(callId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/roadside/calls/${callId}/timeline`);
  }

  reverseGeocode(latitude: number, longitude: number): Observable<any> {
    return this.http.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        format: 'jsonv2',
        lat: String(latitude),
        lon: String(longitude)
      }
    });
  }

  setStatus(callId: string, status: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/roadside/calls/${callId}/status`, { status });
  }

  triage(callId: string, payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/roadside/calls/${callId}/triage`, payload);
  }

  assignDispatch(callId: string, payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/roadside/calls/${callId}/dispatch`, payload);
  }

  resolveCall(callId: string, payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/roadside/calls/${callId}/resolve`, payload);
  }

  linkWorkOrder(callId: string, payload: {
    work_order_id?: string;
    auto_create_work_order?: boolean;
    vehicle_id?: string;
    customer_id?: string;
    location_id?: string;
    work_order_type?: string;
    work_order_priority?: string;
    work_order_description?: string;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/roadside/calls/${callId}/work-order`, payload);
  }

  createPublicLink(callId: string, payload?: { ttl_hours?: number }): Observable<any> {
    return this.http.post(`${this.baseUrl}/roadside/calls/${callId}/public-link`, payload || {});
  }

  createMediaUploadUrl(callId: string, payload: {
    file_name: string;
    content_type?: string;
    media_type?: string;
    expires_in_seconds?: number;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/roadside/calls/${callId}/media/upload-url`, payload);
  }

  attachPrivateMedia(callId: string, payload: {
    storage_key: string;
    media_type?: string;
    mime_type?: string;
    size_bytes?: number;
    metadata?: any;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/roadside/calls/${callId}/media`, payload);
  }

  getPublicCall(callId: string, token: string): Observable<any> {
    return this.http.get(`${this.gatewayBaseUrl}/public/roadside/${callId}?token=${encodeURIComponent(token)}`);
  }
  
  updatePublicContext(callId: string, token: string, payload: {
    company_name?: string;
    payment_contact_name?: string;
    payment_email?: string;
    payment_phone?: string;
    unit_number?: string;
    caller_name?: string;
    caller_email?: string;
    caller_phone?: string;
    summary?: string;
    dispatch_location_label?: string;
    location?: {
      latitude: number;
      longitude: number;
      accuracy_meters?: number;
      captured_at?: string;
      source?: string;
    };
  }): Observable<any> {
    return this.http.post(`${this.gatewayBaseUrl}/public/roadside/${callId}/context?token=${encodeURIComponent(token)}`, payload || {});
  }

  createPublicMediaUploadUrl(callId: string, token: string, payload: {
    file_name: string;
    content_type?: string;
    media_type?: string;
    expires_in_seconds?: number;
    uploaded_by_driver_id?: string;
  }): Observable<any> {
    return this.http.post(`${this.gatewayBaseUrl}/public/roadside/${callId}/media/upload-url?token=${encodeURIComponent(token)}`, payload);
  }

  attachMedia(callId: string, token: string, payload: {
    storage_key: string;
    media_type?: string;
    mime_type?: string;
    size_bytes?: number;
    metadata?: any;
  }): Observable<any> {
    return this.http.post(`${this.gatewayBaseUrl}/public/roadside/${callId}/media?token=${encodeURIComponent(token)}`, payload);
  }

  completePublicFlow(callId: string, token: string): Observable<any> {
    return this.http.post(`${this.gatewayBaseUrl}/public/roadside/${callId}/complete?token=${encodeURIComponent(token)}`, {});
  }

  async uploadFileToSignedUrl(uploadUrl: string, file: File): Promise<void> {
    const resp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream'
      },
      body: file
    });
    if (!resp.ok) {
      throw new Error(`Upload failed with status ${resp.status}`);
    }
  }
}
