import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';
import { WebsocketService } from '../../services/websocket.service';
import {
  BREADCRUMB_WINDOW_HOURS,
  BreadcrumbsResponse,
  VEHICLE_POSITION_EVENT,
  VehiclePositionFilters,
  VehiclePositionPing,
  VehiclePositionsResponse,
} from './vehicle-position.model';

/**
 * VehiclePositionService — HTTP client + WS subscription for the live map
 * (FN-1671), wired to the FN-1672 backend contract. Mirrors {@link GeofenceService}
 * conventions: `environment.apiUrl` base, `URLSearchParams` query building,
 * `{ data, meta }` envelopes. Live pings arrive over the shared
 * {@link WebsocketService}.
 */
@Injectable({ providedIn: 'root' })
export class VehiclePositionService {
  private readonly baseUrl = `${environment.apiUrl}/vehicle-positions`;

  constructor(
    private http: HttpClient,
    private ws: WebsocketService,
  ) {}

  /** GET /api/vehicle-positions — latest ping per vehicle, with optional filters. */
  list(filters?: VehiclePositionFilters): Observable<VehiclePositionsResponse> {
    const p = new URLSearchParams();
    if (filters?.status) p.set('status', filters.status);
    if (filters?.driverId) p.set('driverId', filters.driverId);
    if (filters?.geofenceId) p.set('geofenceId', filters.geofenceId);
    const qs = p.toString();
    return this.http.get<VehiclePositionsResponse>(`${this.baseUrl}${qs ? '?' + qs : ''}`);
  }

  /**
   * GET /api/vehicle-positions/:id/breadcrumbs — recent trail for one vehicle.
   * Defaults to the {@link BREADCRUMB_WINDOW_HOURS}-hour window (AC: last 4h).
   */
  breadcrumbs(vehicleId: string, hours = BREADCRUMB_WINDOW_HOURS): Observable<BreadcrumbsResponse> {
    const p = new URLSearchParams({ hours: String(hours) });
    return this.http.get<BreadcrumbsResponse>(
      `${this.baseUrl}/${encodeURIComponent(vehicleId)}/breadcrumbs?${p.toString()}`,
    );
  }

  /**
   * Live stream of new pings broadcast over the `vehicle:position` WS event.
   * The map merges each lean emission into the marker it already holds so
   * positions update without a refetch. Falls back to `list()` polling via
   * {@link WebsocketService.pollTick$} when the socket drops (handled by the component).
   */
  pings$(): Observable<VehiclePositionPing> {
    return this.ws.on<VehiclePositionPing>(VEHICLE_POSITION_EVENT);
  }
}
