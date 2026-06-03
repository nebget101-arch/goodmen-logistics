import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import * as L from 'leaflet';
import 'leaflet-draw';

import { AiSelectOption } from '../../shared/ai-select/ai-select.component';
import { GeofenceService } from './geofence.service';
import {
  Geofence,
  GeofenceKind,
  GeofencePayload,
  GeofenceTrigger,
  LatLng,
  MAX_POLYGON_VERTICES,
} from './geofence.model';

/**
 * GeofencesComponent — the geofence library page (FN-1666).
 *
 * Left: list of saved geofences + an editor form (name, kind, radius, triggers).
 * Right: a Leaflet map with draw controls (leaflet-draw) restricted to circle
 * and polygon. Drawing a shape captures its geometry into the form; saving
 * round-trips through {@link GeofenceService} (`/api/geofences`).
 *
 * FN-317 RCA: every `[options]` binding below is a `readonly` class field — no
 * getter-backed option arrays (they create new references each CD pass and
 * trigger infinite change-detection loops in `app-ai-select`).
 */
@Component({
  selector: 'app-geofences',
  templateUrl: './geofences.component.html',
  styleUrls: ['./geofences.component.scss'],
})
export class GeofencesComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: false }) mapContainer?: ElementRef<HTMLElement>;

  // ── Static option lists (readonly — FN-317) ────────────────────────────
  readonly kindOptions: AiSelectOption<GeofenceKind>[] = [
    { value: 'circle', label: 'Circle' },
    { value: 'polygon', label: 'Polygon' },
  ];
  readonly eventKindOptions: AiSelectOption[] = [
    { value: 'enter', label: 'Enter' },
    { value: 'exit', label: 'Exit' },
    { value: 'dwell', label: 'Dwell' },
  ];
  readonly actionOptions: AiSelectOption[] = [
    { value: 'notify', label: 'Notify' },
    { value: 'update_load_status', label: 'Update load status' },
    { value: 'webhook', label: 'Webhook' },
  ];

  readonly maxVertices = MAX_POLYGON_VERTICES;

  // ── List state ─────────────────────────────────────────────────────────
  geofences: Geofence[] = [];
  loading = false;
  saving = false;
  error = '';

  /** id of the geofence currently being edited; null = creating a new one. */
  editingId: string | null = null;

  // ── Form ────────────────────────────────────────────────────────────────
  form: FormGroup;

  /** Captured geometry (driven by the draw controls, not free-typed). */
  private center: LatLng | null = null;
  private vertices: LatLng[] = [];

  // ── Leaflet ──────────────────────────────────────────────────────────────
  private map: L.Map | null = null;
  private drawnItems: L.FeatureGroup | null = null;
  private drawControl: L.Control.Draw | null = null;

  constructor(
    private fb: FormBuilder,
    private geofenceService: GeofenceService,
    private cdr: ChangeDetectorRef,
  ) {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(120)]],
      kind: ['circle' as GeofenceKind, Validators.required],
      radiusMeters: [{ value: null as number | null, disabled: false }],
      triggers: this.fb.array([]),
    });
  }

  get triggers(): FormArray {
    return this.form.get('triggers') as FormArray;
  }

  get kind(): GeofenceKind {
    return this.form.get('kind')!.value as GeofenceKind;
  }

  get vertexCount(): number {
    return this.vertices.length;
  }

  get vertexLimitReached(): boolean {
    return this.vertices.length > this.maxVertices;
  }

  /** Geometry is valid once a shape has been drawn for the selected kind. */
  get hasGeometry(): boolean {
    return this.kind === 'circle'
      ? this.center != null && !!this.form.get('radiusMeters')!.value
      : this.vertices.length >= 3 && !this.vertexLimitReached;
  }

  ngOnInit(): void {
    this.loadGeofences();
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  loadGeofences(): void {
    this.loading = true;
    this.error = '';
    this.geofenceService.list().subscribe({
      next: (res) => {
        this.geofences = res?.data ?? [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Could not load geofences.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  // ── Map / draw ─────────────────────────────────────────────────────────────
  private initMap(): void {
    const el = this.mapContainer?.nativeElement;
    if (!el || this.map) return;

    const map = L.map(el, { center: [39.5, -98.35], zoom: 4 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
      position: 'topright',
      draw: {
        polyline: false,
        rectangle: false,
        marker: false,
        circlemarker: false,
        circle: { shapeOptions: { color: '#38bdf8', weight: 2 } },
        polygon: {
          allowIntersection: false,
          shapeOptions: { color: '#38bdf8', weight: 2 },
        },
      },
      edit: { featureGroup: drawnItems, remove: true },
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, (e: L.LeafletEvent) => {
      const layer = (e as L.DrawEvents.Created).layer;
      const type = (e as L.DrawEvents.Created).layerType;
      // Single active shape — replace any prior drawing.
      drawnItems.clearLayers();
      drawnItems.addLayer(layer);
      this.captureGeometry(type, layer);
    });

    map.on(L.Draw.Event.EDITED, (e: L.LeafletEvent) => {
      (e as L.DrawEvents.Edited).layers.eachLayer((layer) => {
        this.captureGeometry(this.kind === 'circle' ? 'circle' : 'polygon', layer);
      });
    });

    map.on(L.Draw.Event.DELETED, () => {
      this.center = null;
      this.vertices = [];
      this.form.get('radiusMeters')!.setValue(null);
      this.cdr.markForCheck();
    });

    this.map = map;
    this.drawnItems = drawnItems;
    this.drawControl = drawControl;

    // Map containers that mount inside a flex layout often need a nudge once
    // the browser has settled the final dimensions.
    setTimeout(() => map.invalidateSize(), 150);
  }

  /** Read geometry out of a freshly drawn/edited Leaflet layer into form state. */
  private captureGeometry(type: string, layer: L.Layer): void {
    if (type === 'circle' && layer instanceof L.Circle) {
      const c = layer.getLatLng();
      this.center = { lat: c.lat, lng: c.lng };
      this.vertices = [];
      this.form.get('kind')!.setValue('circle');
      this.form.get('radiusMeters')!.setValue(Math.round(layer.getRadius()));
    } else if (type === 'polygon' && layer instanceof L.Polygon) {
      const ring = layer.getLatLngs()[0] as L.LatLng[];
      this.vertices = ring.map((p) => ({ lat: p.lat, lng: p.lng }));
      this.center = null;
      this.form.get('kind')!.setValue('polygon');
      if (this.vertexLimitReached) {
        this.error = `Polygon exceeds the ${this.maxVertices}-vertex limit (${this.vertices.length}). Simplify the shape.`;
      } else {
        this.error = '';
      }
    }
    this.cdr.markForCheck();
  }

  /** Render an existing geofence's shape onto the map so it can be edited. */
  private renderGeometry(gf: Geofence): void {
    if (!this.map || !this.drawnItems) return;
    this.drawnItems.clearLayers();

    if (gf.kind === 'circle' && gf.center && gf.radiusMeters) {
      const circle = L.circle([gf.center.lat, gf.center.lng], {
        radius: gf.radiusMeters,
        color: '#38bdf8',
        weight: 2,
      });
      this.drawnItems.addLayer(circle);
      this.map.setView([gf.center.lat, gf.center.lng], 12);
    } else if (gf.kind === 'polygon' && gf.vertices?.length) {
      const poly = L.polygon(
        gf.vertices.map((v) => [v.lat, v.lng] as L.LatLngTuple),
        { color: '#38bdf8', weight: 2 },
      );
      this.drawnItems.addLayer(poly);
      this.map.fitBounds(poly.getBounds(), { padding: [30, 30] });
    }
  }

  // ── Triggers (FormArray) ────────────────────────────────────────────────
  addTrigger(trigger?: GeofenceTrigger): void {
    this.triggers.push(
      this.fb.group({
        vehicleId: [trigger?.vehicleId ?? ''],
        eventKind: [trigger?.eventKind ?? 'enter', Validators.required],
        dwellMinutes: [trigger?.dwellMinutes ?? null],
        action: [trigger?.action ?? 'notify', Validators.required],
        targetUrl: [trigger?.targetUrl ?? ''],
      }),
    );
  }

  removeTrigger(index: number): void {
    this.triggers.removeAt(index);
  }

  // ── CRUD actions ───────────────────────────────────────────────────────────
  startCreate(): void {
    this.editingId = null;
    this.error = '';
    this.center = null;
    this.vertices = [];
    this.triggers.clear();
    this.form.reset({ name: '', kind: 'circle', radiusMeters: null });
    this.drawnItems?.clearLayers();
  }

  edit(gf: Geofence): void {
    this.editingId = gf.id;
    this.error = '';
    this.center = gf.center ?? null;
    this.vertices = gf.vertices ? [...gf.vertices] : [];
    this.triggers.clear();
    (gf.triggers ?? []).forEach((t) => this.addTrigger(t));
    this.form.reset({
      name: gf.name,
      kind: gf.kind,
      radiusMeters: gf.radiusMeters ?? null,
    });
    this.renderGeometry(gf);
    this.cdr.markForCheck();
  }

  save(): void {
    if (this.form.invalid || !this.hasGeometry || this.saving) {
      this.form.markAllAsTouched();
      if (!this.hasGeometry) {
        this.error =
          this.kind === 'circle'
            ? 'Draw a circle on the map and set a radius.'
            : `Draw a polygon (3–${this.maxVertices} vertices) on the map.`;
      }
      return;
    }

    const payload = this.toPayload();
    this.saving = true;
    this.error = '';

    const request$ = this.editingId
      ? this.geofenceService.update(this.editingId, payload)
      : this.geofenceService.create(payload);

    request$.subscribe({
      next: () => {
        this.saving = false;
        this.startCreate();
        this.loadGeofences();
      },
      error: () => {
        this.saving = false;
        this.error = 'Save failed. Please try again.';
        this.cdr.markForCheck();
      },
    });
  }

  remove(gf: Geofence): void {
    if (!confirm(`Delete geofence "${gf.name}"?`)) return;
    this.geofenceService.delete(gf.id).subscribe({
      next: () => {
        if (this.editingId === gf.id) this.startCreate();
        this.loadGeofences();
      },
      error: () => {
        this.error = 'Delete failed. Please try again.';
        this.cdr.markForCheck();
      },
    });
  }

  /** Build the API payload from current form + captured geometry. */
  private toPayload(): GeofencePayload {
    const raw = this.form.getRawValue();
    const triggers: GeofenceTrigger[] = (raw.triggers ?? []).map((t: GeofenceTrigger) => ({
      vehicleId: t.vehicleId || null,
      eventKind: t.eventKind,
      dwellMinutes: t.eventKind === 'dwell' ? t.dwellMinutes ?? null : null,
      action: t.action,
      targetUrl: t.action === 'webhook' ? t.targetUrl || null : null,
    }));

    const payload: GeofencePayload = {
      name: (raw.name ?? '').trim(),
      kind: raw.kind,
      active: true,
      triggers,
    };

    if (raw.kind === 'circle') {
      payload.center = this.center;
      payload.radiusMeters = raw.radiusMeters;
    } else {
      payload.vertices = this.vertices;
    }
    return payload;
  }

  /** trackBy for the geofence list. */
  trackById(_: number, gf: Geofence): string {
    return gf.id;
  }
}
