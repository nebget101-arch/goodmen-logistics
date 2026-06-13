import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AbstractControl, FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import * as L from 'leaflet';
import 'leaflet-draw';

import { ApiService } from '../../services/api.service';
import { AiSegment } from '../../shared/ai-segmented-control/ai-segmented-control.component';
import { AiSelectOption } from '../../shared/ai-select/ai-select.component';
import { GeofenceService } from './geofence.service';
import {
  GeocodeResult,
  Geofence,
  GeofenceKind,
  GeofencePayload,
  GeofenceRecipientChannel,
  GeofenceRecipientType,
  GeofenceTrigger,
  GeofenceTriggerRecipient,
  LatLng,
  MAX_POLYGON_VERTICES,
} from './geofence.model';

/** Basic email shape check for external (`email`) recipients. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Raw value of a single trigger FormGroup (incl. transient draft* fields). */
interface TriggerFormValue extends GeofenceTrigger {
  recipients?: GeofenceTriggerRecipient[];
}

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
  /** Recipient kinds offered in the "Add recipient" draft selector (FN-1759). */
  readonly recipientTypeOptions: AiSelectOption<GeofenceRecipientType>[] = [
    { value: 'user', label: 'Internal user' },
    { value: 'email', label: 'External email' },
    { value: 'broker', label: 'Broker' },
  ];
  /** Per-recipient delivery channel (no SMS — FN-1755). */
  readonly channelOptions: AiSelectOption<GeofenceRecipientChannel>[] = [
    { value: 'both', label: 'Email + in-app' },
    { value: 'email', label: 'Email only' },
    { value: 'in_app', label: 'In-app only' },
  ];

  /** "Applies to" scope — all units (default) vs a single unit (FN-1762). */
  readonly appliesToSegments: AiSegment[] = [
    { key: 'all', label: 'All units' },
    { key: 'unit', label: 'Specific unit' },
  ];

  readonly maxVertices = MAX_POLYGON_VERTICES;

  // ── Recipient option lists (loaded once; stable refs — FN-317) ───────────
  // Not getters: assigned a single time after fetch so `[options]` never sees a
  // fresh array reference on each change-detection pass.
  userOptions: AiSelectOption[] = [];
  brokerOptions: AiSelectOption[] = [];

  /** Default radius (m) for a circle dropped from an address-search result. */
  private readonly DEFAULT_ADDRESS_RADIUS_M = 200;

  // ── Address search (FN-1762) ─────────────────────────────────────────────
  addressQuery = '';
  geocodeResults: GeocodeResult[] = [];
  geocoding = false;
  /** Saved-location id carried by the selected geocode result, if any. */
  private addressId: string | null = null;
  private readonly searchSubject = new Subject<string>();
  private searchSub?: Subscription;

  // ── Per-unit scoping (FN-1762) ───────────────────────────────────────────
  /** Vehicle options for the "specific unit" selector (loaded lazily; never a getter — FN-317). */
  vehicleOptions: AiSelectOption[] = [];
  private vehiclesLoaded = false;
  /** When the list is filtered to a single unit (deep-link), its id + label. */
  scopedVehicleId: string | null = null;
  scopedVehicleLabel: string | null = null;

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
    private apiService: ApiService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
  ) {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(120)]],
      kind: ['circle' as GeofenceKind, Validators.required],
      radiusMeters: [{ value: null as number | null, disabled: false }],
      appliesTo: ['all'],
      vehicleId: [''],
      triggers: this.fb.array([]),
    });
  }

  get triggers(): FormArray {
    return this.form.get('triggers') as FormArray;
  }

  get kind(): GeofenceKind {
    return this.form.get('kind')!.value as GeofenceKind;
  }

  get appliesTo(): 'all' | 'unit' {
    return this.form.get('appliesTo')!.value as 'all' | 'unit';
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
    this.wireAddressSearch();
    this.loadRecipientOptions();

    // Deep-link from Equipment: ?vehicle_id=…&unit=… pre-scopes the page to a
    // single unit (filter the list + pre-fill the editor for a new fence).
    this.route.queryParams.subscribe((params) => {
      const vehicleId = params['vehicle_id'] || params['vehicleId'] || null;
      const unit = params['unit'] || null;
      if (vehicleId) {
        this.scopedVehicleId = vehicleId;
        this.scopedVehicleLabel = unit ? `Unit ${unit}` : null;
        this.startCreateForUnit(vehicleId, this.scopedVehicleLabel);
      }
      this.loadGeofences();
    });
  }

  ngAfterViewInit(): void {
    this.initMap();
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
    this.searchSubject.complete();
    this.map?.remove();
    this.map = null;
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  loadGeofences(): void {
    this.loading = true;
    this.error = '';
    const filters = this.scopedVehicleId ? { vehicleId: this.scopedVehicleId } : undefined;
    this.geofenceService.list(filters).subscribe({
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

  /** Fetch internal users + brokers for the recipient pickers (FN-1759). */
  private loadRecipientOptions(): void {
    this.geofenceService.listUsers().subscribe({
      next: (users) => {
        this.userOptions = users.map((u) => ({
          value: u.id,
          label: u.email ? `${u.name} (${u.email})` : u.name,
        }));
        this.cdr.markForCheck();
      },
      error: () => {
        /* non-fatal: panel still allows email + broker recipients */
      },
    });
    this.geofenceService.listBrokers().subscribe({
      next: (brokers) => {
        this.brokerOptions = brokers.map((b) => ({ value: b.id, label: b.name }));
        this.cdr.markForCheck();
      },
      error: () => {
        /* non-fatal */
      },
    });
  }

  // ── Address search (FN-1762) ─────────────────────────────────────────────
  /** Debounced query stream → geocode proxy → results dropdown. */
  private wireAddressSearch(): void {
    this.searchSub = this.searchSubject
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        switchMap((q) => {
          const query = q.trim();
          if (query.length < 3) {
            this.geocoding = false;
            return of([] as GeocodeResult[]);
          }
          this.geocoding = true;
          this.cdr.markForCheck();
          return this.geofenceService.geocode(query, this.currentViewbox()).pipe(
            catchError(() => {
              this.error = 'Address lookup failed. Try again.';
              return of([] as GeocodeResult[]);
            }),
          );
        }),
      )
      .subscribe((results) => {
        this.geocodeResults = results;
        this.geocoding = false;
        this.cdr.markForCheck();
      });
  }

  onAddressInput(value: string): void {
    this.addressQuery = value;
    this.searchSubject.next(value);
  }

  /**
   * Current map viewport as a Nominatim/LocationIQ `viewbox` (lon,lat,lon,lat)
   * to soft-bias geocode results toward what the user is looking at. Returns
   * undefined before the map is ready (search then runs unbiased). FN-1781.
   */
  private currentViewbox(): string | undefined {
    if (!this.map) return undefined;
    const b = this.map.getBounds();
    return `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
  }

  /** Pick a geocode result: fly the map there and drop an editable circle. */
  selectGeocodeResult(r: GeocodeResult): void {
    this.addressId = r.addressId ?? null;
    this.addressQuery = r.label;
    this.geocodeResults = [];
    this.form.get('kind')!.setValue('circle');
    this.dropCircleAt(r.lat, r.lng, this.DEFAULT_ADDRESS_RADIUS_M);
    if (!this.form.get('name')!.value) {
      this.form.get('name')!.setValue(r.label.slice(0, 120));
    }
    this.cdr.markForCheck();
  }

  clearGeocodeResults(): void {
    this.geocodeResults = [];
  }

  /** Place an editable circle at a point and capture it as the current geometry. */
  private dropCircleAt(lat: number, lng: number, radiusMeters: number): void {
    this.center = { lat, lng };
    this.vertices = [];
    this.form.get('radiusMeters')!.setValue(radiusMeters);

    if (this.map && this.drawnItems) {
      this.drawnItems.clearLayers();
      const circle = L.circle([lat, lng], {
        radius: radiusMeters,
        color: '#38bdf8',
        weight: 2,
      });
      this.drawnItems.addLayer(circle);
      this.map.setView([lat, lng], 14);
    }
  }

  // ── Per-unit scoping (FN-1762) ───────────────────────────────────────────
  onAppliesToChange(key: string): void {
    this.form.get('appliesTo')!.setValue(key);
    if (key === 'unit') {
      this.ensureVehiclesLoaded();
    } else {
      this.form.get('vehicleId')!.setValue('');
    }
  }

  /** Lazily load the vehicle list for the "specific unit" selector. */
  private ensureVehiclesLoaded(): void {
    if (this.vehiclesLoaded) return;
    this.vehiclesLoaded = true;
    this.apiService.getVehicles().subscribe({
      next: (vehicles: any) => {
        const list = Array.isArray(vehicles) ? vehicles : vehicles?.data ?? [];
        this.vehicleOptions = list.map((v: any) => ({
          value: String(v.id),
          label: v.unit_number ? `Unit ${v.unit_number}` : (v.vin || String(v.id)),
        }));
        this.cdr.markForCheck();
      },
      error: () => {
        this.vehiclesLoaded = false; // allow a retry on next switch
      },
    });
  }

  /** Enter "create" mode pre-scoped to a single unit (deep-link from Equipment). */
  private startCreateForUnit(vehicleId: string, label: string | null): void {
    this.startCreate();
    this.ensureVehiclesLoaded();
    this.form.get('appliesTo')!.setValue('unit');
    this.form.get('vehicleId')!.setValue(vehicleId);
    if (label && !this.vehicleOptions.some((o) => o.value === vehicleId)) {
      // Show a friendly label even before the vehicle list resolves.
      this.vehicleOptions = [{ value: vehicleId, label }];
    }
    // A geofence scopes to a unit via its triggers — seed one so scoping sticks.
    if (this.triggers.length === 0) this.addTrigger();
  }

  clearUnitScope(): void {
    this.scopedVehicleId = null;
    this.scopedVehicleLabel = null;
    this.loadGeofences();
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
        // Configured recipients (only meaningful when action === 'notify').
        recipients: this.fb.array(
          (trigger?.recipients ?? []).map((r) => this.recipientGroup(r)),
        ),
        // Transient "add recipient" draft fields — never sent to the API.
        draftType: ['user' as GeofenceRecipientType],
        draftUserId: [''],
        draftEmail: [''],
        draftBrokerId: [''],
      }),
    );
  }

  removeTrigger(index: number): void {
    this.triggers.removeAt(index);
  }

  // ── Recipients (nested FormArray per trigger) ────────────────────────────
  /** The recipients FormArray for the trigger at `triggerIndex`. */
  recipients(triggerIndex: number): FormArray {
    return this.triggers.at(triggerIndex).get('recipients') as FormArray;
  }

  private recipientGroup(r?: GeofenceTriggerRecipient): FormGroup {
    return this.fb.group({
      recipientType: [r?.recipientType ?? 'user' as GeofenceRecipientType],
      userId: [r?.userId ?? null],
      email: [r?.email ?? null],
      brokerId: [r?.brokerId ?? null],
      channel: [r?.channel ?? 'both' as GeofenceRecipientChannel],
    });
  }

  /** Add a recipient to a trigger from its draft fields, then reset the draft. */
  addRecipient(triggerIndex: number): void {
    const tg = this.triggers.at(triggerIndex);
    const type = tg.get('draftType')!.value as GeofenceRecipientType;
    let recipient: GeofenceTriggerRecipient | null = null;

    if (type === 'user') {
      // Internal users can receive in-app + email, so default to both.
      const userId = (tg.get('draftUserId')!.value || '').trim();
      if (!userId || this.recipientExists(triggerIndex, 'user', userId)) return;
      recipient = { recipientType: 'user', userId, channel: 'both' };
    } else if (type === 'broker') {
      // External — email only (no in-app account); load-context email server-side.
      const brokerId = (tg.get('draftBrokerId')!.value || '').trim();
      if (!brokerId || this.recipientExists(triggerIndex, 'broker', brokerId)) return;
      recipient = { recipientType: 'broker', brokerId, channel: 'email' };
    } else {
      // External address — email only.
      const email = (tg.get('draftEmail')!.value || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email) || this.recipientExists(triggerIndex, 'email', email)) {
        this.error = EMAIL_RE.test(email) ? '' : 'Enter a valid email address.';
        return;
      }
      recipient = { recipientType: 'email', email, channel: 'email' };
    }

    this.recipients(triggerIndex).push(this.recipientGroup(recipient));
    tg.patchValue({ draftUserId: '', draftEmail: '', draftBrokerId: '' });
    this.error = '';
  }

  removeRecipient(triggerIndex: number, recipientIndex: number): void {
    this.recipients(triggerIndex).removeAt(recipientIndex);
  }

  /** Guard against adding the same user/email/broker twice to one trigger. */
  private recipientExists(
    triggerIndex: number,
    type: GeofenceRecipientType,
    id: string,
  ): boolean {
    const key = type === 'user' ? 'userId' : type === 'broker' ? 'brokerId' : 'email';
    return this.recipients(triggerIndex).controls.some(
      (c) => c.get('recipientType')!.value === type && c.get(key)!.value === id,
    );
  }

  /** Human-readable label for a configured recipient row. */
  recipientLabel(group: AbstractControl): string {
    const type = group.get('recipientType')!.value as GeofenceRecipientType;
    if (type === 'user') {
      return this.optionLabel(this.userOptions, group.get('userId')!.value) ?? 'User';
    }
    if (type === 'broker') {
      return this.optionLabel(this.brokerOptions, group.get('brokerId')!.value) ?? 'Broker';
    }
    return group.get('email')!.value || 'Email';
  }

  private optionLabel(options: AiSelectOption[], value: unknown): string | null {
    return options.find((o) => o.value === value)?.label ?? null;
  }

  /** Whether a trigger has any recipients inside (users) / outside (email+broker) the org. */
  hasRecipientScope(triggerIndex: number, scope: 'inside' | 'outside'): boolean {
    return this.recipients(triggerIndex).controls.some((c) => {
      const isUser = c.get('recipientType')!.value === 'user';
      return scope === 'inside' ? isUser : !isUser;
    });
  }

  // ── CRUD actions ───────────────────────────────────────────────────────────
  startCreate(): void {
    this.editingId = null;
    this.error = '';
    this.center = null;
    this.vertices = [];
    this.addressId = null;
    this.addressQuery = '';
    this.geocodeResults = [];
    this.triggers.clear();
    this.form.reset({ name: '', kind: 'circle', radiusMeters: null, appliesTo: 'all', vehicleId: '' });
    this.drawnItems?.clearLayers();
  }

  edit(gf: Geofence): void {
    this.editingId = gf.id;
    this.error = '';
    this.center = gf.center ?? null;
    this.vertices = gf.vertices ? [...gf.vertices] : [];
    this.addressId = gf.addressId ?? null;
    this.addressQuery = '';
    this.geocodeResults = [];
    this.triggers.clear();
    (gf.triggers ?? []).forEach((t) => this.addTrigger(t));

    // Derive the "applies to" scope: a single shared vehicle across all triggers
    // means the fence is unit-scoped; anything else (or none) means all units.
    const vehicleIds = (gf.triggers ?? []).map((t) => t.vehicleId || null);
    const scoped =
      vehicleIds.length > 0 && vehicleIds.every((v) => v && v === vehicleIds[0])
        ? vehicleIds[0]
        : null;
    if (scoped) this.ensureVehiclesLoaded();

    this.form.reset({
      name: gf.name,
      kind: gf.kind,
      radiusMeters: gf.radiusMeters ?? null,
      appliesTo: scoped ? 'unit' : 'all',
      vehicleId: scoped ?? '',
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
    // Per-unit scoping (FN-1762): "specific unit" stamps the chosen vehicle id on
    // every trigger; "all units" clears it. Triggers are how a fence scopes to a unit.
    const scopedVehicleId: string | null =
      raw.appliesTo === 'unit' && raw.vehicleId ? String(raw.vehicleId) : null;

    const triggers: GeofenceTrigger[] = (raw.triggers ?? []).map((t: TriggerFormValue) => ({
      vehicleId: scopedVehicleId,
      eventKind: t.eventKind,
      dwellMinutes: t.eventKind === 'dwell' ? t.dwellMinutes ?? null : null,
      action: t.action,
      targetUrl: t.action === 'webhook' ? t.targetUrl || null : null,
      // Recipients only ride along with the `notify` action; drop the
      // transient draft* fields by mapping each recipient explicitly.
      recipients:
        t.action === 'notify'
          ? (t.recipients ?? []).map((r) => ({
              recipientType: r.recipientType,
              userId: r.recipientType === 'user' ? r.userId ?? null : null,
              email: r.recipientType === 'email' ? r.email ?? null : null,
              brokerId: r.recipientType === 'broker' ? r.brokerId ?? null : null,
              channel: r.channel,
            }))
          : [],
    }));

    const payload: GeofencePayload = {
      name: (raw.name ?? '').trim(),
      kind: raw.kind,
      active: true,
      addressId: this.addressId,
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
