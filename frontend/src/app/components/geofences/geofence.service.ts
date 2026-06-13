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
  GeofenceRecipientBroker,
  GeofenceRecipientUser,
} from './geofence.model';

/** Raw `/api/users` row (subset consumed by the recipient picker). */
interface RawUser {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  email?: string | null;
}

/** Raw `/api/brokers` row (subset consumed by the recipient picker). */
interface RawBroker {
  id: string;
  name?: string | null;
  display_name?: string | null;
  legal_name?: string | null;
  city?: string | null;
  state?: string | null;
  mc_number?: string | null;
}

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

  /**
   * Internal users available as `user` recipients for a `notify` trigger.
   * Sources `GET /api/users` (the same endpoint user-admin uses) and projects
   * each row down to {@link GeofenceRecipientUser}. Co-located here so the
   * recipient panel depends only on the geofence domain, not on ApiService.
   */
  listUsers(): Observable<GeofenceRecipientUser[]> {
    return this.http
      .get<{ data?: RawUser[] }>(`${environment.apiUrl}/users`)
      .pipe(map((res) => (res?.data ?? []).map(toRecipientUser)));
  }

  /**
   * Brokers available as `broker` recipients. Sources `GET /api/brokers`
   * (a large page — the picker filters client-side) and projects to
   * {@link GeofenceRecipientBroker}.
   */
  listBrokers(): Observable<GeofenceRecipientBroker[]> {
    const p = new URLSearchParams({ page: '1', pageSize: '5000' });
    return this.http
      .get<{ data?: RawBroker[] }>(`${environment.apiUrl}/brokers?${p.toString()}`)
      .pipe(map((res) => (res?.data ?? []).map(toRecipientBroker)));
  }
}

/** Build a display name for a user: full name → username → email → id. */
function toRecipientUser(u: RawUser): GeofenceRecipientUser {
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return {
    id: u.id,
    name: full || (u.username ?? '').trim() || (u.email ?? '').trim() || u.id,
    email: u.email ?? null,
  };
}

/** Build a one-line broker label: "Name / City, ST / MC#" where available. */
function toRecipientBroker(b: RawBroker): GeofenceRecipientBroker {
  const name = (b.display_name || b.name || b.legal_name || '').toString().trim() || '—';
  const loc = [b.city, b.state].filter(Boolean).join(', ');
  const mc = (b.mc_number || '').toString().trim();
  const label = [name, loc, mc].filter(Boolean).join(' / ');
  return { id: b.id, name: label };
}
