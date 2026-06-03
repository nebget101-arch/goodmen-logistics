/**
 * Geofence domain models — FN-1666 (Story B / FN-1654).
 *
 * These types define the frontend ↔ backend contract for `/api/geofences`
 * consumed by `GeofenceService`. The backend CRUD subtask (FN-1665) implements
 * the server side against this same shape. Geometry is storage-agnostic on the
 * wire — whether the DB persists PostGIS geometry or GeoJSON `jsonb` (FN-1664)
 * is a backend-internal decision and does not leak into this contract.
 */

/** Shape of a geofence boundary. */
export type GeofenceKind = 'circle' | 'polygon';

/** Trigger event types (when a vehicle crosses / lingers). */
export type GeofenceEventKind = 'enter' | 'exit' | 'dwell';

/** Action a trigger fires when its event occurs. */
export type GeofenceTriggerAction = 'notify' | 'update_load_status' | 'webhook';

/** A single WGS-84 coordinate. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Maximum number of vertices allowed for a polygon geofence (AC: ≤ 40). */
export const MAX_POLYGON_VERTICES = 40;

/** A trigger attached to a geofence. */
export interface GeofenceTrigger {
  id?: string;
  /** `null`/empty = applies to every vehicle. */
  vehicleId?: string | null;
  eventKind: GeofenceEventKind;
  /** Only meaningful when `eventKind === 'dwell'`. */
  dwellMinutes?: number | null;
  action: GeofenceTriggerAction;
  /** Required when `action === 'webhook'`. */
  targetUrl?: string | null;
}

/** A persisted geofence as returned by the API. */
export interface Geofence {
  id: string;
  name: string;
  kind: GeofenceKind;
  /** Circle only — center point. */
  center?: LatLng | null;
  /** Circle only — radius in meters. */
  radiusMeters?: number | null;
  /** Polygon only — ordered ring of vertices (≤ {@link MAX_POLYGON_VERTICES}). */
  vertices?: LatLng[] | null;
  active?: boolean;
  addressId?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  triggers?: GeofenceTrigger[];
}

/** Request body for create / update (server-managed fields omitted). */
export interface GeofencePayload {
  name: string;
  kind: GeofenceKind;
  center?: LatLng | null;
  radiusMeters?: number | null;
  vertices?: LatLng[] | null;
  active?: boolean;
  triggers?: GeofenceTrigger[];
}

/** Filters accepted by `GET /api/geofences`. */
export interface GeofenceListFilters {
  active?: boolean;
  ownedBy?: string;
  /** Near-point filter — returns geofences close to this coordinate. */
  near?: LatLng;
  /** Radius (meters) bounding the near-point filter. */
  nearRadiusMeters?: number;
}

/** Standard `{ data, meta }` list envelope. */
export interface GeofenceListResponse {
  data: Geofence[];
  meta?: { total?: number };
}
