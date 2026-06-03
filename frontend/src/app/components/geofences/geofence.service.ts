import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  Geofence,
  GeofenceListFilters,
  GeofenceListResponse,
  GeofencePayload,
} from './geofence.model';

/**
 * GeofenceService — thin HTTP client over the `/api/geofences` CRUD contract
 * (FN-1665). Mirrors the `ApiService` conventions: `environment.apiUrl` base,
 * `URLSearchParams` query building, `{ data, meta }` list envelopes.
 */
@Injectable({ providedIn: 'root' })
export class GeofenceService {
  private readonly baseUrl = `${environment.apiUrl}/geofences`;

  constructor(private http: HttpClient) {}

  /** GET /api/geofences — list with optional active / owned-by / near-point filters. */
  list(filters?: GeofenceListFilters): Observable<GeofenceListResponse> {
    const p = new URLSearchParams();
    if (filters?.active !== undefined) p.set('active', String(filters.active));
    if (filters?.ownedBy) p.set('ownedBy', filters.ownedBy);
    if (filters?.near) {
      p.set('near', `${filters.near.lng},${filters.near.lat}`);
      if (filters.nearRadiusMeters != null) {
        p.set('nearRadiusMeters', String(filters.nearRadiusMeters));
      }
    }
    const qs = p.toString();
    return this.http.get<GeofenceListResponse>(`${this.baseUrl}${qs ? '?' + qs : ''}`);
  }

  /** GET /api/geofences/:id */
  get(id: string): Observable<Geofence> {
    return this.http.get<Geofence>(`${this.baseUrl}/${id}`);
  }

  /** POST /api/geofences */
  create(payload: GeofencePayload): Observable<Geofence> {
    return this.http.post<Geofence>(this.baseUrl, payload);
  }

  /** PUT /api/geofences/:id */
  update(id: string, payload: GeofencePayload): Observable<Geofence> {
    return this.http.put<Geofence>(`${this.baseUrl}/${id}`, payload);
  }

  /** DELETE /api/geofences/:id */
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
