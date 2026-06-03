/**
 * FN-1678 (Story F — Public tracking page) — contract for the unauthenticated
 * public tracking payload served at `GET /api/track/:token`.
 *
 * This file is the source of truth for the request/response contract between
 * this standalone page and the public read endpoint (FN-1679). The backend
 * applies the broker's `reveal_options` server-side — sensitive fields are
 * omitted (or null) in the response when their toggle is off — so the page
 * never receives data it isn't allowed to show. The page ALSO guards on the
 * same `reveal` flags defensively, so a misbehaving backend can't leak a
 * field the broker disabled.
 *
 * Reveal-toggle key names mirror `share-link.service.ts` / the `load_share_links`
 * table (FN-1674/FN-1675): driverName, vehicleNumber, breadcrumbs, routeLine.
 * Live location, ETA, and the status timeline are ALWAYS shown and are not
 * toggleable.
 */

/** Which optional fields the broker chose to reveal on the public page. */
export interface PublicTrackReveal {
  /** Show the assigned driver's name. Default OFF (privacy). */
  driverName: boolean;
  /** Show the vehicle / unit number. Default OFF (privacy). */
  vehicleNumber: boolean;
  /** Show the historical GPS breadcrumb trail. Default OFF. */
  breadcrumbs: boolean;
  /** Show the planned route polyline. Default ON (not sensitive). */
  routeLine: boolean;
}

/** Coarse delivery lifecycle status — drives the status pill + timeline. */
export type PublicTrackStatus = 'pickup' | 'in_transit' | 'delivered';

/** Timeline node state relative to the load's current progress. */
export type MilestoneState = 'complete' | 'current' | 'upcoming';

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** A single milestone on the pickup → in transit → delivered timeline. */
export interface PublicTrackMilestone {
  key: PublicTrackStatus;
  /** Human label, e.g. "Picked up", "In transit", "Delivered". */
  label: string;
  state: MilestoneState;
  /** ISO timestamp when this milestone was reached; null if not yet reached. */
  timestamp: string | null;
  /** Optional coarse location label, e.g. "Dallas, TX". */
  location?: string | null;
}

/** A historical GPS ping (only present when reveal.breadcrumbs is true). */
export interface PublicTrackBreadcrumb extends GeoPoint {
  /** ISO timestamp of the ping. */
  at: string;
}

/** A named waypoint (origin / destination) with an optional coordinate. */
export interface PublicTrackWaypoint extends Partial<GeoPoint> {
  /** Coarse, public-safe label, e.g. "Dallas, TX". */
  label: string;
}

/**
 * The full public tracking payload. Returned inside an {@link PublicTrackEnvelope}
 * by `GET /api/track/:token` on a 200. All fields here are already filtered by
 * the broker's reveal_options server-side.
 */
export interface PublicTrackPayload {
  /** Public-safe load reference (the load number). */
  loadNumber: string;
  /** Coarse status key. */
  status: PublicTrackStatus;
  /** Human label for the status pill, e.g. "In transit". */
  statusLabel: string;
  /** ISO ETA for delivery; null when not yet estimable. */
  eta: string | null;
  /**
   * ISO timestamp of the most recent position/status update. Drives the
   * "Last updated N min ago" line. Always present.
   */
  lastUpdatedAt: string;
  /** Which optional fields the broker revealed. */
  reveal: PublicTrackReveal;
  /** Current truck position; null when there is no fix yet. */
  currentPosition: GeoPoint | null;
  /** Origin (pickup) waypoint. */
  origin: PublicTrackWaypoint;
  /** Destination (delivery) waypoint. */
  destination: PublicTrackWaypoint;
  /** pickup → in_transit → delivered, with timestamps. Always present. */
  milestones: PublicTrackMilestone[];

  // ── Optional, reveal-gated fields ──────────────────────────────────────
  /** Driver name — present only when reveal.driverName. */
  driverName?: string | null;
  /** Vehicle / unit number — present only when reveal.vehicleNumber. */
  vehicleNumber?: string | null;
  /** Planned route polyline as [lat, lon] pairs — only when reveal.routeLine. */
  routeLine?: [number, number][] | null;
  /** Historical GPS breadcrumbs — only when reveal.breadcrumbs. */
  breadcrumbs?: PublicTrackBreadcrumb[] | null;
}

/** Standard success envelope used across the FleetNeuron API. */
export interface PublicTrackEnvelope {
  success: boolean;
  data: PublicTrackPayload;
}

/**
 * Why the page can't show tracking data. Maps to the endpoint's error codes:
 *   - 'not_found'  → 404 (unknown / malformed token)
 *   - 'gone'       → 410 (expired or revoked link)
 *   - 'error'      → network / 5xx / unexpected
 */
export type PublicTrackErrorReason = 'not_found' | 'gone' | 'error';
