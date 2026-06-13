import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import * as L from 'leaflet';
import { forkJoin } from 'rxjs';
import { ApiService, VehicleTelemetry } from '../../services/api.service';
import { AiSelectOption } from '../../shared/ai-select/ai-select.component';

interface TruckRow {
  id: string;
  unit_number: string;
}

/**
 * FN-1751 — Vehicle Tracking page (Equipment section).
 *
 * Plain Leaflet 2D map (streets / satellite / terrain switch via
 * `L.control.layers`) + a truck filter (`<app-ai-select>`) + a telemetry
 * panel. Telemetry comes from the FN-1750 provider-agnostic contract
 * (`getVehicleTelemetry` / `getFleetTelemetry`); the backend currently
 * serves deterministic MOCK data behind that contract.
 *
 * No 3D, no Cesium/Mapbox/deck.gl — Leaflet is already a dependency.
 */
@Component({
  selector: 'app-vehicle-tracking',
  templateUrl: './vehicle-tracking.component.html',
  styleUrls: ['./vehicle-tracking.component.scss']
})
export class VehicleTrackingComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('trackingMap') private mapEl?: ElementRef<HTMLDivElement>;

  /**
   * Truck options for the filter dropdown. A stable class field reassigned
   * ONCE after the vehicle list loads — never a getter (FN-317: getter
   * `[options]` bindings cause change-detection loops).
   */
  truckOptions: AiSelectOption<string>[] = [];

  selectedTruckId: string | null = null;

  telemetry: VehicleTelemetry | null = null;

  loadingTrucks = true;
  loadingTelemetry = false;
  trucksError = '';
  telemetryError = '';

  /** Fallback center (continental US) until we have a position to focus. */
  private static readonly DEFAULT_CENTER: L.LatLngExpression = [39.5, -98.35];

  private map?: L.Map;
  private fleetLayer?: L.LayerGroup;
  private selectedMarker?: L.Marker;
  private viewReady = false;
  private trucksById = new Map<string, TruckRow>();
  private fleetTelemetry: VehicleTelemetry[] = [];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadTrucksAndFleet();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.initMap();
    this.renderFleetLayer();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = undefined;
  }

  // ── Data ──────────────────────────────────────────────────────────────
  private loadTrucksAndFleet(): void {
    this.loadingTrucks = true;
    this.trucksError = '';

    forkJoin({
      vehicles: this.api.getVehicles(),
      fleet: this.api.getFleetTelemetry('truck')
    }).subscribe({
      next: ({ vehicles, fleet }) => {
        const trucks: TruckRow[] = (vehicles || [])
          .filter((v: any) => this.isTruck(v?.vehicle_type))
          .map((v: any) => ({ id: String(v.id), unit_number: v.unit_number || '' }));

        this.trucksById.clear();
        trucks.forEach((t) => this.trucksById.set(t.id, t));

        // Sort by unit number for a predictable dropdown; assign ONCE.
        this.truckOptions = trucks
          .slice()
          .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }))
          .map((t) => ({ value: t.id, label: t.unit_number || `Unit ${t.id}` }));

        this.fleetTelemetry = Array.isArray(fleet) ? fleet : [];
        this.loadingTrucks = false;
        this.renderFleetLayer();
      },
      error: (err) => {
        console.error('Vehicle Tracking — failed to load trucks/fleet telemetry:', err);
        this.trucksError = 'Failed to load trucks. Please try again later.';
        this.loadingTrucks = false;
      }
    });
  }

  onTruckChange(id: string | null): void {
    this.selectedTruckId = id;
    this.telemetry = null;
    this.telemetryError = '';
    if (!id) {
      this.clearSelectedMarker();
      return;
    }

    this.loadingTelemetry = true;
    this.api.getVehicleTelemetry(id).subscribe({
      next: (t) => {
        this.telemetry = t;
        this.loadingTelemetry = false;
        this.focusTelemetry(t);
      },
      error: (err) => {
        console.error('Vehicle Tracking — failed to load telemetry:', err);
        this.telemetryError = 'Failed to load telemetry for this truck.';
        this.loadingTelemetry = false;
      }
    });
  }

  // ── Map ───────────────────────────────────────────────────────────────
  private initMap(): void {
    if (this.map || !this.viewReady || !this.mapEl) return;
    const container = this.mapEl.nativeElement;

    const map = L.map(container, {
      center: VehicleTrackingComponent.DEFAULT_CENTER,
      zoom: 4
    });

    // Tile layers — same OSM + ArcGIS World Imagery pattern as
    // loads-dashboard initRouteMap(), plus an optional terrain layer.
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    });
    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri' }
    );
    const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenTopoMap'
    });

    streets.addTo(map);
    L.control.layers(
      { Streets: streets, Satellite: satellite, Terrain: terrain },
      undefined,
      { position: 'topright' }
    ).addTo(map);

    this.fleetLayer = L.layerGroup().addTo(map);
    this.map = map;

    // Container may still be laying out; nudge Leaflet to recompute size.
    setTimeout(() => map.invalidateSize(), 100);

    this.renderFleetLayer();
  }

  /** Plot a small marker for every truck with a last-known position. */
  private renderFleetLayer(): void {
    if (!this.map || !this.fleetLayer) return;
    this.fleetLayer.clearLayers();

    this.fleetTelemetry.forEach((t) => {
      if (!this.hasPosition(t)) return;
      const unit = this.trucksById.get(String(t.vehicle_id))?.unit_number || t.vehicle_id;
      L.marker([t.latitude, t.longitude], { icon: this.fleetIcon() })
        .bindTooltip(`Unit ${unit}`, { direction: 'top', offset: [0, -8] })
        .addTo(this.fleetLayer!);
    });
  }

  /** Drop/refresh the highlighted marker and center the map on the truck. */
  private focusTelemetry(t: VehicleTelemetry): void {
    if (!this.map) return;
    if (!this.hasPosition(t)) return;

    const pos: L.LatLngExpression = [t.latitude, t.longitude];
    this.clearSelectedMarker();

    const unit = this.trucksById.get(String(t.vehicle_id))?.unit_number || t.vehicle_id;
    this.selectedMarker = L.marker(pos, { icon: this.selectedIcon(), zIndexOffset: 1000 })
      .bindTooltip(`Unit ${unit}`, { direction: 'top', offset: [0, -12], permanent: false })
      .addTo(this.map);

    this.map.setView(pos, 11, { animate: true });
  }

  private clearSelectedMarker(): void {
    if (this.selectedMarker) {
      this.selectedMarker.remove();
      this.selectedMarker = undefined;
    }
  }

  private fleetIcon(): L.DivIcon {
    return L.divIcon({
      className: 'vt-fleet-marker',
      html: '<span class="vt-dot"></span>',
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
  }

  private selectedIcon(): L.DivIcon {
    return L.divIcon({
      className: 'vt-selected-marker',
      html: '<span class="vt-pin"></span>',
      iconSize: [24, 24],
      iconAnchor: [12, 22]
    });
  }

  // ── View helpers ──────────────────────────────────────────────────────
  private isTruck(type: string | null | undefined): boolean {
    const normalized = (type || '').toString().trim().toLowerCase();
    // Mirror VehiclesComponent.normalizeVehicleType: anything not a trailer is a truck.
    return !normalized.includes('trailer');
  }

  private hasPosition(t: VehicleTelemetry | null | undefined): boolean {
    return !!t && Number.isFinite(t.latitude) && Number.isFinite(t.longitude);
  }

  /** KPI accent status for the fuel card. */
  get fuelStatus(): 'good' | 'warning' | 'critical' {
    const pct = this.telemetry?.fuel_level_pct ?? 0;
    if (pct <= 15) return 'critical';
    if (pct <= 30) return 'warning';
    return 'good';
  }

  /** Severity → KPI/badge CSS class for fault codes. */
  faultSeverityClass(severity: string): string {
    switch ((severity || '').toLowerCase()) {
      case 'critical':
        return 'vt-sev-critical';
      case 'high':
        return 'vt-sev-high';
      case 'medium':
        return 'vt-sev-medium';
      default:
        return 'vt-sev-low';
    }
  }

  /** Human-readable relative time, e.g. "12 min ago". */
  relativeTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '—';
    const diffMs = Date.now() - then;
    if (diffMs < 0) return 'just now';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  /** Absolute local timestamp for the last-moved subline. */
  absoluteTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : '';
  }

  fuelDisplay(): string {
    const pct = this.telemetry?.fuel_level_pct;
    return Number.isFinite(pct as number) ? `${Math.round(pct as number)}%` : '—';
  }

  positionDisplay(): string {
    if (!this.hasPosition(this.telemetry)) return '—';
    return `${this.telemetry!.latitude.toFixed(4)}, ${this.telemetry!.longitude.toFixed(4)}`;
  }

  speedDisplay(): string {
    const s = this.telemetry?.speed_mph;
    return Number.isFinite(s as number) ? `${Math.round(s as number)} mph` : '—';
  }
}
