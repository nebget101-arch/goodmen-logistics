import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LoadTemplateListItem {
  id: string;
  name: string;
  description: string | null;
  broker_id: string | null;
  broker_name: string | null;
  first_pickup_city: string | null;
  first_pickup_state: string | null;
  last_delivery_city: string | null;
  last_delivery_state: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at?: string;
}

export interface LoadTemplateDetail extends LoadTemplateListItem {
  template_data: any;
  created_by?: string | null;
}

export interface CreateLoadTemplatePayload {
  load_id: string;
  name: string;
  description?: string | null;
}

export interface UpdateLoadTemplatePayload {
  name?: string;
  description?: string | null;
}

@Injectable({ providedIn: 'root' })
export class LoadTemplatesService {
  private baseUrl = `${environment.apiUrl}/load-templates`;

  constructor(private http: HttpClient) {}

  list(): Observable<{ success: boolean; data: LoadTemplateListItem[] }> {
    return this.http.get<{ success: boolean; data: LoadTemplateListItem[] }>(this.baseUrl);
  }

  get(id: string): Observable<{ success: boolean; data: LoadTemplateDetail }> {
    return this.http.get<{ success: boolean; data: LoadTemplateDetail }>(`${this.baseUrl}/${id}`);
  }

  create(payload: CreateLoadTemplatePayload): Observable<{ success: boolean; data: LoadTemplateDetail }> {
    return this.http.post<{ success: boolean; data: LoadTemplateDetail }>(this.baseUrl, payload);
  }

  update(id: string, payload: UpdateLoadTemplatePayload): Observable<{ success: boolean; data: LoadTemplateDetail }> {
    return this.http.patch<{ success: boolean; data: LoadTemplateDetail }>(`${this.baseUrl}/${id}`, payload);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.baseUrl}/${id}`);
  }

  /** Marks the template as used (bumps last_used_at). Called when "Use Template" is clicked. */
  markUsed(id: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.baseUrl}/${id}/use`, {});
  }
}
