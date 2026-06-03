import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as L from 'leaflet';
import 'leaflet.markercluster';

import { AiSelectOption } from '../../shared/ai-select/ai-select.component';
import { LoadsService } from '../../services/loads.service';
import { WebsocketService } from '../../services/websocket.service';
import { GeofenceService } from '../geofences/geofence.service';
import { Geofence } from '../geofences/geofence.model';
import { VehiclePositionService } from './vehicle-position.service';
import {
  BREADCRUMB_WINDOW_HOURS,
  deriveMovementStatus,
  VehicleMovementStatus,
  VehiclePosition,
  VehiclePositionPing,
} from './vehicle-position.model';

/** Marker colour per movement status (AI dark-theme palette — no new hex). */
const STATUS_COLOR: Record<VehicleMovementStatus, string> = {
  moving: '#34d399',
  idle: '#fbbf24',
  offline: '#94a3b8',
};

/** Load statuses that count as a vehicle's "current load" (driving states). */
const ACTIVE_LOAD_STATUSES = new Set(['DISPATCHED', 'EN_ROUTE', 'PICKED_UP', 'IN_TRANSIT']);

/**
 * TrackingMapComponent — the `/tracking` live map (FN-1671).
 *
 * A Leaflet map with a clustered vehicle layer that updates in real time from
 * the shared {@link WebsocketService} (via {@link VehiclePositionService}, wired
 * to the FN-1672 contract). Hovering a vehicle draws its last-{@link
 * BREADCRUMB_WINDOW_HOURS}h breadcrumb trail; clicking opens a side panel
 * (driver, vehicle, current load, ping age, speed, heading, open-load link). A
 * filter bar narrows the layer by driver, movement status, and geofence;
 * geofences also render as a toggleable overlay.
 *
 * The backend positions endpoint serves vehicle metadata but no movement status,
 * driver name, or current load, and the live `vehicle:position` ping is leaner
 * still (geometry only). So this component derives movement status from speed +
 * ping age, resolves driver names from the active-driver list, and looks up the
 * current load on selection — keeping the marker read cheap at 500 vehicles.
 *
 * Performance: markers are clustered (`leaflet.markercluster`) and rendered on a
 * canvas (`preferCanvas`); live pings + filtering mutate the layer imperatively.
 *
 * FN-317 RCA: every `[options]` binding is a plain class field (never a getter)
 * — getter-backed option arrays allocate a new reference each CD pass and drive
 * `app-ai-select` into an infinite change-detection loop.
 */
@Component({
  selector: 'app-tracking-map',
  templateUrl: './tracking-map.component.html',
  styleUrls: ['./tracking-map.component.scss'],
})
export class TrackingMapComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer?: ElementRef<HTMLElement>;

  // ── Filter option lists (FN-317: fields, never getters) ──────────────────
  /** Static movement-status options — `''` empty value = "All statuses". */
  readonly statusOptions: AiSelectOption<VehicleMovementStatus | ''>[] = [
    { value: '', label: 'All statuses' },
    { value: 'moving', label: 'Moving' },
    { value: 'idle', label: 'Idle' },
    { value: 'offline', label: 'Offline' },
  ];
  /** Driver options — populated once on load (a stable, reassigned reference). */
  driverOptions: AiSelectOption[] = [{ value: '', label: 'All drivers' }];
  /** Geofence options — populated once on load. */
  geofenceOptions: AiSelectOption[] = [{ value: '', label: 'All geofences' }];

  // ── Filter state (bound to the filter bar) ───────────────────────────────
  filterDriverId = '';
  filterStatus: VehicleMovementStatus | '' = '';
  filterGeofenceId = '';

  /** Whether the geofence overlay layer is shown on the map. */
  showGeofences = true;

  // ── View state ───────────────────────────────────────────────────────────
  loading = false;
  error = '';
  /** Count of vehicles currently visible after filters (for the header). */
  visibleCount = 0;
  /** Total vehicles loaded (pre-filter). */
  totalCount = 0;
  /** The vehicle whose side panel is open; null = panel closed. */
  selected: VehiclePosition | null = null;
  /** Live socket connection indicator for the header dot. */
  connected = false;

  readonly breadcrumbHours = BREADCRUMB_WINDOW_HOURS;

  // ── Leaflet ────────────────────────────────────────────────────────────────
  private map: L.Map | null = null;
  private clusterGroup: L.MarkerClusterGroup | null = null;
  private geofenceLayer: L.LayerGroup | null = null;
  private breadcrumbLayer: L.LayerGroup | null = null;

  /** Latest known position per vehicle (source of truth for the layer). */
  private positions = new Map<string, VehiclePosition>();
  /** Live marker per vehicle, kept in sync with {@link positions}. */
  private markers = new Map<string, L.Marker>();
  /** Loaded geofences (for the overlay + client-side geofence filter). */
  private geofences: Geofence[] = [];
  /** Driver id → display name (the positions wire carries only `driverId`). */
  private driverNameById = new Map<string, string>();

  private readonly destroy$ = new Subject<void>();

  constructor(
    private vehicleService: VehiclePositionService,
    private geofenceService: GeofenceService,
    private loadsService: LoadsService,
    private ws: WebsocketService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadFilters();
    this.subscribeLive();
  }

  ngAfterViewInit(): void {
    this.initMap();
    this.loadPositions();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.map?.remove();
    this.map = null;
  }

  // ── Map setup ───────────────────────────────────────────────────────────────
  private initMap(): void {
    const el = this.mapContainer?.nativeElement;
    if (!el || this.map) return;

    // `preferCanvas` keeps rendering cheap at 500+ markers.
    const map = L.map(el, { center: [39.5, -98.35], zoom: 4, preferCanvas: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);

    this.geofenceLayer = L.layerGroup();
    this.breadcrumbLayer = L.layerGroup().addTo(map);

    // Cluster nearby vehicles so the layer stays readable + fast.
    this.clusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      maxClusterRadius: 60,
    });
    map.addLayer(this.clusterGroup);

    if (this.showGeofences) this.geofenceLayer.addTo(map);

    this.map = map;
    // Flex-mounted map containers need a nudge once dimensions settle.
    setTimeout(() => map.invalidateSize(), 150);
  }

  // ── Data loading ─────────────────────────────────────────────────────────
  private loadPositions(): void {
    this.loading = true;
    this.error = '';
    this.vehicleService.list().subscribe({
      next: (res) => {
        this.positions.clear();
        (res?.data ?? []).forEach((p) => {
          this.decorate(p);
          this.positions.set(p.vehicleId, p);
        });
        this.totalCount = this.positions.size;
        this.rebuildLayer();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Could not load vehicle positions.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private loadFilters(): void {
    this.loadsService.getActiveDrivers().subscribe({
      next: (drivers) => {
        this.driverNameById.clear();
        (drivers ?? []).forEach((d) => {
          this.driverNameById.set(d.id, `${d.firstName} ${d.lastName}`.trim());
        });
        this.driverOptions = [
          { value: '', label: 'All drivers' },
          ...(drivers ?? []).map((d) => ({
            value: d.id,
            label: `${d.firstName} ${d.lastName}`.trim(),
          })),
        ];
        // Back-fill names onto any positions already loaded.
        this.positions.forEach((p) => this.applyDriverName(p));
        if (this.selected) this.applyDriverName(this.selected);
        this.cdr.markForCheck();
      },
      error: () => { /* non-fatal — leave default "All drivers" */ },
    });

    this.geofenceService.list().subscribe({
      next: (res) => {
        this.geofences = res?.data ?? [];
        this.geofenceOptions = [
          { value: '', label: 'All geofences' },
          ...this.geofences.map((g) => ({ value: g.id, label: g.name })),
        ];
        this.renderGeofenceOverlay();
        this.cdr.markForCheck();
      },
      error: () => { /* non-fatal — overlay + geofence filter simply stay empty */ },
    });
  }

  /** Wire live pings + connection status + polling fallback. */
  private subscribeLive(): void {
    this.vehicleService.pings$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((ping) => this.upsertPosition(ping));

    // The WS service re-enters the Angular zone on status changes.
    this.ws.status$
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => {
        this.connected = status === 'connected';
        this.cdr.markForCheck();
      });

    // When the socket has fallen back to polling, refetch the full set.
    this.ws.pollTick$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadPositions());
  }

  /** Compute derived fields (movement status, driver name) for a wire position. */
  private decorate(p: VehiclePosition): VehiclePosition {
    const age = p.lastPingAgeSeconds ?? this.ageSeconds(p.ts);
    p.movementStatus = deriveMovementStatus(p.speedMph, age);
    this.applyDriverName(p);
    return p;
  }

  private applyDriverName(p: VehiclePosition): void {
    if (p.driverId) p.driverName = this.driverNameById.get(p.driverId) ?? p.driverName ?? null;
  }

  // ── Live updates ───────────────────────────────────────────────────────────
  /**
   * Apply a single lean ping: merge geometry into the position we already hold
   * (preserving metadata), or create a minimal one for a newly-seen vehicle.
   */
  private upsertPosition(ping: VehiclePositionPing): void {
    if (!ping?.vehicleId || ping.lat == null || ping.lng == null) return;
    const prior = this.positions.get(ping.vehicleId);
    const merged: VehiclePosition = {
      ...(prior ?? { vehicleId: ping.vehicleId }),
      vehicleId: ping.vehicleId,
      lat: ping.lat,
      lng: ping.lng,
      speedMph: ping.speedMph ?? null,
      headingDeg: ping.headingDeg ?? null,
      ts: ping.ts,
      lastPingAgeSeconds: 0, // a fresh ping
    };
    this.decorate(merged);
    this.positions.set(ping.vehicleId, merged);
    if (!prior) this.totalCount = this.positions.size;

    const visible = this.matchesFilters(merged);
    const existing = this.markers.get(ping.vehicleId);
    if (existing) {
      if (visible) {
        existing.setLatLng([merged.lat, merged.lng]);
        existing.setIcon(this.iconFor(merged));
      } else {
        this.removeMarker(ping.vehicleId);
      }
    } else if (visible) {
      this.addMarker(merged);
    }

    if (this.selected?.vehicleId === ping.vehicleId) {
      this.selected = { ...merged, loadId: this.selected.loadId, loadReference: this.selected.loadReference };
    }
    this.recomputeVisibleCount();
    this.cdr.markForCheck();
  }

  // ── Layer rendering ────────────────────────────────────────────────────────
  /** Rebuild the entire cluster layer from {@link positions} + current filters. */
  private rebuildLayer(): void {
    if (!this.clusterGroup) return;
    this.clusterGroup.clearLayers();
    this.markers.clear();
    const batch: L.Marker[] = [];
    this.positions.forEach((p) => {
      if (!this.matchesFilters(p)) return;
      const marker = this.buildMarker(p);
      this.markers.set(p.vehicleId, marker);
      batch.push(marker);
    });
    // addLayers (bulk) is markercluster's fast path for large batches.
    this.clusterGroup.addLayers(batch);
    this.recomputeVisibleCount();
  }

  private addMarker(p: VehiclePosition): void {
    if (!this.clusterGroup) return;
    const marker = this.buildMarker(p);
    this.markers.set(p.vehicleId, marker);
    this.clusterGroup.addLayer(marker);
  }

  private removeMarker(vehicleId: string): void {
    const marker = this.markers.get(vehicleId);
    if (marker && this.clusterGroup) this.clusterGroup.removeLayer(marker);
    this.markers.delete(vehicleId);
  }

  /** Build a fully-wired marker (icon + hover trail + click panel) for a vehicle. */
  private buildMarker(p: VehiclePosition): L.Marker {
    const marker = L.marker([p.lat, p.lng], {
      icon: this.iconFor(p),
      title: p.unitNumber ?? p.vehicleId,
    });
    marker.on('mouseover', () => this.zone.run(() => this.showBreadcrumbs(p.vehicleId)));
    marker.on('mouseout', () => this.clearBreadcrumbs());
    marker.on('click', () => this.zone.run(() => this.selectVehicle(p.vehicleId)));
    return marker;
  }

  /** Status-coloured, heading-rotated div icon. */
  private iconFor(p: VehiclePosition): L.DivIcon {
    const status = p.movementStatus ?? 'offline';
    const color = STATUS_COLOR[status];
    const rotation = typeof p.headingDeg === 'number' ? p.headingDeg : null;
    const inner =
      rotation == null
        ? `<span class="veh-dot" style="background:${color}"></span>`
        : `<span class="veh-arrow" style="color:${color};transform:rotate(${rotation}deg)">▲</span>`;
    return L.divIcon({
      className: `veh-marker veh-${status}`,
      html: inner,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }

  // ── Breadcrumbs (hover) ────────────────────────────────────────────────────
  private showBreadcrumbs(vehicleId: string): void {
    this.vehicleService.breadcrumbs(vehicleId, this.breadcrumbHours)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (!this.breadcrumbLayer) return;
          this.breadcrumbLayer.clearLayers();
          const pts = (res?.data ?? [])
            .filter((b) => b.lat != null && b.lng != null)
            .map((b) => [b.lat as number, b.lng as number] as L.LatLngTuple);
          if (pts.length >= 2) {
            L.polyline(pts, { color: '#38bdf8', weight: 2, opacity: 0.85, dashArray: '4 4' })
              .addTo(this.breadcrumbLayer);
          }
        },
        error: () => { /* trail is best-effort — ignore fetch failures */ },
      });
  }

  private clearBreadcrumbs(): void {
    this.breadcrumbLayer?.clearLayers();
  }

  // ── Geofence overlay ───────────────────────────────────────────────────────
  private renderGeofenceOverlay(): void {
    if (!this.geofenceLayer) return;
    this.geofenceLayer.clearLayers();
    this.geofences.forEach((g) => {
      if (g.kind === 'circle' && g.center && g.radiusMeters) {
        L.circle([g.center.lat, g.center.lng], {
          radius: g.radiusMeters,
          color: '#a78bfa',
          weight: 1,
          fillColor: '#a78bfa',
          fillOpacity: 0.08,
        }).bindTooltip(g.name).addTo(this.geofenceLayer!);
      } else if (g.kind === 'polygon' && g.vertices?.length) {
        L.polygon(
          g.vertices.map((v) => [v.lat, v.lng] as L.LatLngTuple),
          { color: '#a78bfa', weight: 1, fillColor: '#a78bfa', fillOpacity: 0.08 },
        ).bindTooltip(g.name).addTo(this.geofenceLayer!);
      }
    });
  }

  toggleGeofences(): void {
    this.showGeofences = !this.showGeofences;
    if (!this.map || !this.geofenceLayer) return;
    if (this.showGeofences) this.geofenceLayer.addTo(this.map);
    else this.map.removeLayer(this.geofenceLayer);
  }

  // ── Selection / side panel ───────────────────────────────────────────────
  private selectVehicle(vehicleId: string): void {
    const p = this.positions.get(vehicleId);
    this.selected = p ? { ...p } : null;
    if (this.selected) this.resolveCurrentLoad(this.selected);
    this.cdr.markForCheck();
  }

  /**
   * Best-effort current-load lookup for the side panel — the positions wire
   * carries no load, so we ask the loads list for the driver's active load.
   */
  private resolveCurrentLoad(p: VehiclePosition): void {
    if (!p.driverId) return;
    this.loadsService.listLoads({ driverId: p.driverId, pageSize: 20 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const item = (res?.data ?? []).find((l) =>
            ACTIVE_LOAD_STATUSES.has(String(l.status).toUpperCase()),
          );
          if (item && this.selected?.vehicleId === p.vehicleId) {
            this.selected = { ...this.selected, loadId: item.id, loadReference: item.load_number };
            this.cdr.markForCheck();
          }
        },
        error: () => { /* load enrichment is best-effort — leave it blank */ },
      });
  }

  closePanel(): void {
    this.selected = null;
  }

  /** Human-friendly "x min ago" for the last-ping age. */
  pingAge(p: VehiclePosition | null): string {
    if (!p) return 'unknown';
    const secs = p.lastPingAgeSeconds != null ? p.lastPingAgeSeconds : this.ageSeconds(p.ts);
    if (secs == null) return 'unknown';
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    return `${hrs}h ago`;
  }

  /** Seconds since an ISO timestamp, or null if unparseable. */
  private ageSeconds(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return null;
    return Math.max(0, Math.round((Date.now() - then) / 1000));
  }

  // ── Filtering ────────────────────────────────────────────────────────────
  /** Re-apply filters after a filter-bar change. */
  onFiltersChanged(): void {
    this.rebuildLayer();
    // Drop the open panel if its vehicle no longer matches.
    if (this.selected && !this.matchesFilters(this.selected)) this.selected = null;
    this.cdr.markForCheck();
  }

  /** True when a position passes all active filters (driver / status / geofence). */
  private matchesFilters(p: VehiclePosition): boolean {
    if (this.filterDriverId && p.driverId !== this.filterDriverId) return false;
    if (this.filterStatus && p.movementStatus !== this.filterStatus) return false;
    if (this.filterGeofenceId) {
      const gf = this.geofences.find((g) => g.id === this.filterGeofenceId);
      if (!gf || !this.isInsideGeofence(p, gf)) return false;
    }
    return true;
  }

  private recomputeVisibleCount(): void {
    this.visibleCount = this.markers.size;
  }

  /** Client-side point-in-geofence test (circle = haversine, polygon = ray cast). */
  private isInsideGeofence(p: VehiclePosition, gf: Geofence): boolean {
    if (gf.kind === 'circle' && gf.center && gf.radiusMeters) {
      return this.haversineMeters(p.lat, p.lng, gf.center.lat, gf.center.lng) <= gf.radiusMeters;
    }
    if (gf.kind === 'polygon' && gf.vertices?.length) {
      return this.pointInPolygon(p.lat, p.lng, gf.vertices);
    }
    return false;
  }

  private haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6_371_000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  private pointInPolygon(lat: number, lng: number, ring: { lat: number; lng: number }[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].lng, yi = ring[i].lat;
      const xj = ring[j].lng, yj = ring[j].lat;
      const intersect =
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
}
