/**
 * Vehicle-position domain models — FN-1671 (Story D / FN-1656).
 *
 * Mirrors the contract served by the backend positions subtask (FN-1672),
 * verified against `backend/packages/goodmen-shared/routes/vehicle-positions.js`:
 *   - `GET /api/vehicle-positions`                  → latest ping per vehicle
 *   - `GET /api/vehicle-positions/:id/breadcrumbs?hours=4` → recent trail
 *   - WS `vehicle:position`                          → a single lean ping (live)
 *
 * Coordinates are WGS-84. Timestamps are ISO-8601 strings.
 *
 * NOTE: the wire `status` is the *vehicle lifecycle* status (e.g. `active`),
 * NOT movement. The AC's moving/idle/offline {@link VehicleMovementStatus} is
 * derived client-side via {@link deriveMovementStatus} from speed + ping age,
 * because the lean live ping carries neither status nor driver/load metadata.
 */

/** Movement state shown on the map — derived client-side. */
export type VehicleMovementStatus = 'moving' | 'idle' | 'offline';

/**
 * A vehicle's latest position, as returned by `GET /api/vehicle-positions`,
 * plus client-side enrichment fields populated by the component.
 */
export interface VehiclePosition {
  vehicleId: string;
  /** Unit number / nickname — the marker + panel label. */
  unitNumber?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  vehicleType?: string | null;
  /** Vehicle lifecycle status (e.g. `active`) — NOT movement status. */
  status?: string | null;
  driverId?: string | null;
  lat: number;
  lng: number;
  /** Ground speed in mph, when reported. */
  speedMph?: number | null;
  /** Heading in degrees clockwise from true north (0–359), when reported. */
  headingDeg?: number | null;
  /** ISO timestamp of the most recent ping. */
  ts: string | null;
  /** Server-computed age of the latest ping, in seconds. */
  lastPingAgeSeconds?: number | null;

  // ── Client-side enrichment (not from the positions endpoint) ──────────────
  /** Movement status derived from {@link deriveMovementStatus}. */
  movementStatus?: VehicleMovementStatus;
  /** Driver display name, resolved from the active-driver list (no name on the wire). */
  driverName?: string | null;
  /** Best-effort current load id, resolved on selection. */
  loadId?: string | null;
  /** Display reference for the current load (e.g. load number). */
  loadReference?: string | null;
}

/**
 * Lean live-ping payload broadcast over the `vehicle:position` WS event by the
 * backend (`websocket.service.emitVehiclePosition`). Carries geometry only —
 * the component merges it into the richer {@link VehiclePosition} it already holds.
 */
export interface VehiclePositionPing {
  vehicleId: string;
  lat: number | null;
  lng: number | null;
  speedMph?: number | null;
  headingDeg?: number | null;
  ts: string | null;
}

/** A single historical point on a vehicle's breadcrumb trail. */
export interface Breadcrumb {
  lat: number | null;
  lng: number | null;
  speedMph?: number | null;
  headingDeg?: number | null;
  /** ISO timestamp the point was recorded. */
  ts: string | null;
}

/** Filters accepted by `GET /api/vehicle-positions`. */
export interface VehiclePositionFilters {
  /** Vehicle lifecycle status (matches `vehicles.status`). */
  status?: string;
  /** Restrict to a single driver (`vehicles.leased_driver_id`). */
  driverId?: string;
  /** Restrict to vehicles currently inside the given geofence. */
  geofenceId?: string;
}

/** Standard `{ data, meta }` list envelope for positions. */
export interface VehiclePositionsResponse {
  data: VehiclePosition[];
  meta?: Record<string, unknown>;
}

/** `{ data, meta }` envelope for a breadcrumb trail. */
export interface BreadcrumbsResponse {
  data: Breadcrumb[];
  meta?: Record<string, unknown>;
}

/** Server WS event name for a single new ping (matches FN-1672). */
export const VEHICLE_POSITION_EVENT = 'vehicle:position';

/** Hours of breadcrumb history to request on hover (AC: last 4h). */
export const BREADCRUMB_WINDOW_HOURS = 4;

/** Speed (mph) above which a vehicle counts as moving. */
export const MOVING_SPEED_MPH = 1;
/** A ping older than this (seconds) marks the vehicle offline. */
export const OFFLINE_AFTER_SECONDS = 15 * 60;

/**
 * Derive moving / idle / offline from speed + ping age. A stale ping wins
 * (offline) regardless of its last reported speed.
 */
export function deriveMovementStatus(
  speedMph: number | null | undefined,
  ageSeconds: number | null | undefined,
): VehicleMovementStatus {
  if (ageSeconds != null && ageSeconds > OFFLINE_AFTER_SECONDS) return 'offline';
  if ((speedMph ?? 0) > MOVING_SPEED_MPH) return 'moving';
  return 'idle';
}
