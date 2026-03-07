import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil, forkJoin, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import * as L from 'leaflet';
import {
  LoadAttachment,
  LoadAttachmentType,
  LoadDetail,
  LoadListItem,
  LoadStatus,
  BillingStatus,
  LoadStop,
  LoadAiEndpointExtraction
} from '../../models/load-dashboard.model';
import { LoadsService } from '../../services/loads.service';
import { environment } from '../../../environments/environment';

type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-loads-dashboard',
  templateUrl: './loads-dashboard.component.html',
  styleUrls: ['./loads-dashboard.component.scss']
})
export class LoadsDashboardComponent implements OnInit, OnDestroy {
  loads: LoadListItem[] = [];
  loading = true;
  errorMessage = '';
  successMessage = '';

  showNewLoadMenu = false;
  showManualModal = false;
  showAutoModal = false;
  showDetailsModal = false;
  showInlineNewLoad = false;
  showRouteModal = false;
  showNewStopModal = false;
  selectedLoad: LoadDetail | null = null;
  /** ID of load whose row actions menu is open (for click-outside close). */
  actionsOpenLoadId: string | null = null;
  /** True while POST /loads and uploads are in progress (modal submit). */
  creatingLoad = false;
  /** When set, manual modal is in edit mode for this load ID. */
  editingLoadId: string | null = null;
  /** Full detail for the load being edited (for attachments tabs). */
  editingLoadDetail: LoadDetail | null = null;

  /** Active tab in the attachments/extra section of the edit modal. */
  attachmentTab: 'services' | 'documents' | 'billing' | 'history' = 'documents';
  /** Upload attachment modal state. */
  showUploadModal = false;
  uploadAttachmentType: LoadAttachmentType = 'RATE_CONFIRMATION';
  uploadAttachmentNotes = '';
  uploadSelectedFiles: FileList | null = null;

  /** Replace (edit) attachment modal state. */
  showReplaceModal = false;
  editingAttachment: LoadAttachment | null = null;
  replaceAttachmentType: LoadAttachmentType = 'RATE_CONFIRMATION';
  replaceAttachmentNotes = '';
  replaceAttachmentFile: File | null = null;
  replacingAttachment = false;

  readonly attachmentTypeOptions: LoadAttachmentType[] = [
    'RATE_CONFIRMATION',
    'BOL',
    'LUMPER',
    'PROOF_OF_DELIVERY',
    'ROADSIDE_MAINTENANCE_RECEIPT',
    'OTHER',
    'CONFIRMATION'
  ];

  // Auto-create from PDF state
  autoPdfFile: File | null = null;
  autoExtracting = false;
  autoError = '';
  autoExtraction: LoadAiEndpointExtraction | null = null;

  drivers: { id: string; name: string }[] = [];
  trucks: { id: string; label: string }[] = [];
  trailers: { id: string; label: string }[] = [];
  brokers: { id: string; name: string }[] = [];
  brokerDropdownOpen = false;

  dispatcherName = '';
  dispatcherUserId: string | null = null;

  manualLoadForm: FormGroup;
  pendingAttachments: Array<{ file: File; type: LoadAttachmentType; notes?: string }> = [];
  attachmentType: LoadAttachmentType = 'RATE_CONFIRMATION';
  attachmentNotes = '';
  attachmentError = '';
  selectedAttachmentFiles: FileList | null = null;

  search$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  // Inline searchable combos for driver / truck / trailer
  driverSearch = '';
  truckSearch = '';
  trailerSearch = '';
  driverDropdownOpen = false;
  truckDropdownOpen = false;
  trailerDropdownOpen = false;
  sortedStops: LoadStop[] = [];
  newStopForm: FormGroup;
  newStopError = '';
  savingNewStop = false;
  showEditStopModal = false;
  editingStopIndex: number | null = null;
  editStopForm: FormGroup;
  editStopError = '';
  savingEditStop = false;

  routeMap: L.Map | null = null;
  routeMapLayer: 'map' | 'satellite' = 'map';
  routeMapLoading = false;
  routeMapError = '';
  private routeWaypoints: { lat: number; lon: number }[] = [];
  private routeGeometry: { coordinates: [number, number][] } | null = null;
  private routeTileLayers: { map: L.TileLayer; satellite: L.TileLayer } | null = null;

  page = 1;
  pageSize = 25;
  total = 0;

  /** True when current user has role driver (sees only their loads, can upload docs). */
  isDriverRole = false;

  filters: {
    status: string;
    billingStatus: string;
    driverId: string;
    q: string;
  } = {
    status: '',
    billingStatus: '',
    driverId: '',
    q: ''
  };

  sortBy: 'load_number' | 'pickup_date' | 'rate' | 'completed_date' = 'load_number';
  sortDir: SortDir = 'desc';

  // Summary totals for quick gross amount reporting on current page
  summaryTotals: {
    totalGross: number;
    byStatus: { [key: string]: number };
    byBilling: { [key: string]: number };
  } = {
    totalGross: 0,
    byStatus: {},
    byBilling: {}
  };

  // Header row filters (per-column filters under table headers)
  headerFilters: {
    date: string;
    broker: string;
    po: string;
    pickup: string;
    delivery: string;
    rate: string;
    notes: string;
    attachmentType: string;
  } = {
    date: '',
    broker: '',
    po: '',
    pickup: '',
    delivery: '',
    rate: '',
    notes: '',
    attachmentType: ''
  };

  get maxPage(): number {
    return Math.max(Math.ceil(this.total / this.pageSize), 1);
  }

  pickupCityEdited = false;
  pickupStateEdited = false;
  deliveryCityEdited = false;
  deliveryStateEdited = false;

  statusOptions: LoadStatus[] = ['NEW', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
  billingOptions: BillingStatus[] = ['PENDING', 'FUNDED', 'INVOICED', 'PAID'];

  private headerFilterLabels: { [K in keyof typeof this.headerFilters]: string } = {
    date: 'Date',
    broker: 'Broker',
    po: 'PO #',
    pickup: 'Pickup',
    delivery: 'Delivery',
    rate: 'Rate',
    notes: 'Notes',
    attachmentType: 'Attachment'
  };

  // Convenience getters/setters for binding custom date picker to reactive form
  get pickupDateValue(): string {
    return (this.manualLoadForm.get('pickupDate')?.value as string) || '';
  }

  set pickupDateValue(value: string) {
    this.manualLoadForm.get('pickupDate')?.setValue(value);
  }

  get deliveryDateValue(): string {
    return (this.manualLoadForm.get('deliveryDate')?.value as string) || '';
  }

  set deliveryDateValue(value: string) {
    this.manualLoadForm.get('deliveryDate')?.setValue(value);
  }

  // Human-readable rate per mile for edit header
  get ratePerMileDisplay(): string {
    const d = this.editingLoadDetail;
    if (!d) return '--';

    let value: number | null = null;
    if (d.rate_per_mile != null) {
      value = d.rate_per_mile;
    } else if (d.rate != null && d.total_miles) {
      value = d.total_miles > 0 ? d.rate / d.total_miles : null;
    }

    if (value == null || !isFinite(value)) return '--';
    return value.toFixed(2);
  }

  /** Google Maps directions URL from first to last stop (when viewing route). */
  get routeMapUrl(): string {
    const stops = this.sortedStops;
    if (!stops || stops.length < 2) return '';
    const origin = stops[0];
    const dest = stops[stops.length - 1];
    const o = [origin.city, origin.state, origin.zip].filter(Boolean).join(', ');
    const d = [dest.city, dest.state, dest.zip].filter(Boolean).join(', ');
    if (!o || !d) return '';
    const params = new URLSearchParams({ api: '1', origin: o, destination: d });
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  get routeSummary(): string {
    const stops = this.sortedStops;
    if (!stops || stops.length < 2) return '';
    const origin = stops[0];
    const dest = stops[stops.length - 1];
    const o = [origin.city, origin.state].filter(Boolean).join(', ');
    const d = [dest.city, dest.state].filter(Boolean).join(', ');
    return o && d ? `${o} → ${d}` : '';
  }

  /** Driver position = from loads API (position before picking up this load), else fallback to last delivery. */
  get driverPositionDisplay(): string {
    const load = this.editingLoadDetail;
    const city = (load?.driver_position_city || '').toString().trim();
    const state = (load?.driver_position_state || '').toString().trim();
    if (city || state) return [city || '--', state].filter(Boolean).join(', ');
    const stops = this.sortedStops || [];
    if (!stops.length) return '--';
    const lastDelivery = [...stops].reverse().find(
      (s) => (s.stop_type || '').toString().toUpperCase() === 'DELIVERY'
    );
    const stop = lastDelivery || stops[stops.length - 1];
    return [stop.city || '--', stop.state || ''].filter(Boolean).join(', ');
  }

  /** True if the datetime has a non‑midnight time component; otherwise treat it as date‑only. */
  hasTimePart(value: unknown): boolean {
    if (!value) return false;
    const d = value instanceof Date ? value : new Date(value as any);
    if (Number.isNaN(d.getTime())) return false;
    return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  }

  /** Pickup/delivery date for a stop: match Edit Load form (form value first), then stop date, then load from API. */
  getStopDisplayDate(stop: LoadStop, _index: number): string | null {
    const load = this.editingLoadDetail;
    const type = (stop?.stop_type || '').toString().toUpperCase();
    const formPickup = this.manualLoadForm.get('pickupDate')?.value;
    const formDelivery = this.manualLoadForm.get('deliveryDate')?.value;
    if (type === 'PICKUP') {
      const v = (formPickup ?? stop?.stop_date ?? load?.pickup_date) ?? null;
      return v ? String(v).trim() || null : null;
    }
    if (type === 'DELIVERY') {
      const v = (formDelivery ?? stop?.stop_date ?? load?.delivery_date) ?? null;
      return v ? String(v).trim() || null : null;
    }
    return (stop?.stop_date as string) || null;
  }

  constructor(
    private loadsService: LoadsService,
    private fb: FormBuilder,
    private route: ActivatedRoute
  ) {
    this.manualLoadForm = this.fb.group({
      status: ['NEW', Validators.required],
      billingStatus: ['PENDING', Validators.required],
      dispatcher: [{ value: '', disabled: true }],
      pickupDate: ['', Validators.required],
      pickupCity: [''],
      pickupState: [''],
      pickupZip: [''],
      deliveryDate: ['', Validators.required],
      deliveryCity: [''],
      deliveryState: [''],
      deliveryZip: [''],
      driverId: [''],
      truckId: [''],
      trailerId: [''],
      brokerId: [''],
      brokerName: [''],
      poNumber: [''],
      rate: ['', [Validators.required, Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
      notes: ['']
    });
    this.newStopForm = this.fb.group({
      stopType: ['DELIVERY'],
      orderAfterIndex: [0],
      stopDate: ['', Validators.required],
      company: [''],
      address1: [''],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zip: [''],
      phone: [''],
      notes: ['']
    });
    this.editStopForm = this.fb.group({
      stopType: ['PICKUP'],
      orderAfterIndex: [0],
      appointmentType: ['FCFS'],
      stopDate: ['', Validators.required],
      apptTime: [''],
      company: [''],
      address1: [''],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zip: [''],
      phone: [''],
      notes: ['']
    });
  }

  private normalizeDate(value: any): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      if (params['status']) this.filters.status = params['status'];
      if (params['billingStatus']) this.filters.billingStatus = params['billingStatus'];
    });
    this.loadDropdownData();
    this.loadLoads();

    this.search$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((value) => {
        this.filters.q = value;
        this.page = 1;
        this.loadLoads();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDropdownData(): void {
    this.loadsService.getActiveDrivers().subscribe({
      next: (data) => {
        this.drivers = (data || []).map((driver) => ({
          id: driver.id,
          name: `${driver.firstName} ${driver.lastName}`.trim()
        }));
      },
      error: () => {
        this.drivers = [];
      }
    });

    this.loadsService.getEquipment('truck').subscribe({
      next: (res) => {
        this.trucks = (res?.data || []).map((vehicle) => ({
          id: vehicle.id,
          label: `${vehicle.unit_number} (${vehicle.make || ''} ${vehicle.model || ''})`.trim()
        }));
      },
      error: () => {
        this.trucks = [];
      }
    });

    this.loadsService.getEquipment('trailer').subscribe({
      next: (res) => {
        this.trailers = (res?.data || []).map((vehicle) => ({
          id: vehicle.id,
          label: `${vehicle.unit_number} (${vehicle.make || ''} ${vehicle.model || ''})`.trim()
        }));
      },
      error: () => {
        this.trailers = [];
      }
    });

    this.loadsService.getCurrentUser().subscribe({
      next: (res) => {
        const user = res?.data;
        const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
        this.dispatcherName = name || user?.username || '';
        this.dispatcherUserId = user?.id || null;
        this.manualLoadForm.patchValue({ dispatcher: this.dispatcherName });
        const role = (user?.role || '').toString().toLowerCase();
        if (role === 'driver' && user?.driver_id) {
          this.isDriverRole = true;
          this.filters.driverId = user.driver_id;
          this.loadLoads();
        }
      }
    });
  }

  loadBrokers(): void {
    this.loadsService.getBrokers().subscribe({
      next: (res) => {
        this.brokers = (res?.data || []).map((b) => ({ id: b.id, name: b.name }));
      },
      error: () => {
        this.brokers = [];
      }
    });
  }

  get filteredBrokers(): { id: string; name: string }[] {
    const q = (this.manualLoadForm.get('brokerName')?.value || '').toString().trim().toLowerCase();
    if (!q) return this.brokers.slice(0, 50);
    return this.brokers.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 50);
  }

  selectBroker(broker: { id: string; name: string }): void {
    this.manualLoadForm.patchValue({ brokerId: broker.id, brokerName: broker.name });
    this.brokerDropdownOpen = false;
  }

  onBrokerInputFocus(): void {
    this.brokerDropdownOpen = true;
  }

  get inlineFilteredDrivers(): { id: string; name: string }[] {
    const q = this.driverSearch.trim().toLowerCase();
    if (!q) return this.drivers.slice(0, 50);
    return this.drivers.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 50);
  }

  get inlineFilteredTrucks(): { id: string; label: string }[] {
    const q = this.truckSearch.trim().toLowerCase();
    if (!q) return this.trucks.slice(0, 50);
    return this.trucks.filter((t) => t.label.toLowerCase().includes(q)).slice(0, 50);
  }

  get inlineFilteredTrailers(): { id: string; label: string }[] {
    const q = this.trailerSearch.trim().toLowerCase();
    if (!q) return this.trailers.slice(0, 50);
    return this.trailers.filter((t) => t.label.toLowerCase().includes(q)).slice(0, 50);
  }

  selectInlineDriver(driver: { id: string; name: string }): void {
    this.manualLoadForm.patchValue({ driverId: driver.id });
    this.driverSearch = driver.name;
    this.driverDropdownOpen = false;
  }

  selectInlineTruck(truck: { id: string; label: string }): void {
    this.manualLoadForm.patchValue({ truckId: truck.id });
    this.truckSearch = truck.label;
    this.truckDropdownOpen = false;
  }

  selectInlineTrailer(trailer: { id: string; label: string }): void {
    this.manualLoadForm.patchValue({ trailerId: trailer.id });
    this.trailerSearch = trailer.label;
    this.trailerDropdownOpen = false;
  }

  loadLoads(): void {
    this.loading = true;
    this.errorMessage = '';
    this.loadsService
      .listLoads({
        status: this.filters.status,
        billingStatus: this.filters.billingStatus,
        driverId: this.filters.driverId,
        q: this.filters.q,
        page: this.page,
        pageSize: this.pageSize,
        sortBy: this.sortBy,
        sortDir: this.sortDir
      })
      .subscribe({
        next: (res) => {
          this.loads = res?.data || [];
          this.total = res?.meta?.total || 0;
          this.loading = false;
        this.recomputeSummaryTotals();
        },
        error: () => {
          this.errorMessage = 'Failed to load loads.';
          this.loading = false;
        }
      });
  }

  onSearch(value: string): void {
    this.search$.next(value);
  }

  onFilterChange(): void {
    this.page = 1;
    this.loadLoads();
  }

  toggleSort(field: 'load_number' | 'pickup_date' | 'rate' | 'completed_date'): void {
    if (this.sortBy === field) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = field;
      this.sortDir = 'asc';
    }
    this.loadLoads();
  }

  setStatusFilter(value: string): void {
    this.filters.status = value;
    this.page = 1;
    this.loadLoads();
  }

  setBillingFilter(value: string): void {
    this.filters.billingStatus = value;
    this.page = 1;
    this.loadLoads();
  }

  goToPage(page: number): void {
    if (page < 1) return;
    const maxPage = Math.max(Math.ceil(this.total / this.pageSize), 1);
    if (page > maxPage) return;
    this.page = page;
    this.loadLoads();
  }

  openManualEntry(): void {
    this.editingLoadId = null;
    this.editingLoadDetail = null;
    this.attachmentTab = 'documents';
    // Fresh manual entry should not carry over any pending attachments
    this.pendingAttachments = [];
    this.attachmentNotes = '';
    this.attachmentType = 'RATE_CONFIRMATION';
    this.attachmentError = '';
    this.selectedAttachmentFiles = null;
    this.resetManualForm();
    this.loadBrokers();
    this.showManualModal = false;
    this.showInlineNewLoad = true;
    this.showNewLoadMenu = false;
  }

  openAutoCreate(): void {
    this.autoPdfFile = null;
    this.autoExtracting = false;
    this.autoError = '';
    this.autoExtraction = null;
    this.showAutoModal = true;
    this.showNewLoadMenu = false;
  }

  closeManualModal(): void {
    this.showManualModal = false;
    this.showUploadModal = false;
    this.editingLoadId = null;
    this.editingLoadDetail = null;
  }

  openRouteModal(): void {
    this.destroyRouteMap();
    this.showRouteModal = true;
    this.routeMapError = '';
    this.routeMapLoading = true;
    this.routeWaypoints = [];
    this.routeGeometry = null;
    const allStops = this.sortedStops || [];
    if (allStops.length < 2) {
      this.routeMapLoading = false;
      this.routeMapError = 'Add at least two stops to view the route.';
      return;
    }
    const stopsWithZip = allStops.filter((stop) => (stop.zip || '').toString().trim());
    if (stopsWithZip.length < 2) {
      this.routeMapLoading = false;
      this.routeMapError = 'Add zip codes to at least pickup and delivery to show the route on the map.';
      return;
    }
    const zipLookups = stopsWithZip.map((stop) => {
      const zip = (stop.zip || '').toString().trim();
      return this.loadsService.lookupZip(zip).pipe(
        map((res) => {
          const d = res?.data;
          if (d?.lat != null && d?.lon != null) return { lat: d.lat, lon: d.lon };
          return null;
        }),
        catchError(() => of(null))
      );
    });
    forkJoin(zipLookups).pipe(
      switchMap((waypoints) => {
        const validWaypoints = (waypoints.filter((w) => !!w) as { lat: number; lon: number }[]);
        if (validWaypoints.length < 2) {
          this.routeMapError = 'Could not resolve enough locations to draw the route.';
          this.routeMapLoading = false;
          return of(null);
        }
        this.routeWaypoints = validWaypoints;
        return this.loadsService.getRouteGeometry(this.routeWaypoints).pipe(
          map((geom) => {
            this.routeGeometry = geom;
            this.routeMapLoading = false;
            setTimeout(() => this.initRouteMap(), 350);
            return null;
          }),
          catchError(() => {
            this.routeMapLoading = false;
            this.routeGeometry = null;
            setTimeout(() => this.initRouteMap(), 350);
            return of(null);
          })
        );
      }),
      catchError(() => {
        this.routeMapLoading = false;
        this.routeMapError = 'Could not load route.';
        return of(null);
      }),
      takeUntil(this.destroy$)
    ).subscribe();
  }

  closeRouteModal(): void {
    this.showRouteModal = false;
    this.destroyRouteMap();
  }

  setRouteMapLayer(layer: 'map' | 'satellite'): void {
    this.routeMapLayer = layer;
    if (!this.routeMap || !this.routeTileLayers) return;
    if (layer === 'map') {
      this.routeMap.removeLayer(this.routeTileLayers.satellite);
      this.routeMap.addLayer(this.routeTileLayers.map);
    } else {
      this.routeMap.removeLayer(this.routeTileLayers.map);
      this.routeMap.addLayer(this.routeTileLayers.satellite);
    }
  }

  private destroyRouteMap(): void {
    if (this.routeMap) {
      this.routeMap.remove();
      this.routeMap = null;
    }
    this.routeTileLayers = null;
  }

  private initRouteMap(): void {
    const container = document.getElementById('route-map-container');
    if (!container || container.children.length > 0) return;
    const waypoints = this.routeWaypoints;
    if (waypoints.length === 0) return;

    // Force container size so Leaflet gets correct dimensions (modal may not have laid out yet)
    container.style.height = '360px';
    container.style.width = '100%';
    container.style.minHeight = '360px';

    const map = L.map(container, { center: [waypoints[0].lat, waypoints[0].lon], zoom: 6 });
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri'
    });
    this.routeTileLayers = { map: osm, satellite };
    if (this.routeMapLayer === 'satellite') {
      satellite.addTo(map);
    } else {
      osm.addTo(map);
    }

    if (this.routeGeometry?.coordinates?.length) {
      const latLngs: L.LatLngExpression[] = this.routeGeometry.coordinates.map(([lon, lat]) => [lat, lon]);
      L.polyline(latLngs, { color: '#22c55e', weight: 5, opacity: 0.9 }).addTo(map);
    }

    waypoints.forEach((wp, i) => {
      const isFirst = i === 0;
      const marker = L.marker([wp.lat, wp.lon], {
        icon: L.divIcon({
          className: 'route-marker',
          html: `<span class="route-marker-num ${isFirst ? 'route-marker-pickup' : 'route-marker-delivery'}">#${i + 1}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })
      }).addTo(map);
    });

    const bounds = L.latLngBounds(waypoints.map((w) => [w.lat, w.lon]));
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });

    // Leaflet needs the container to have final size; modal may still be laying out
    setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
    }, 100);
    setTimeout(() => {
      if (this.routeMap === map) {
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
      }
    }, 400);

    this.routeMap = map;
  }

  openNewStopModal(): void {
    this.newStopError = '';
    this.newStopForm.reset({
      stopType: 'DELIVERY',
      orderAfterIndex: 0,
      stopDate: '',
      company: '',
      address1: '',
      city: '',
      state: '',
      zip: '',
      phone: '',
      notes: ''
    });
    this.showNewStopModal = true;
  }

  closeNewStopModal(): void {
    this.showNewStopModal = false;
    this.newStopError = '';
  }

  openEditStopModal(stop: LoadStop, index: number): void {
    this.editingStopIndex = index;
    this.editStopError = '';
    const type = (stop?.stop_type || 'PICKUP').toString().toUpperCase();
    let dateVal = stop?.stop_date ? this.normalizeDate(stop.stop_date) : '';
    if (!dateVal) {
      const load = this.editingLoadDetail;
      const formPickup = this.manualLoadForm.get('pickupDate')?.value;
      const formDelivery = this.manualLoadForm.get('deliveryDate')?.value;
      if (type === 'PICKUP') dateVal = this.normalizeDate(load?.pickup_date || formPickup);
      else if (type === 'DELIVERY') dateVal = this.normalizeDate(load?.delivery_date || formDelivery);
    }
    this.editStopForm.reset({
      stopType: type,
      orderAfterIndex: Math.max(0, index - 1),
      appointmentType: 'FCFS',
      stopDate: dateVal,
      apptTime: '',
      company: '',
      address1: stop?.address1 || '',
      city: stop?.city || '',
      state: stop?.state || '',
      zip: stop?.zip || '',
      phone: '',
      notes: (stop as any)?.address2 || ''
    });
    this.showEditStopModal = true;
  }

  closeEditStopModal(): void {
    this.showEditStopModal = false;
    this.editingStopIndex = null;
    this.editStopError = '';
  }

  /** When user switches Stop type radio in Edit Stop modal, switch to editing that stop (pickup or delivery). */
  onEditStopTypeChange(value: string): void {
    const type = value.toString().toUpperCase();
    const stops = this.sortedStops || [];
    let idx = -1;
    if (type === 'PICKUP') {
      idx = stops.findIndex((s) => (s.stop_type || '').toString().toUpperCase() === 'PICKUP');
    } else if (type === 'DELIVERY' || type === 'OTHER') {
      idx = stops.findIndex((s) => (s.stop_type || '').toString().toUpperCase() === 'DELIVERY');
    }
    if (idx < 0) return;
    const stop = stops[idx];
    this.editingStopIndex = idx;
    let dateVal = stop?.stop_date ? this.normalizeDate(stop.stop_date) : '';
    if (!dateVal) {
      const load = this.editingLoadDetail;
      const formPickup = this.manualLoadForm.get('pickupDate')?.value;
      const formDelivery = this.manualLoadForm.get('deliveryDate')?.value;
      if (type === 'PICKUP') dateVal = this.normalizeDate(load?.pickup_date || formPickup);
      else dateVal = this.normalizeDate(load?.delivery_date || formDelivery);
    }
    this.editStopForm.patchValue({
      stopType: type,
      orderAfterIndex: Math.max(0, idx - 1),
      stopDate: dateVal,
      address1: stop?.address1 || '',
      city: stop?.city || '',
      state: stop?.state || '',
      zip: stop?.zip || '',
      notes: (stop as any)?.address2 || ''
    });
  }

  lookupZipForEditStop(): void {
    const zip = (this.editStopForm.get('zip')?.value || '').toString().trim();
    if (zip.length < 5) return;
    this.loadsService.lookupZip(zip).subscribe({
      next: (res) => {
        this.editStopForm.patchValue({
          city: res?.data?.city || '',
          state: res?.data?.state || ''
        });
      }
    });
  }

  saveEditStop(): void {
    this.editStopError = '';
    this.editStopForm.markAllAsTouched();
    if (this.editStopForm.invalid) {
      this.editStopError = 'Please fill required fields: Date, City, State.';
      return;
    }
    if (this.editingStopIndex == null || !this.editingLoadId || !this.editingLoadDetail) {
      this.editStopError = 'No stop selected.';
      return;
    }
    const v = this.editStopForm.getRawValue();
    const rawType = (v.stopType || 'PICKUP').toString().toUpperCase();
    const stopType = rawType === 'OTHER' ? 'DELIVERY' : (rawType as 'PICKUP' | 'DELIVERY');
    const updated: LoadStop & { stopDate?: string } = {
      ...this.sortedStops[this.editingStopIndex],
      stop_type: stopType,
      stop_date: v.stopDate || null,
      stopDate: v.stopDate || undefined,
      city: v.city || null,
      state: v.state || null,
      zip: v.zip || null,
      address1: v.address1 || null,
      address2: v.notes || null
    };
    const stops = this.sortedStops.map((s, i) => ({
      ...s,
      sequence: i + 1,
      stop_date: s.stop_date ?? (s as any).stopDate ?? null
    }));
    const updatedWithDate = {
      ...updated,
      sequence: this.editingStopIndex + 1,
      stop_date: updated.stop_date ?? (updated as any).stopDate ?? null
    };
    stops[this.editingStopIndex] = updatedWithDate;
    const payload = this.buildLoadPayloadFromDetail();
    payload.stops = stops;
    this.savingEditStop = true;
    this.loadsService.updateLoad(this.editingLoadId, payload).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (detail) {
          this.editingLoadDetail = detail;
          this.sortedStops = (detail.stops || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
          this.syncManualFormFromStops();
        }
        this.savingEditStop = false;
        this.closeEditStopModal();
      },
      error: () => {
        this.savingEditStop = false;
        this.editStopError = 'Failed to update stop.';
      }
    });
  }

  removeEditStop(): void {
    if (this.editingStopIndex == null || !this.editingLoadId || !this.editingLoadDetail) return;
    const stops = this.sortedStops.filter((_, i) => i !== this.editingStopIndex);
    const hasPickup = stops.some((s) => (s.stop_type || '').toString().toUpperCase() === 'PICKUP');
    const hasDelivery = stops.some((s) => (s.stop_type || '').toString().toUpperCase() === 'DELIVERY');
    if (!hasPickup || !hasDelivery) {
      this.editStopError = 'Load must have at least one pickup and one delivery stop.';
      return;
    }
    const reordered = stops.map((s, i) => ({ ...s, sequence: i + 1 }));
    const payload = this.buildLoadPayloadFromDetail();
    payload.stops = reordered;
    this.savingEditStop = true;
    this.loadsService.updateLoad(this.editingLoadId, payload).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (detail) {
          this.editingLoadDetail = detail;
          this.sortedStops = (detail.stops || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
          this.syncManualFormFromStops();
        }
        this.savingEditStop = false;
        this.closeEditStopModal();
      },
      error: () => {
        this.savingEditStop = false;
        this.editStopError = 'Failed to remove stop.';
      }
    });
  }

  private buildLoadPayloadFromDetail(): any {
    const d = this.editingLoadDetail!;
    return {
      status: d.status,
      billingStatus: d.billing_status,
      dispatcherUserId: this.dispatcherUserId,
      driverId: d.driver_id || null,
      truckId: d.truck_id || null,
      trailerId: d.trailer_id || null,
      brokerId: d.broker_id || null,
      brokerName: d.broker_name || null,
      poNumber: d.po_number || null,
      rate: d.rate ?? 0,
      notes: d.notes || null,
      stops: (d.stops || []).map((s, i) => ({ ...s, sequence: i + 1 }))
    };
  }

  private syncManualFormFromStops(): void {
    const stops = this.sortedStops || [];
    const pickup = stops.find((s) => (s.stop_type || '').toString().toUpperCase() === 'PICKUP');
    const delivery = stops.find((s) => (s.stop_type || '').toString().toUpperCase() === 'DELIVERY');
    if (pickup) {
      const patch: any = {};
      if (pickup.stop_date) patch.pickupDate = this.normalizeDate(pickup.stop_date);
      if (pickup.city != null && pickup.city !== '') patch.pickupCity = pickup.city;
      if (pickup.state != null && pickup.state !== '') patch.pickupState = pickup.state;
      if (pickup.zip != null && pickup.zip !== '') patch.pickupZip = pickup.zip;
      if (Object.keys(patch).length) this.manualLoadForm.patchValue(patch);
    }
    if (delivery) {
      const patch: any = {};
      if (delivery.stop_date) patch.deliveryDate = this.normalizeDate(delivery.stop_date);
      if (delivery.city != null && delivery.city !== '') patch.deliveryCity = delivery.city;
      if (delivery.state != null && delivery.state !== '') patch.deliveryState = delivery.state;
      if (delivery.zip != null && delivery.zip !== '') patch.deliveryZip = delivery.zip;
      if (Object.keys(patch).length) this.manualLoadForm.patchValue(patch);
    }
  }

  saveNewStop(): void {
    this.newStopError = '';
    this.newStopForm.markAllAsTouched();
    if (this.newStopForm.invalid) {
      this.newStopError = 'Please fill required fields: Date, City, State.';
      return;
    }
    if (!this.editingLoadId || !this.editingLoadDetail) {
      this.newStopError = 'No load selected.';
      return;
    }
    const v = this.newStopForm.getRawValue();
    const orderAfter = Math.min(Number(v.orderAfterIndex) || 0, Math.max(0, this.sortedStops.length - 1));
    const newStop: LoadStop & { stopDate?: string } = {
      stop_type: v.stopType as 'PICKUP' | 'DELIVERY',
      stop_date: v.stopDate || null,
      stopDate: v.stopDate || undefined,
      city: v.city || null,
      state: v.state || null,
      zip: v.zip || null,
      address1: v.address1 || null,
      sequence: orderAfter + 2
    };
    const existing = this.sortedStops.map((s, i) => ({ ...s, sequence: i + 1 }));
    const inserted = [...existing.slice(0, orderAfter + 1), newStop, ...existing.slice(orderAfter + 1)];
    for (let i = 0; i < inserted.length; i++) {
      inserted[i].sequence = i + 1;
    }
    const payload = {
      status: this.editingLoadDetail.status,
      billingStatus: this.editingLoadDetail.billing_status,
      dispatcherUserId: this.dispatcherUserId,
      driverId: this.editingLoadDetail.driver_id || null,
      truckId: this.editingLoadDetail.truck_id || null,
      trailerId: this.editingLoadDetail.trailer_id || null,
      brokerId: this.editingLoadDetail.broker_id || null,
      brokerName: this.editingLoadDetail.broker_name || null,
      poNumber: this.editingLoadDetail.po_number || null,
      rate: this.editingLoadDetail.rate ?? 0,
      notes: this.editingLoadDetail.notes || null,
      stops: inserted
    };
    this.savingNewStop = true;
    this.loadsService.updateLoad(this.editingLoadId, payload).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (detail) {
          this.editingLoadDetail = detail;
          this.sortedStops = (detail.stops || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
          this.syncManualFormFromStops();
        }
        this.savingNewStop = false;
        this.closeNewStopModal();
      },
      error: () => {
        this.savingNewStop = false;
        this.newStopError = 'Failed to add stop.';
      }
    });
  }

  recalculateDistance(): void {
    if (!this.editingLoadId) return;
    this.loadsService.getLoad(this.editingLoadId).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (detail) {
          this.editingLoadDetail = detail;
          this.sortedStops = (detail.stops || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
        }
      },
      error: () => {
        this.errorMessage = 'Failed to refresh load.';
      }
    });
  }

  dispatchInfoToDriver(): void {
    // To be implemented later
  }

  closeAutoModal(): void {
    this.showAutoModal = false;
  }

  openDetails(load: LoadListItem): void {
    this.loadsService.getLoad(load.id).subscribe({
      next: (res) => {
        this.selectedLoad = res?.data || null;
        this.showDetailsModal = true;
      },
      error: () => {
        this.errorMessage = 'Failed to load details.';
      }
    });
  }

  closeDetails(): void {
    this.showDetailsModal = false;
    this.selectedLoad = null;
  }

  openEdit(load: LoadListItem): void {
    this.errorMessage = '';
    this.creatingLoad = false;
    this.loadsService.getLoad(load.id).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (!detail) {
          this.errorMessage = 'Failed to load details for edit.';
          return;
        }
        this.editingLoadId = detail.id;
        this.editingLoadDetail = detail;
        this.sortedStops = (detail.stops || []).slice().sort((a, b) => {
          const aSeq = a.sequence ?? 0;
          const bSeq = b.sequence ?? 0;
          return aSeq - bSeq;
        });
        this.attachmentTab = 'documents';
        this.populateFormFromDetail(detail);
        this.loadBrokers();
        this.showManualModal = true;
      },
      error: () => {
        this.errorMessage = 'Failed to load details for edit.';
      }
    });
  }

  private populateFormFromDetail(detail: LoadDetail): void {
    const normalizeDate = (value: unknown): string => {
      if (!value) return '';
      const d = value instanceof Date ? value : new Date(value as any);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    };
    const pickup = (detail.stops || []).find((s) => (s.stop_type || '').toUpperCase() === 'PICKUP');
    const delivery = (detail.stops || []).find((s) => (s.stop_type || '').toUpperCase() === 'DELIVERY');

    // Prefer stop dates; if missing, fall back to top-level pickup/delivery dates
    const pickupDate = pickup?.stop_date
      ? normalizeDate(pickup.stop_date as any)
      : normalizeDate((detail as any).pickup_date);
    const deliveryDate = delivery?.stop_date
      ? normalizeDate(delivery.stop_date as any)
      : normalizeDate((detail as any).delivery_date);
    this.manualLoadForm.reset({
      status: detail.status,
      billingStatus: detail.billing_status,
      dispatcher: this.dispatcherName || '',
      pickupDate,
      pickupCity: pickup?.city || '',
      pickupState: pickup?.state || '',
      pickupZip: pickup?.zip || '',
      deliveryDate,
      deliveryCity: delivery?.city || '',
      deliveryState: delivery?.state || '',
      deliveryZip: delivery?.zip || '',
      driverId: detail.driver_id || '',
      truckId: detail.truck_id || '',
      trailerId: detail.trailer_id || '',
      brokerId: detail.broker_id || '',
      brokerName: detail.broker_name || '',
      poNumber: detail.po_number || '',
      rate: detail.rate ?? '',
      notes: detail.notes ?? ''
    });
    this.pickupCityEdited = false;
    this.pickupStateEdited = false;
    this.deliveryCityEdited = false;
    this.deliveryStateEdited = false;
  }

  resetManualForm(): void {
    this.manualLoadForm.reset({
      status: 'NEW',
      billingStatus: 'PENDING',
      dispatcher: this.dispatcherName || '',
      pickupDate: '',
      pickupCity: '',
      pickupState: '',
      pickupZip: '',
      deliveryDate: '',
      deliveryCity: '',
      deliveryState: '',
      deliveryZip: '',
      driverId: '',
      truckId: '',
      trailerId: '',
      brokerId: '',
      brokerName: '',
      poNumber: '',
      rate: '',
      notes: ''
    });
    this.pickupCityEdited = false;
    this.pickupStateEdited = false;
    this.deliveryCityEdited = false;
    this.deliveryStateEdited = false;
    this.sortedStops = [];
  }

  /** Apply extracted AI values into the manual load form for review. */
  private applyExtractionToForm(extraction: LoadAiEndpointExtraction): void {
    this.editingLoadId = null;
    this.editingLoadDetail = null;
    this.resetManualForm();

    const pickup = extraction.pickup || ({} as any);
    const delivery = extraction.delivery || ({} as any);

    this.manualLoadForm.patchValue({
      brokerName: extraction.brokerName || '',
      poNumber: extraction.poNumber || '',
      rate: extraction.rate != null ? extraction.rate : '',
      pickupDate: pickup.date || '',
      pickupCity: pickup.city || '',
      pickupState: pickup.state || '',
      pickupZip: pickup.zip || '',
      deliveryDate: delivery.date || '',
      deliveryCity: delivery.city || '',
      deliveryState: delivery.state || '',
      deliveryZip: delivery.zip || ''
    });
  }

  markPickupCityEdited(): void {
    this.pickupCityEdited = true;
  }

  markPickupStateEdited(): void {
    this.pickupStateEdited = true;
  }

  markDeliveryCityEdited(): void {
    this.deliveryCityEdited = true;
  }

  markDeliveryStateEdited(): void {
    this.deliveryStateEdited = true;
  }

  lookupPickupZip(): void {
    const zip = (this.manualLoadForm.value.pickupZip || '').toString().trim();
    if (zip.length !== 5) return;
    this.loadsService.lookupZip(zip).subscribe({
      next: (res) => {
        if (!this.pickupCityEdited) {
          this.manualLoadForm.patchValue({ pickupCity: res?.data?.city || '' });
        }
        if (!this.pickupStateEdited) {
          this.manualLoadForm.patchValue({ pickupState: res?.data?.state || '' });
        }
      }
    });
  }

  lookupDeliveryZip(): void {
    const zip = (this.manualLoadForm.value.deliveryZip || '').toString().trim();
    if (zip.length !== 5) return;
    this.loadsService.lookupZip(zip).subscribe({
      next: (res) => {
        if (!this.deliveryCityEdited) {
          this.manualLoadForm.patchValue({ deliveryCity: res?.data?.city || '' });
        }
        if (!this.deliveryStateEdited) {
          this.manualLoadForm.patchValue({ deliveryState: res?.data?.state || '' });
        }
      }
    });
  }

  setAttachmentFiles(files: FileList | null): void {
    this.selectedAttachmentFiles = files;
  }

  saveAttachment(): void {
    this.attachmentError = '';
    if (!this.selectedAttachmentFiles || this.selectedAttachmentFiles.length === 0) {
      this.attachmentError = 'Please select a file first.';
      return;
    }

    if (this.editingLoadId) {
      const loadId = this.editingLoadId;
      const notes = this.uploadAttachmentNotes || '';
      const uploads = Array.from(this.selectedAttachmentFiles).map((file) =>
        this.loadsService.uploadAttachment(loadId, file, this.uploadAttachmentType, notes)
      );
      let completed = 0;
      uploads.forEach((obs) => {
        obs.subscribe({
          next: () => {
            completed += 1;
            if (completed === uploads.length) {
              this.refreshEditingAttachments(loadId);
            }
          },
          error: () => {
            this.attachmentError = 'Failed to upload one or more attachments.';
          }
        });
      });
    } else {
      Array.from(this.selectedAttachmentFiles).forEach((file) => {
        this.pendingAttachments.push({
          file,
          type: this.uploadAttachmentType,
          notes: this.uploadAttachmentNotes || undefined
        });
      });
    }

    this.uploadAttachmentNotes = '';
    this.selectedAttachmentFiles = null;
    this.showUploadModal = false;
  }

  removeAttachment(index: number): void {
    this.pendingAttachments.splice(index, 1);
  }

  handleDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) {
      this.selectedAttachmentFiles = event.dataTransfer.files;
      this.saveAttachment();
    }
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  handleReplaceDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) {
      this.setReplaceAttachmentFile(event.dataTransfer.files);
    }
  }

  // Placeholder hooks for upcoming services/documents logic
  onNewLumper(): void {
    // TODO: implement lumper service creation
    // eslint-disable-next-line no-console
    console.log('New lumper clicked');
  }

  onNewDetention(): void {
    // TODO: implement detention service creation
    // eslint-disable-next-line no-console
    console.log('New detention clicked');
  }

  onOtherAdditions(): void {
    // TODO: implement other additions/deductions creation
    // eslint-disable-next-line no-console
    console.log('Other additions/deductions clicked');
  }

  hasMultipleDocuments(): boolean {
    if (this.editingLoadId) {
      return (this.editingLoadDetail?.attachments?.length ?? 0) > 1;
    }
    return this.pendingAttachments.length > 1;
  }

  mergeDocuments(): void {
    // TODO: implement merge-to-single-PDF behavior
    // eslint-disable-next-line no-console
    console.log('Merge documents clicked');
  }

  editAttachment(att: LoadAttachment): void {
    this.editingAttachment = att;
    this.replaceAttachmentType = att.type;
    this.replaceAttachmentNotes = att.notes ?? '';
    this.replaceAttachmentFile = null;
    this.attachmentError = '';
    this.showReplaceModal = true;
  }

  closeReplaceModal(): void {
    this.editingAttachment = null;
    this.showReplaceModal = false;
    this.replaceAttachmentFile = null;
    this.attachmentError = '';
  }

  setReplaceAttachmentFile(files: FileList | null): void {
    this.replaceAttachmentFile = files?.length ? files[0] : null;
  }

  saveReplaceAttachment(): void {
    if (!this.editingLoadId || !this.editingAttachment) return;
    this.replacingAttachment = true;
    this.attachmentError = '';
    this.loadsService
      .updateAttachment(
        this.editingLoadId,
        this.editingAttachment.id,
        this.replaceAttachmentFile ?? undefined,
        this.replaceAttachmentType,
        this.replaceAttachmentNotes
      )
      .subscribe({
        next: () => {
          this.refreshEditingAttachments(this.editingLoadId!);
          this.closeReplaceModal();
          this.replacingAttachment = false;
        },
        error: (err) => {
          this.attachmentError = err?.error?.error || 'Failed to update document';
          this.replacingAttachment = false;
        }
      });
  }

  deleteAttachment(att: LoadAttachment): void {
    if (!this.editingLoadId) return;
    if (!confirm('Delete this document? This cannot be undone.')) return;
    this.attachmentError = '';
    this.loadsService.deleteAttachment(this.editingLoadId, att.id).subscribe({
      next: () => this.refreshEditingAttachments(this.editingLoadId!),
      error: (err) => {
        this.attachmentError = err?.error?.error || 'Failed to delete document';
      }
    });
  }

  private refreshEditingAttachments(loadId: string): void {
    this.loadsService.getLoad(loadId).subscribe({
      next: (res) => {
        this.editingLoadDetail = res?.data || this.editingLoadDetail;
      }
    });
  }

  validatePickupDelivery(): string[] {
    const errors: string[] = [];
    const pickupZip = (this.manualLoadForm.value.pickupZip || '').toString().trim();
    const pickupCity = (this.manualLoadForm.value.pickupCity || '').toString().trim();
    const pickupState = (this.manualLoadForm.value.pickupState || '').toString().trim();
    const deliveryZip = (this.manualLoadForm.value.deliveryZip || '').toString().trim();
    const deliveryCity = (this.manualLoadForm.value.deliveryCity || '').toString().trim();
    const deliveryState = (this.manualLoadForm.value.deliveryState || '').toString().trim();

    if (!(pickupZip || (pickupCity && pickupState))) {
      errors.push('Pickup ZIP or Pickup City/State is required.');
    }
    if (!(deliveryZip || (deliveryCity && deliveryState))) {
      errors.push('Delivery ZIP or Delivery City/State is required.');
    }
    return errors;
  }

  createLoad(): void {
    this.successMessage = '';
    this.errorMessage = '';
    const isEdit = !!this.editingLoadId;

    this.manualLoadForm.markAllAsTouched();
    const invalidFields: string[] = [];
    const controls = this.manualLoadForm.controls;
    if (controls['status']?.invalid) invalidFields.push('Status');
    if (controls['billingStatus']?.invalid) invalidFields.push('Billing Status');
    if (controls['rate']?.invalid) invalidFields.push('Rate');
    if (!isEdit) {
      if (controls['pickupDate']?.invalid) invalidFields.push('Pickup Date');
      if (controls['deliveryDate']?.invalid) invalidFields.push('Delivery Date');
    }
    if (this.manualLoadForm.invalid && invalidFields.length > 0) {
      this.errorMessage =
        invalidFields.length > 0
          ? `Please fix the following fields before submitting: ${invalidFields.join(', ')}.`
          : 'Please fix the validation errors before submitting.';
      return;
    }

    if (!isEdit) {
      const validationErrors = this.validatePickupDelivery();
      if (validationErrors.length > 0) {
        this.errorMessage = validationErrors.join(' ');
        return;
      }
    }

    const formValue = this.manualLoadForm.getRawValue();
    const stops: LoadStop[] = isEdit && this.sortedStops?.length
      ? this.sortedStops.map((s, i) => ({ ...s, sequence: i + 1 }))
      : [
          {
            stop_type: 'PICKUP',
            stop_date: formValue.pickupDate,
            city: formValue.pickupCity,
            state: formValue.pickupState,
            zip: formValue.pickupZip,
            sequence: 1
          },
          {
            stop_type: 'DELIVERY',
            stop_date: formValue.deliveryDate,
            city: formValue.deliveryCity,
            state: formValue.deliveryState,
            zip: formValue.deliveryZip,
            sequence: 2
          }
        ];

    const payload = {
      status: formValue.status,
      billingStatus: formValue.billingStatus,
      dispatcherUserId: this.dispatcherUserId,
      driverId: formValue.driverId || null,
      truckId: formValue.truckId || null,
      trailerId: formValue.trailerId || null,
      brokerId: formValue.brokerId || null,
      brokerName: formValue.brokerName || null,
      poNumber: formValue.poNumber || null,
      rate: formValue.rate ? Number(formValue.rate) : 0,
      notes: formValue.notes || null,
      stops
    };

    this.creatingLoad = true;
    const request$ = isEdit
      ? this.loadsService.updateLoad(this.editingLoadId as string, payload)
      : this.loadsService.createLoad(payload);

    request$.subscribe({
      next: (res) => {
        const load = res?.data;
        if (!load?.id) {
          this.creatingLoad = false;
          this.errorMessage = isEdit ? 'Failed to update load.' : 'Failed to create load.';
          return;
        }
        if (this.pendingAttachments.length === 0 || isEdit) {
          this.finishCreate(isEdit);
          return;
        }
        const uploads = this.pendingAttachments.map((item) =>
          this.loadsService.uploadAttachment(load.id, item.file, item.type, item.notes)
        );
        let uploaded = 0;
        uploads.forEach((obs) => {
          obs.subscribe({
            next: () => {
              uploaded += 1;
              if (uploaded === uploads.length) {
                this.finishCreate(isEdit);
              }
            },
            error: () => {
              this.errorMessage = 'Load created, but attachment upload failed.';
              this.finishCreate(isEdit);
            }
          });
        });
      },
      error: () => {
        this.creatingLoad = false;
        this.errorMessage = isEdit ? 'Failed to update load.' : 'Failed to create load.';
      }
    });
  }

  finishCreate(isEdit: boolean): void {
    this.creatingLoad = false;
    this.successMessage = isEdit ? 'Load updated successfully.' : 'Load created successfully.';
    this.editingLoadId = null;
    this.closeManualModal();
    this.showInlineNewLoad = false;
    this.loadLoads();
    setTimeout(() => {
      this.successMessage = '';
    }, 4000);
  }

  rowClass(load: LoadListItem): string {
    const status = (load.status || '').toString().toUpperCase();
    if (status === 'DELIVERED') return 'row-delivered';
    if (status === 'CANCELLED') return 'row-cancelled';
    return '';
  }

  /** Build full URL for attachment download (backend serves /uploads). */
  getAttachmentUrl(att: { file_url?: string | null }): string {
    if (!att?.file_url) return '';
    if (att.file_url.startsWith('http://') || att.file_url.startsWith('https://')) {
      return att.file_url;
    }
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return base + (att.file_url.startsWith('/') ? att.file_url : '/' + att.file_url);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.showNewLoadMenu = false;
    this.actionsOpenLoadId = null;
    this.brokerDropdownOpen = false;
    this.driverDropdownOpen = false;
    this.truckDropdownOpen = false;
    this.trailerDropdownOpen = false;
  }

  // Auto-create from PDF handlers

  onAutoFileSelected(files: FileList | null): void {
    this.autoError = '';
    this.autoPdfFile = files && files.length > 0 ? files[0] : null;
  }

  runAutoExtraction(): void {
    this.autoError = '';
    if (!this.autoPdfFile) {
      this.autoError = 'Please select a PDF file first.';
      return;
    }
    this.autoExtracting = true;
    this.loadsService.aiExtractFromPdf(this.autoPdfFile).subscribe({
      next: (res) => {
        this.autoExtracting = false;
        const data = res?.data;
        if (!data) {
          this.autoError = 'Extraction returned no data. You can continue with manual entry.';
          // Queue attachment and open manual entry anyway
          this.pendingAttachments.push({
            file: this.autoPdfFile as File,
            type: 'RATE_CONFIRMATION',
            notes: 'Uploaded via Auto-Create'
          });
          this.showAutoModal = false;
          this.showManualModal = true;
          return;
        }
        this.autoExtraction = data;

        // If the backend reports no text / vision-only PDF, surface that clearly.
        if (data.provider === 'none' && data.warning) {
          this.autoError = data.warning;
          // Attach the PDF but keep the user in manual mode.
          this.pendingAttachments.push({
            file: this.autoPdfFile as File,
            type: 'RATE_CONFIRMATION',
            notes: 'Rate confirmation (scanned PDF - manual entry)'
          });
          this.showAutoModal = false;
          this.showManualModal = true;
          return;
        }

        // Normal case: we have structured extraction to apply.
        this.pendingAttachments.push({
          file: this.autoPdfFile as File,
          type: 'RATE_CONFIRMATION',
          notes: 'Rate confirmation (Auto-Create PDF)'
        });
        this.applyExtractionToForm(data);
        this.showAutoModal = false;
        this.showManualModal = true;
      },
      error: (err) => {
        console.error('AI extract failed', err);
        this.autoExtracting = false;
        this.autoError =
          'Failed to extract from PDF. You can still create the load manually and the PDF will be attached.';
        // Still attach the PDF and open manual entry so the user can continue.
        if (this.autoPdfFile) {
          this.pendingAttachments.push({
            file: this.autoPdfFile,
            type: 'RATE_CONFIRMATION',
            notes: 'Rate confirmation (Auto-Create PDF)'
          });
        }
        this.showAutoModal = false;
        this.showManualModal = true;
      }
    });
  }

  // Recompute gross totals on the current page for dashboard summary
  private recomputeSummaryTotals(): void {
    const byStatus: { [key: string]: number } = {};
    const byBilling: { [key: string]: number } = {};
    let total = 0;

    (this.loads || []).forEach((load) => {
      const rate = load.rate != null ? Number(load.rate) : 0;
      total += rate;
      const statusKey = (load.status || '').toString().toUpperCase();
      const billingKey = (load.billing_status || '').toString().toUpperCase();
      if (statusKey) {
        byStatus[statusKey] = (byStatus[statusKey] || 0) + rate;
      }
      if (billingKey) {
        byBilling[billingKey] = (byBilling[billingKey] || 0) + rate;
      }
    });

    this.summaryTotals = {
      totalGross: total,
      byStatus,
      byBilling
    };
  }

  // Apply header row filters client-side on the current page of loads
  get filteredLoads(): LoadListItem[] {
    const hf = this.headerFilters;
    return (this.loads || []).filter((load) => {
      // Date filter on pickup_date or delivery/completed date
      if (hf.date) {
        const filterStr = hf.date.toString();
        const dateStr = (load.pickup_date || load.delivery_date || load.completed_date || '').toString();
        if (!dateStr.includes(filterStr)) return false;
      }

      if (hf.broker) {
        const broker = (load.broker_name || '').toString().toLowerCase();
        if (!broker.includes(hf.broker.toLowerCase())) return false;
      }

      if (hf.po) {
        const po = (load.po_number || '').toString().toLowerCase();
        if (!po.includes(hf.po.toLowerCase())) return false;
      }

      if (hf.pickup) {
        const pickupLoc = `${load.pickup_city || ''} ${load.pickup_state || ''}`.toLowerCase();
        if (!pickupLoc.includes(hf.pickup.toLowerCase())) return false;
      }

      if (hf.delivery) {
        const deliveryLoc = `${load.delivery_city || ''} ${load.delivery_state || ''}`.toLowerCase();
        if (!deliveryLoc.includes(hf.delivery.toLowerCase())) return false;
      }

      if (hf.rate) {
        const rateStr = load.rate != null ? String(load.rate) : '';
        if (!rateStr.includes(hf.rate)) return false;
      }

      if (hf.notes) {
        const notes = (load.notes || '').toString().toLowerCase();
        if (!notes.includes(hf.notes.toLowerCase())) return false;
      }

      if (hf.attachmentType) {
        const types = Array.isArray(load.attachment_types) ? load.attachment_types : [];
        if (!types.includes(hf.attachmentType as any)) return false;
      }

      return true;
    });
  }

  // Active filter chips for UI summary
  get activeFilterChips(): Array<{
    key: string;
    label: string;
    value: string;
    kind: 'header' | 'status' | 'billing' | 'driver';
  }> {
    const chips: Array<{
      key: string;
      label: string;
      value: string;
      kind: 'header' | 'status' | 'billing' | 'driver';
    }> = [];

    // Header filters
    (Object.keys(this.headerFilters) as Array<keyof typeof this.headerFilters>).forEach((key) => {
      const value = (this.headerFilters[key] || '').toString().trim();
      if (!value) return;
      chips.push({
        key,
        label: this.headerFilterLabels[key],
        value,
        kind: 'header'
      });
    });

    // Status filter
    if (this.filters.status) {
      chips.push({
        key: 'status',
        label: 'Status',
        value: this.filters.status.replace('_', ' '),
        kind: 'status'
      });
    }

    // Billing filter
    if (this.filters.billingStatus) {
      chips.push({
        key: 'billingStatus',
        label: 'Billing',
        value: this.filters.billingStatus.replace('_', ' '),
        kind: 'billing'
      });
    }

    // Driver filter
    if (this.filters.driverId) {
      const driver = this.drivers.find((d) => d.id === this.filters.driverId);
      chips.push({
        key: 'driverId',
        label: 'Driver',
        value: driver?.name || 'Selected driver',
        kind: 'driver'
      });
    }

    return chips;
  }

  clearFilterChip(chip: { key: string; kind: 'header' | 'status' | 'billing' | 'driver' }): void {
    if (chip.kind === 'header') {
      this.headerFilters = {
        ...this.headerFilters,
        [chip.key]: ''
      };
      return;
    }

    if (chip.kind === 'status') {
      this.filters.status = '';
      this.page = 1;
      this.loadLoads();
      return;
    }

    if (chip.kind === 'billing') {
      this.filters.billingStatus = '';
      this.page = 1;
      this.loadLoads();
      return;
    }

    if (chip.kind === 'driver') {
      this.filters.driverId = '';
      this.page = 1;
      this.loadLoads();
    }
  }

  clearAllFilters(): void {
    this.headerFilters = {
      date: '',
      broker: '',
      po: '',
      pickup: '',
      delivery: '',
      rate: '',
      notes: '',
      attachmentType: ''
    };

    this.filters = {
      ...this.filters,
      status: '',
      billingStatus: '',
      driverId: ''
    };

    this.page = 1;
    this.loadLoads();
  }
}
