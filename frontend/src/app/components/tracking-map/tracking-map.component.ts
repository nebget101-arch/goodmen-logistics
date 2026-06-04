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
import {
  GeoJSONSource,
  Map as MaplibreMap,
  Marker,
  NavigationControl,
  Popup,
} from 'maplibre-gl';

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

/** Load statuses that count as a vehicle's "current load" (driving states). */
const ACTIVE_LOAD_STATUSES = new Set(['DISPATCHED', 'EN_ROUTE', 'PICKED_UP', 'IN_TRANSIT']);

/** Geofence overlay tint (AI dark-theme violet — matches the base Leaflet map). */
const GEOFENCE_COLOR = '#a78bfa';
/** Breadcrumb trail tint (AI dark-theme sky-blue — matches the base Leaflet map). */
const BREADCRUMB_COLOR = '#38bdf8';

/** Source / layer ids on the MapLibre style. */
const SRC_GEOFENCES = 'fn-geofences';
const SRC_BREADCRUMB = 'fn-breadcrumb';
const LYR_GEOFENCE_FILL = 'fn-geofence-fill';
const LYR_GEOFENCE_LINE = 'fn-geofence-line';
const LYR_BREADCRUMB_LINE = 'fn-breadcrumb-line';

/** Milliseconds to glide a marker between two pings (so trucks never teleport). */
const MOVE_ANIM_MS = 900;

/** Per-marker tween state for smooth ping-to-ping interpolation. */
interface MarkerTween {
  fromLng: number;
  fromLat: number;
  toLng: number;
  toLat: number;
  start: number;
  dur: number;
}

/**
 * Key-less dark **vector** basemap (CARTO `dark-matter` GL style). FN-1720 used
 * CARTO's `dark_all` *raster* tiles, which carry only the faintest dark-on-dark
 * borders and blur out the moment you zoom past their native tile resolution.
 * This hosted vector style instead ships US state/admin boundaries and place
 * labels (so the map reads as a US map) and stays crisp at street level —
 * vector geometry re-rasterises at every zoom. It needs no API key and keeps
 * the AI dark theme; the 3D *camera* (pitch / rotate / tilt) from FN-1720 rides
 * on top unchanged. See the FN-1717 / FN-1722 story docs for the tradeoff.
 */
const DARK_BASEMAP_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/** Highest zoom the camera allows — vector tiles stay sharp down to street level. */
const MAX_ZOOM = 18;

/**
 * TrackingMapComponent — the `/tracking` live map (FN-1671, re-engined to
 * MapLibre GL in FN-1720 / Story J).
 *
 * A WebGL map (MapLibre GL) with a true 3D camera (default pitch ~50°, free
 * rotate / tilt / zoom) over a dark basemap matching the AI dark theme. Vehicles
 * render as catchy, status-tinted **truck markers** (HTML markers, not Leaflet
 * arrows) that glow/pulse, rotate to `heading_deg`, and glide smoothly between
 * pings via a single `requestAnimationFrame` tween loop (no teleporting). Live
 * positions arrive over the shared {@link WebsocketService} (via {@link
 * VehiclePositionService}); hovering a truck draws its last-{@link
 * BREADCRUMB_WINDOW_HOURS}h breadcrumb trail; clicking opens a side panel. A
 * filter bar narrows by driver, movement status, and geofence; geofences also
 * render as a toggleable GeoJSON overlay.
 *
 * Performance: the map's render loop + the marker tween loop both run *outside*
 * the Angular zone, so smooth 60fps movement at 50+ trucks never thrashes change
 * detection; only user-driven events (click / hover) re-enter the zone.
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
  /** Vehicle the camera is following; null = free camera (FN-1723). */
  followVehicleId: string | null = null;
  /** Unit label of the followed vehicle (for the "Following · Stop" chip). */
  followUnitLabel: string | null = null;

  readonly breadcrumbHours = BREADCRUMB_WINDOW_HOURS;

  // ── MapLibre ───────────────────────────────────────────────────────────────
  private map: MaplibreMap | null = null;
  /** True once the style has loaded and our sources/layers are installed. */
  private styleReady = false;
  /** Reusable popup for the geofence-name hover tooltip. */
  private geofencePopup: Popup | null = null;

  /** Latest known position per vehicle (source of truth for the layer). */
  private positions = new Map<string, VehiclePosition>();
  /** Live truck marker per vehicle, kept in sync with {@link positions}. */
  private markers = new Map<string, Marker>();
  /** Marker root element per vehicle (for cheap status/heading updates). */
  private markerEls = new Map<string, HTMLElement>();
  /** Active position tweens, advanced by the rAF loop. */
  private tweens = new Map<string, MarkerTween>();
  /** Handle for the marker tween loop (runs outside the Angular zone). */
  private rafId: number | null = null;

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
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.markers.forEach((m) => m.remove());
    this.markers.clear();
    this.markerEls.clear();
    this.tweens.clear();
    this.geofencePopup?.remove();
    this.map?.remove();
    this.map = null;
  }

  // ── Map setup ───────────────────────────────────────────────────────────────
  private initMap(): void {
    const el = this.mapContainer?.nativeElement;
    if (!el || this.map) return;

    // MapLibre runs its own internal render loop; create + wire it outside the
    // Angular zone so its rAF ticks never trigger change detection. WebGL is
    // unavailable in some headless/CI contexts — fail soft so the component
    // still constructs (the spec relies on this).
    this.zone.runOutsideAngular(() => {
      try {
        const map = new MaplibreMap({
          container: el,
          style: DARK_BASEMAP_STYLE_URL,
          center: [-98.35, 39.5],
          zoom: 3.5,
          maxZoom: MAX_ZOOM, // street-level vector detail (FN-1723)
          pitch: 0, // top-down by default so markers stay locked to coords on zoom (no tilt parallax)
          bearing: 0,
          maxPitch: 75, // user can still tilt/rotate to 3D via the nav control + drag-rotate
          attributionControl: { compact: true },
        });

        // Navigation control with pitch visualiser → user rotate / tilt / zoom.
        map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
        map.dragRotate.enable();
        map.touchZoomRotate.enableRotation();

        map.on('load', () => this.onMapLoad());

        this.map = map;
      } catch {
        this.zone.run(() => {
          this.error = 'Live map could not start (WebGL unavailable).';
          this.cdr.markForCheck();
        });
      }
    });
  }

  /** Install our sources/layers once the basemap style is ready, then render. */
  private onMapLoad(): void {
    const map = this.map;
    if (!map) return;

    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

    map.addSource(SRC_GEOFENCES, { type: 'geojson', data: empty });
    map.addLayer({
      id: LYR_GEOFENCE_FILL,
      type: 'fill',
      source: SRC_GEOFENCES,
      paint: { 'fill-color': GEOFENCE_COLOR, 'fill-opacity': 0.08 },
    });
    map.addLayer({
      id: LYR_GEOFENCE_LINE,
      type: 'line',
      source: SRC_GEOFENCES,
      paint: { 'line-color': GEOFENCE_COLOR, 'line-width': 1 },
    });

    map.addSource(SRC_BREADCRUMB, { type: 'geojson', data: empty });
    map.addLayer({
      id: LYR_BREADCRUMB_LINE,
      type: 'line',
      source: SRC_BREADCRUMB,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': BREADCRUMB_COLOR,
        'line-width': 2,
        'line-opacity': 0.85,
        'line-dasharray': [2, 2],
      },
    });

    // Geofence-name tooltip on hover (ports the base map's bindTooltip).
    this.geofencePopup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    map.on('mousemove', LYR_GEOFENCE_FILL, (e) => {
      const name = e.features?.[0]?.properties?.['name'];
      if (!name) return;
      map.getCanvas().style.cursor = 'pointer';
      this.geofencePopup!.setLngLat(e.lngLat).setText(String(name)).addTo(map);
    });
    map.on('mouseleave', LYR_GEOFENCE_FILL, () => {
      map.getCanvas().style.cursor = '';
      this.geofencePopup?.remove();
    });

    // A user pan releases follow mode (programmatic easeTo never fires dragstart).
    map.on('dragstart', () => {
      if (this.followVehicleId) this.zone.run(() => this.stopFollow());
    });

    this.styleReady = true;
    this.applyGeofenceVisibility();
    this.renderGeofenceOverlay();
    this.rebuildLayer();

    // Flex-mounted containers need a nudge once dimensions settle.
    setTimeout(() => this.map?.resize(), 150);
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
        this.updateMarkerVisual(ping.vehicleId, merged);
        this.tweenTo(ping.vehicleId, merged.lng, merged.lat); // glide, don't teleport
      } else {
        this.removeMarker(ping.vehicleId);
      }
    } else if (visible) {
      this.addMarker(merged);
    }

    if (this.selected?.vehicleId === ping.vehicleId) {
      this.selected = { ...merged, loadId: this.selected.loadId, loadReference: this.selected.loadReference };
    }
    // Follow mode: keep the camera centered on the followed unit's latest ping.
    if (this.followVehicleId === ping.vehicleId) {
      this.followUnitLabel = merged.unitNumber ?? merged.vehicleId;
      this.flyToVehicle(merged, false);
    }
    this.recomputeVisibleCount();
    this.cdr.markForCheck();
  }

  // ── Marker layer ─────────────────────────────────────────────────────────
  /** Rebuild the entire truck marker layer from {@link positions} + filters. */
  private rebuildLayer(): void {
    if (!this.map) return;
    this.markers.forEach((m) => m.remove());
    this.markers.clear();
    this.markerEls.clear();
    this.tweens.clear();
    this.positions.forEach((p) => {
      if (this.matchesFilters(p)) this.addMarker(p);
    });
    this.recomputeVisibleCount();
  }

  private addMarker(p: VehiclePosition): void {
    if (!this.map) return;
    const el = this.buildMarkerEl(p);
    const marker = new Marker({
      element: el,
      rotationAlignment: 'map', // heading is true-north, rotate with the camera
      pitchAlignment: 'viewport', // keep the truck upright/readable when tilted
    })
      .setLngLat([p.lng, p.lat])
      .setRotation(typeof p.headingDeg === 'number' ? p.headingDeg : 0)
      .addTo(this.map);
    this.markers.set(p.vehicleId, marker);
    this.markerEls.set(p.vehicleId, el);
  }

  private removeMarker(vehicleId: string): void {
    this.markers.get(vehicleId)?.remove();
    this.markers.delete(vehicleId);
    this.markerEls.delete(vehicleId);
    this.tweens.delete(vehicleId);
  }

  /** Build the truck marker DOM: glow halo + rotatable truck glyph + handlers. */
  private buildMarkerEl(p: VehiclePosition): HTMLElement {
    const el = document.createElement('div');
    el.className = `fn-truck ${this.statusClass(p)}`;
    el.title = p.unitNumber ?? p.vehicleId;
    el.innerHTML = `
      <span class="fn-truck-glow"></span>
      <svg class="fn-truck-ico" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
        <path class="fn-truck-body" d="M12 1.6l3 3.1H9l3-3.1zM8.4 5h7.2c.9 0 1.6.7 1.6 1.6v13c0 .8-.6 1.4-1.4 1.4H8.2c-.8 0-1.4-.6-1.4-1.4v-13C6.8 5.7 7.5 5 8.4 5z"/>
      </svg>`;
    el.addEventListener('click', () => this.zone.run(() => this.selectVehicle(p.vehicleId)));
    el.addEventListener('mouseenter', () => this.zone.run(() => this.showBreadcrumbs(p.vehicleId)));
    el.addEventListener('mouseleave', () => this.clearBreadcrumbs());
    return el;
  }

  /** Cheaply update an existing marker's status tint + heading (no rebuild). */
  private updateMarkerVisual(vehicleId: string, p: VehiclePosition): void {
    const el = this.markerEls.get(vehicleId);
    if (el) el.className = `fn-truck ${this.statusClass(p)}`;
    if (typeof p.headingDeg === 'number') this.markers.get(vehicleId)?.setRotation(p.headingDeg);
  }

  private statusClass(p: VehiclePosition): string {
    return `fn-${p.movementStatus ?? 'offline'}`;
  }

  // ── Smooth movement (rAF tween, outside the Angular zone) ──────────────────
  /** Glide a marker from its current position to a new ping over {@link MOVE_ANIM_MS}. */
  private tweenTo(vehicleId: string, toLng: number, toLat: number): void {
    const marker = this.markers.get(vehicleId);
    if (!marker) return;
    const from = marker.getLngLat();
    this.tweens.set(vehicleId, {
      fromLng: from.lng,
      fromLat: from.lat,
      toLng,
      toLat,
      start: performance.now(),
      dur: MOVE_ANIM_MS,
    });
    this.ensureTweenLoop();
  }

  private ensureTweenLoop(): void {
    if (this.rafId != null || !this.map) return;
    this.zone.runOutsideAngular(() => {
      const step = (now: number) => {
        let active = false;
        this.tweens.forEach((t, id) => {
          const raw = Math.min(1, (now - t.start) / t.dur);
          const e = raw * (2 - raw); // easeOutQuad
          const lng = t.fromLng + (t.toLng - t.fromLng) * e;
          const lat = t.fromLat + (t.toLat - t.fromLat) * e;
          this.markers.get(id)?.setLngLat([lng, lat]);
          if (raw >= 1) this.tweens.delete(id);
          else active = true;
        });
        this.rafId = active ? requestAnimationFrame(step) : null;
      };
      this.rafId = requestAnimationFrame(step);
    });
  }

  // ── Breadcrumbs (hover) ────────────────────────────────────────────────────
  private showBreadcrumbs(vehicleId: string): void {
    this.vehicleService.breadcrumbs(vehicleId, this.breadcrumbHours)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const coords = (res?.data ?? [])
            .filter((b) => b.lat != null && b.lng != null)
            .map((b) => [b.lng as number, b.lat as number]);
          const fc: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: coords.length >= 2
              ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }]
              : [],
          };
          this.setSourceData(SRC_BREADCRUMB, fc);
        },
        error: () => { /* trail is best-effort — ignore fetch failures */ },
      });
  }

  private clearBreadcrumbs(): void {
    this.setSourceData(SRC_BREADCRUMB, { type: 'FeatureCollection', features: [] });
  }

  // ── Geofence overlay ───────────────────────────────────────────────────────
  private renderGeofenceOverlay(): void {
    if (!this.styleReady) return;
    this.setSourceData(SRC_GEOFENCES, this.geofenceFeatureCollection());
  }

  /** Build a GeoJSON FeatureCollection for the geofence overlay. */
  private geofenceFeatureCollection(): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    this.geofences.forEach((g) => {
      if (g.kind === 'circle' && g.center && g.radiusMeters) {
        features.push({
          type: 'Feature',
          properties: { name: g.name },
          geometry: {
            type: 'Polygon',
            coordinates: [this.circleRing(g.center.lat, g.center.lng, g.radiusMeters)],
          },
        });
      } else if (g.kind === 'polygon' && g.vertices?.length) {
        const ring = g.vertices.map((v) => [v.lng, v.lat]);
        ring.push(ring[0]); // close the ring
        features.push({
          type: 'Feature',
          properties: { name: g.name },
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
      }
    });
    return { type: 'FeatureCollection', features };
  }

  /** Approximate a metres-radius circle as a 64-gon ring of [lng, lat] points. */
  private circleRing(lat: number, lng: number, radiusMeters: number, steps = 64): number[][] {
    const ring: number[][] = [];
    const R = 6_378_137;
    const d = radiusMeters / R;
    const latR = (lat * Math.PI) / 180;
    const lngR = (lng * Math.PI) / 180;
    for (let i = 0; i <= steps; i++) {
      const brng = (i / steps) * 2 * Math.PI;
      const lat2 = Math.asin(
        Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(brng),
      );
      const lng2 =
        lngR +
        Math.atan2(
          Math.sin(brng) * Math.sin(d) * Math.cos(latR),
          Math.cos(d) - Math.sin(latR) * Math.sin(lat2),
        );
      ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
    }
    return ring;
  }

  toggleGeofences(): void {
    this.showGeofences = !this.showGeofences;
    this.applyGeofenceVisibility();
  }

  private applyGeofenceVisibility(): void {
    if (!this.map || !this.styleReady) return;
    const vis = this.showGeofences ? 'visible' : 'none';
    this.map.setLayoutProperty(LYR_GEOFENCE_FILL, 'visibility', vis);
    this.map.setLayoutProperty(LYR_GEOFENCE_LINE, 'visibility', vis);
  }

  /** Set a GeoJSON source's data, guarding for style-ready + source presence. */
  private setSourceData(id: string, data: GeoJSON.FeatureCollection): void {
    if (!this.map || !this.styleReady) return;
    const src = this.map.getSource(id) as GeoJSONSource | undefined;
    src?.setData(data);
  }

  // ── Selection / side panel ───────────────────────────────────────────────
  private selectVehicle(vehicleId: string): void {
    const p = this.positions.get(vehicleId);
    this.selected = p ? { ...p } : null;
    if (this.selected) {
      this.resolveCurrentLoad(this.selected);
      this.enterFollow(vehicleId); // clicking a unit follows it (FN-1723)
    }
    this.cdr.markForCheck();
  }

  // ── Follow-the-unit camera (FN-1723) ───────────────────────────────────────
  /**
   * Enter "follow" mode for a vehicle: frame it now and re-center on every new
   * ping until the user stops following, deselects, or pans the map.
   */
  private enterFollow(vehicleId: string): void {
    this.followVehicleId = vehicleId;
    const p = this.positions.get(vehicleId);
    this.followUnitLabel = p ? (p.unitNumber ?? p.vehicleId) : vehicleId;
    if (p) this.flyToVehicle(p, true);
  }

  /** Stop following — the chip "Stop", a panel close, or a user pan all land here. */
  stopFollow(): void {
    if (!this.followVehicleId) return;
    this.followVehicleId = null;
    this.followUnitLabel = null;
    this.cdr.markForCheck();
  }

  /**
   * Ease the camera to a vehicle. On the first follow we frame it at a
   * street-ish zoom; on live re-centers we keep the user's current
   * zoom/pitch/bearing and only slide the center. Runs outside the Angular zone
   * (easeTo drives its own rAF) so the glide never thrashes change detection.
   */
  private flyToVehicle(p: VehiclePosition, initial: boolean): void {
    const map = this.map;
    if (!map || p.lat == null || p.lng == null) return;
    this.zone.runOutsideAngular(() => {
      map.easeTo({
        center: [p.lng, p.lat],
        zoom: initial ? Math.max(map.getZoom(), 11) : map.getZoom(),
        duration: initial ? 800 : 600,
      });
    });
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
    this.stopFollow(); // deselecting releases the camera (FN-1723)
  }

  /** Google Maps deep-link for a vehicle's current coordinate (opens a new tab). */
  mapsUrl(p: VehiclePosition | null): string {
    if (!p || p.lat == null || p.lng == null) return '';
    return `https://www.google.com/maps?q=${p.lat},${p.lng}`;
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
    // Drop the open panel (and release follow) if its vehicle no longer matches.
    if (this.selected && !this.matchesFilters(this.selected)) {
      this.selected = null;
      this.stopFollow();
    }
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
