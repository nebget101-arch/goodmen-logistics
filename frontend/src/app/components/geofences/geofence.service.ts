import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  GeocodeResult,
  Geofence,
  GeofenceListFilters,
  GeofenceListResponse,
  GeofencePayload,
} from './geofence.model';

/** Wire shape of a geocode candidate (snake_case `address_id`). */
interface GeocodeWireResult {
  label: string;
  lat: number;
  lng: number;
  type?: string;
  address_id?: string | null;
}

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
    if (filters?.vehicleId) p.set('vehicle_id', filters.vehicleId);
    const qs = p.toString();
    return this.http.get<GeofenceListResponse>(`${this.baseUrl}${qs ? '?' + qs : ''}`);
  }

  /**
   * GET /api/geofences/geocode — forward-geocode a free-text address (FN-1761).
   * Returns ranked candidates; maps the wire `address_id` to `addressId`.
   */
  geocode(q: string): Observable<GeocodeResult[]> {
    const url = `${this.baseUrl}/geocode?q=${encodeURIComponent(q)}`;
    return this.http
      .get<{ data: GeocodeWireResult[] }>(url)
      .pipe(
        map((res) =>
          (res?.data ?? []).map((r) => ({
            label: r.label,
            lat: r.lat,
            lng: r.lng,
            type: r.type,
            addressId: r.address_id ?? null,
          })),
        ),
      );
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
