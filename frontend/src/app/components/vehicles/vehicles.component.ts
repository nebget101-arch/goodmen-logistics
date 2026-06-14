import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { debounceTime, forkJoin, Subject, Subscription } from 'rxjs';
import { PermissionHelperService } from '../../services/permission-helper.service';
import { PERMISSIONS } from '../../models/access-control.model';
import { environment } from '../../../environments/environment';

interface Vehicle {
  id: string;
  unit_number: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  license_plate: string;
  state: string;
  status: string;
  mileage: number;
  inspection_expiry: string;
  next_pm_due: string;
  next_pm_mileage: number;
  oos_reason?: string;
  registration_expiry?: string;
  insurance_expiry?: string;
  vehicle_type?: string;
  company_owned?: boolean;
  equipment_owner_id?: string | null;
  equipment_owner_name?: string | null;
  trailer_details?: any;
  // FN-1784: DOT readiness, when surfaced by the list/equipment endpoints.
  ready?: boolean;
  readiness?: {
    ready: boolean;
    requiredDocuments?: string[];
    missing?: string[];
    expired?: string[];
  };
}

interface VehicleReadinessView {
  ready: boolean;
  missing: string[];
  expired: string[];
  requiredDocuments: string[];
}

type SortField = 'unit_number' | 'inspection_expiry';
type SortOrder = 'asc' | 'desc';
type Ownership = 'company' | 'oo' | 'leased';
type OwnershipFilter = 'all' | Ownership;
type DetailTab = 'overview' | 'maintenance';

interface MaintenanceInvoice {
  id: string;
  number: string | null;
  status: string | null;
  amount_due: number | null;
  pdf_url: string;
}

interface MaintenanceRow {
  work_order_id: string;
  work_order_number: string | null;
  type: string | null;
  status: string | null;
  title: string | null;
  request_date: string | null;
  completion_date: string | null;
  shop_location_name: string | null;
  labor_total: number | null;
  parts_total: number | null;
  grand_total: number | null;
  invoice?: MaintenanceInvoice | null;
}

interface MaintenanceMeta {
  page: number;
  pageSize: number;
  total: number;
  lifetime_spend: number;
}

@Component({
  selector: 'app-vehicles',
  templateUrl: './vehicles.component.html',
  styleUrls: ['./vehicles.component.css']
})
export class VehiclesComponent implements OnInit, OnDestroy {
  readonly perms = PERMISSIONS;
  // Data state
  allVehicles: Vehicle[] = [];
  filteredVehicles: Vehicle[] = [];
  paginatedVehicles: Vehicle[] = [];
  loading = true;
  error: string | null = null;
  skeletonRows = Array(5).fill(0);

  // Search and filter state
  searchQuery = '';
  selectedStatus = 'all';
  selectedOwnership: OwnershipFilter = 'all';
  presetFilter: 'maintenance-due' | null = null;
  private searchSubject = new Subject<string>();
  private searchSubscription: Subscription | null = null;

  // Driver lookup for trailer rows (assigned_driver_id → display name)
  private driverByTrailerId = new Map<string, string>();

  // Ownership filter chip-set options
  ownershipOptions: { value: OwnershipFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'company', label: 'Company' },
    { value: 'oo', label: 'OO' },
    { value: 'leased', label: 'Leased' }
  ];

  // Sort state
  sortField: SortField = 'unit_number';
  
  // Detail view state
  selectedVehicleDetails: Vehicle | null = null;
  showVehicleDetails = false;
  sortOrder: SortOrder = 'asc';

  // Detail-drawer tabs (FN-1390 — Maintenance History)
  activeDetailTab: DetailTab = 'overview';
  maintenanceHistoryLoading = false;
  maintenanceHistoryError = '';
  maintenanceHistoryLoaded = false;
  maintenanceRows: MaintenanceRow[] = [];
  maintenanceMeta: MaintenanceMeta = { page: 1, pageSize: 25, total: 0, lifetime_spend: 0 };
  maintenancePage = 1;
  readonly maintenancePageSize = 25;

  equipmentSafetyLoading = false;
  equipmentSafetyError = '';
  equipmentSafetySummary: {
    totalIncidents: number;
    openIncidents: number;
    preventableIncidents: number;
    dotRecordableIncidents: number;
    totalEstimatedLoss: number;
    lastIncidentDate: string | null;
    recentIncidents: any[];
  } = {
    totalIncidents: 0,
    openIncidents: 0,
    preventableIncidents: 0,
    dotRecordableIncidents: 0,
    totalEstimatedLoss: 0,
    lastIncidentDate: null,
    recentIncidents: []
  };

  // Pagination state
  currentPage = 1;
  itemsPerPage = 100;
  totalPages = 1;
  pageSizeOptions = [25, 50, 100];
  pageSizeSelectOptions = [
    { value: 25, label: '25 items' },
    { value: 50, label: '50 items' },
    { value: 100, label: '100 items' }
  ];

  // Modal state
  showVehicleForm = false;
  selectedVehicle: Vehicle | null = null;

  // Status filter options
  statusOptions = [
    { value: 'all', label: 'All' },
    { value: 'in-service', label: 'In Service' },
    { value: 'out-of-service', label: 'Out of Service' }
  ];

  vehicleType: 'truck' | 'trailer' = 'truck';

  constructor(
    private apiService: ApiService,
    private route: ActivatedRoute,
    private permissions: PermissionHelperService
  ) { }

  ngOnInit(): void {
    this.route.data.subscribe(data => {
      this.vehicleType = (data['vehicleType'] || 'truck') as 'truck' | 'trailer';
      this.loadVehicles();
    });

    this.route.queryParams.subscribe(params => {
      const filter = params['filter'];
      if (filter === 'oos') {
        this.selectedStatus = 'out-of-service';
        this.presetFilter = null;
      } else if (filter === 'maintenance-due') {
        this.selectedStatus = 'all';
        this.presetFilter = 'maintenance-due';
      } else {
        this.selectedStatus = 'all';
        this.presetFilter = null;
      }
      this.applyFiltersAndSort();
    });

    // Debounce search input to reduce API calls
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(300)
    ).subscribe(query => {
      this.searchQuery = query;
      this.applyFiltersAndSort();
    });
  }

  ngOnDestroy(): void {
    this.searchSubscription?.unsubscribe();
    this.searchSubscription = null;
    this.searchSubject.complete();
  }

  loadVehicles(): void {
    this.loading = true;
    this.error = null;

    forkJoin({
      vehicles: this.apiService.getVehicles(),
      drivers: this.apiService.getDrivers()
    }).subscribe({
      next: ({ vehicles, drivers }) => {
        // Sanitize nullable string fields to prevent .slice()/.toLowerCase() crashes
        this.allVehicles = (vehicles || []).map((v: Vehicle) => ({
          ...v,
          unit_number: v.unit_number || '',
          vin: v.vin || '',
          make: v.make || '',
          model: v.model || '',
          license_plate: v.license_plate || '',
          state: v.state || '',
          status: v.status || 'in-service',
        }));

        // Build trailer-id → driver-name map for trailer-row "Driver" display
        this.driverByTrailerId.clear();
        const driverList = Array.isArray(drivers?.data)
          ? drivers.data
          : (Array.isArray(drivers) ? drivers : []);
        for (const d of driverList) {
          const trailerId = d?.trailer_id || d?.trailerId;
          if (!trailerId) continue;
          const name = `${d?.first_name || ''} ${d?.last_name || ''}`.trim();
          if (name) this.driverByTrailerId.set(String(trailerId), name);
        }

        this.applyFiltersAndSort();
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading vehicles:', error);
        this.error = 'Failed to load vehicles. Please try again later.';
        this.loading = false;
      }
    });
  }

  onSearchInput(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    this.searchSubject.next(query);
  }

  onStatusChange(status: string): void {
    this.selectedStatus = status;
    this.applyFiltersAndSort();
  }

  onSortChange(field: SortField): void {
    if (this.sortField === field) {
      // Toggle sort order if same field
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      // New field, default to ascending
      this.sortField = field;
      this.sortOrder = 'asc';
    }
    this.applyFiltersAndSort();
  }

  applyFiltersAndSort(): void {
    let result = [...this.allVehicles];

    // Filter to selected vehicle type (truck vs trailer); ownership filter handled below
    result = result.filter(vehicle => this.normalizeVehicleType(vehicle.vehicle_type) === this.vehicleType);

    // Apply search filter
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      result = result.filter(vehicle =>
        (vehicle.unit_number || '').toLowerCase().includes(query) ||
        (vehicle.license_plate || '').toLowerCase().includes(query) ||
        (vehicle.vin || '').toLowerCase().includes(query) ||
        (vehicle.make || '').toLowerCase().includes(query) ||
        (vehicle.model || '').toLowerCase().includes(query) ||
        `${vehicle.make || ''} ${vehicle.model || ''}`.toLowerCase().includes(query)
      );
    }

    // Apply preset filter (from dashboard links)
    if (this.presetFilter === 'maintenance-due') {
      const today = new Date();
      const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      result = result.filter(vehicle => {
        const due = vehicle.next_pm_due ? new Date(vehicle.next_pm_due) : null;
        return due && due <= thirtyDaysFromNow;
      });
    }

    // Apply status filter
    if (this.selectedStatus !== 'all') {
      result = result.filter(vehicle => this.normalizeStatus(vehicle.status) === this.selectedStatus);
    }

    // Apply ownership filter
    if (this.selectedOwnership !== 'all') {
      result = result.filter(vehicle => this.getOwnership(vehicle) === this.selectedOwnership);
    }

    // Apply sorting
    result.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      if (this.sortField === 'unit_number') {
        aValue = a.unit_number || '';
        bValue = b.unit_number || '';
      } else if (this.sortField === 'inspection_expiry') {
        aValue = a.inspection_expiry ? new Date(a.inspection_expiry).getTime() : 0;
        bValue = b.inspection_expiry ? new Date(b.inspection_expiry).getTime() : 0;
      }

      if (aValue < bValue) return this.sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return this.sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    this.filteredVehicles = result;
    this.totalPages = Math.ceil(this.filteredVehicles.length / this.itemsPerPage);
    
    // Reset to first page when filters change
    this.currentPage = 1;
    this.updatePagination();
  }

  get pageTitle(): string {
    return this.vehicleType === 'trailer' ? 'Trailers' : 'Trucks';
  }

  get addLabel(): string {
    return this.vehicleType === 'trailer' ? 'Add Trailer' : 'Add Truck';
  }

  get emptyLabel(): string {
    return this.vehicleType === 'trailer' ? 'trailers' : 'trucks';
  }

  get singularLabel(): string {
    return this.vehicleType === 'trailer' ? 'Trailer' : 'Truck';
  }

  updatePagination(): void {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    this.paginatedVehicles = this.filteredVehicles.slice(startIndex, endIndex);
    console.log('Pagination update - Filtered:', this.filteredVehicles.length, 'Paginated:', this.paginatedVehicles.length, 'Page:', this.currentPage);
  }

  onPageChange(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updatePagination();
    }
  }

  onPageSizeChange(size: number): void {
    this.itemsPerPage = size;
    this.totalPages = Math.ceil(this.filteredVehicles.length / this.itemsPerPage);
    this.currentPage = 1;
    this.updatePagination();
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.selectedStatus = 'all';
    this.selectedOwnership = 'all';
    this.presetFilter = null;
    this.sortField = 'unit_number';
    this.sortOrder = 'asc';
    this.currentPage = 1;
    this.itemsPerPage = 100;
    this.applyFiltersAndSort();
  }

  onOwnershipChange(value: OwnershipFilter): void {
    this.selectedOwnership = value;
    this.applyFiltersAndSort();
  }

  /** Derive ownership classification from existing vehicle fields. */
  getOwnership(vehicle: Vehicle): Ownership {
    const trailerOwnership = (vehicle.trailer_details?.ownership || '').toString().trim().toLowerCase();
    if (trailerOwnership === 'leased') return 'leased';
    if (vehicle.company_owned === false) return 'oo';
    return 'company';
  }

  getOwnershipLabel(vehicle: Vehicle): string {
    const o = this.getOwnership(vehicle);
    if (o === 'oo') return 'OO';
    if (o === 'leased') return 'LEASED';
    return 'COMPANY';
  }

  getOwnershipChipClass(vehicle: Vehicle): string {
    return `chip-ownership chip-ownership--${this.getOwnership(vehicle)}`;
  }

  /** Trailer-only: combined "code — label" string from trailer_details. */
  getTrailerType(vehicle: Vehicle): string {
    const code = (vehicle.trailer_details?.trailer_type_code || '').toString().trim();
    const label = (vehicle.trailer_details?.trailer_type_label || '').toString().trim();
    if (code && label) return `${code} — ${label}`;
    return code || label || '';
  }

  /** Trailer-only: assigned driver display name (looked up via drivers index). */
  getTrailerDriver(vehicle: Vehicle): string {
    return this.driverByTrailerId.get(String(vehicle.id)) || '';
  }

  /** Compose plate + state with em-dash placeholder when blank. */
  getPlateState(vehicle: Vehicle): string {
    const plate = (vehicle.license_plate || '').trim();
    const state = (vehicle.state || '').trim();
    if (plate && state) return `${plate} (${state})`;
    return plate || state || '—';
  }

  retryLoad(): void {
    this.loadVehicles();
  }

  getStatusBadge(status: string): string {
    return this.normalizeStatus(status) === 'in-service' ? 'badge-success' : 'badge-danger';
  }

  getStatusLabel(status: string): string {
    return this.normalizeStatus(status) === 'in-service' ? 'In Service' : 'Out of Service';
  }

  // ── FN-1784: DOT document readiness badge ──────────────────────────────

  /** Required DOT document set keyed by vehicle type (mirrors the rule engine). */
  private requiredDocsForType(vehicleType: string | null | undefined): string[] {
    return this.normalizeVehicleType(vehicleType) === 'trailer'
      ? ['registration', 'inspection']
      : ['registration', 'insurance', 'inspection', 'ifta'];
  }

  /**
   * Resolve a vehicle's readiness, preferring server-provided data and falling
   * back to the expiry columns we have locally (registration/insurance/
   * inspection). The fallback can't see IFTA documents, so it never reports
   * IFTA as missing — the backend readiness/422 remains authoritative there.
   */
  getVehicleReadiness(vehicle: Vehicle): VehicleReadinessView {
    const r = vehicle.readiness;
    if (r && typeof r.ready === 'boolean') {
      return {
        ready: r.ready,
        missing: r.missing ?? [],
        expired: r.expired ?? [],
        requiredDocuments: r.requiredDocuments ?? []
      };
    }
    if (typeof vehicle.ready === 'boolean') {
      return { ready: vehicle.ready, missing: [], expired: [], requiredDocuments: [] };
    }
    return this.computeReadinessFallback(vehicle);
  }

  private computeReadinessFallback(vehicle: Vehicle): VehicleReadinessView {
    const required = this.requiredDocsForType(vehicle.vehicle_type);
    const columnByDoc: Record<string, string | undefined> = {
      registration: vehicle.registration_expiry,
      insurance: vehicle.insurance_expiry,
      inspection: vehicle.inspection_expiry
    };
    const missing: string[] = [];
    const expired: string[] = [];
    for (const doc of required) {
      if (!(doc in columnByDoc)) continue; // e.g. ifta — not derivable from columns
      const expiry = columnByDoc[doc];
      if (!expiry) {
        missing.push(doc);
      } else if (this.getDaysUntilExpiry(expiry) < 0) {
        expired.push(doc);
      }
    }
    return {
      ready: missing.length === 0 && expired.length === 0,
      missing,
      expired,
      requiredDocuments: required
    };
  }

  isVehicleReady(vehicle: Vehicle): boolean {
    return this.getVehicleReadiness(vehicle).ready;
  }

  /** Active (in-service) unit that is no longer document-ready — the key flag. */
  isActiveButNotReady(vehicle: Vehicle): boolean {
    return this.normalizeStatus(vehicle.status) === 'in-service' && !this.isVehicleReady(vehicle);
  }

  getReadinessBadgeClass(vehicle: Vehicle): string {
    if (this.isVehicleReady(vehicle)) return 'badge-success';
    // A lapsed *active* unit is the urgent case → danger; otherwise advisory amber.
    return this.normalizeStatus(vehicle.status) === 'in-service' ? 'badge-danger' : 'badge-warning';
  }

  getReadinessLabel(vehicle: Vehicle): string {
    return this.isVehicleReady(vehicle) ? 'Ready' : 'Not Ready';
  }

  getReadinessTooltip(vehicle: Vehicle): string {
    const view = this.getVehicleReadiness(vehicle);
    if (view.ready) return 'All required DOT documents are valid';
    const parts: string[] = [];
    if (view.missing.length) parts.push(`Missing: ${view.missing.map(d => this.readinessDocLabel(d)).join(', ')}`);
    if (view.expired.length) parts.push(`Expired: ${view.expired.map(d => this.readinessDocLabel(d)).join(', ')}`);
    return parts.length ? parts.join(' · ') : 'Required DOT documents are incomplete';
  }

  private readinessDocLabel(doc: string): string {
    const labels: Record<string, string> = {
      registration: 'Registration',
      insurance: 'Insurance',
      inspection: 'Annual Inspection',
      ifta: 'IFTA'
    };
    return labels[doc] || (doc.charAt(0).toUpperCase() + doc.slice(1));
  }

  private normalizeStatus(status: string | null | undefined): string {
    return (status || '').toString().trim().toLowerCase().replace(/[_\s]+/g, '-');
  }

  private normalizeVehicleType(value: string | null | undefined): 'truck' | 'trailer' {
    const normalized = (value || '').toString().trim().toLowerCase();
    if (normalized.includes('trailer')) return 'trailer';
    return 'truck';
  }

  trackByVehicleId(index: number, vehicle: Vehicle): string {
    return vehicle.id;
  }

  getSortIcon(field: SortField): string {
    if (this.sortField !== field) return '⇅';
    return this.sortOrder === 'asc' ? '↑' : '↓';
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const maxVisible = 5;
    
    if (this.totalPages <= maxVisible) {
      for (let i = 1; i <= this.totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (this.currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push(-1); // ellipsis
        pages.push(this.totalPages);
      } else if (this.currentPage >= this.totalPages - 2) {
        pages.push(1);
        pages.push(-1);
        for (let i = this.totalPages - 3; i <= this.totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push(-1);
        for (let i = this.currentPage - 1; i <= this.currentPage + 1; i++) pages.push(i);
        pages.push(-1);
        pages.push(this.totalPages);
      }
    }
    
    return pages;
  }

  get hasActiveFilters(): boolean {
    return this.searchQuery.trim() !== ''
      || this.selectedStatus !== 'all'
      || this.selectedOwnership !== 'all';
  }

  get displayingRange(): string {
    if (this.filteredVehicles.length === 0) return '0-0 of 0';
    const start = (this.currentPage - 1) * this.itemsPerPage + 1;
    const end = Math.min(this.currentPage * this.itemsPerPage, this.filteredVehicles.length);
    return `${start}-${end} of ${this.filteredVehicles.length}`;
  }

  openAddVehicleForm(): void {
    console.log('[VEHICLE] openAddVehicleForm called, canCreate:', this.canCreateVehicle());
    try {
      if (!this.canCreateVehicle()) {
        console.warn('[VEHICLE] Cannot create vehicle — permission denied');
        return;
      }
      this.selectedVehicle = null;
      this.showVehicleForm = true;
      console.log('[VEHICLE] showVehicleForm set to:', this.showVehicleForm);
    } catch (err) {
      console.error('[VEHICLE] Error opening add vehicle form:', err);
      this.showVehicleForm = true;
    }
  }

  openEditVehicleForm(vehicle: Vehicle): void {
    if (!this.canEditVehicle()) return;
    this.selectedVehicle = vehicle;
    this.showVehicleForm = true;
  }

  canCreateVehicle(): boolean {
    return this.permissions.hasAnyPermission([PERMISSIONS.VEHICLES_CREATE, PERMISSIONS.VEHICLES_EDIT]);
  }

  canEditVehicle(): boolean {
    return this.permissions.hasPermission(PERMISSIONS.VEHICLES_EDIT);
  }

  closeVehicleForm(): void {
    this.showVehicleForm = false;
    this.selectedVehicle = null;
  }

  onVehicleSaved(vehicle: Vehicle): void {
    // Reload vehicles to get updated data
    this.loadVehicles();
  }

  getDaysUntilExpiry(dateString: string): number {
    const expiryDate = new Date(dateString);
    const today = new Date();
    const diffTime = expiryDate.getTime() - today.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  getExpiryWarning(vehicle: Vehicle): string | null {
    const messages: string[] = [];
    
    // Check registration expiry
    if (vehicle.registration_expiry) {
      const daysUntilExpiry = this.getDaysUntilExpiry(vehicle.registration_expiry);
      if (daysUntilExpiry < 0) {
        messages.push('Registration expired');
      } else if (daysUntilExpiry <= 60) {
        messages.push(`Registration expires in ${daysUntilExpiry} days`);
      }
    }
    
    // Check inspection expiry
    if (vehicle.inspection_expiry) {
      const daysUntilExpiry = this.getDaysUntilExpiry(vehicle.inspection_expiry);
      if (daysUntilExpiry < 0) {
        messages.push('Annual inspection overdue');
      } else if (daysUntilExpiry <= 60) {
        messages.push(`Inspection expires in ${daysUntilExpiry} days`);
      }
    }
    
    return messages.length > 0 ? messages.join(' | ') : null;
  }

  getWarningClass(vehicle: Vehicle): string {
    const message = this.getExpiryWarning(vehicle);
    if (!message) return '';
    if (message.includes('expired') || message.includes('overdue')) return 'error-critical';
    if (message.includes('expires') || message.includes('due in')) return 'warning-upcoming';
    return '';
  }

  isVehicleExpired(vehicle: Vehicle): boolean {
    // Check if registration is expired
    if (vehicle.registration_expiry) {
      const daysUntilExpiry = this.getDaysUntilExpiry(vehicle.registration_expiry);
      if (daysUntilExpiry < 0) return true;
    }
    
    // Check if inspection is expired
    if (vehicle.inspection_expiry) {
      const daysUntilExpiry = this.getDaysUntilExpiry(vehicle.inspection_expiry);
      if (daysUntilExpiry < 0) return true;
    }
    
    return false;
  }

  openVehicleDetails(vehicle: Vehicle): void {
    this.selectedVehicleDetails = vehicle;
    this.showVehicleDetails = true;
    this.activeDetailTab = 'overview';
    this.resetMaintenanceHistoryState();
    this.loadEquipmentSafetySummary(vehicle.id);
  }

  closeVehicleDetails(): void {
    this.showVehicleDetails = false;
    this.selectedVehicleDetails = null;
    this.activeDetailTab = 'overview';
    this.resetMaintenanceHistoryState();
    this.equipmentSafetyError = '';
    this.equipmentSafetySummary = {
      totalIncidents: 0,
      openIncidents: 0,
      preventableIncidents: 0,
      dotRecordableIncidents: 0,
      totalEstimatedLoss: 0,
      lastIncidentDate: null,
      recentIncidents: []
    };
  }

  selectDetailTab(tab: DetailTab): void {
    if (this.activeDetailTab === tab) return;
    this.activeDetailTab = tab;
    if (tab === 'maintenance' && !this.maintenanceHistoryLoaded && this.selectedVehicleDetails) {
      this.loadMaintenanceHistory(this.selectedVehicleDetails.id, 1);
    }
  }

  loadMaintenanceHistory(vehicleId: string, page: number): void {
    if (!vehicleId) return;
    this.maintenanceHistoryLoading = true;
    this.maintenanceHistoryError = '';
    this.maintenancePage = page;

    this.apiService.getVehicleMaintenanceHistory(vehicleId, page, this.maintenancePageSize).subscribe({
      next: (resp: any) => {
        this.maintenanceRows = Array.isArray(resp?.data) ? resp.data : [];
        const meta = resp?.meta || {};
        this.maintenanceMeta = {
          page: Number(meta.page) || page,
          pageSize: Number(meta.pageSize) || this.maintenancePageSize,
          total: Number(meta.total) || 0,
          lifetime_spend: Number(meta.lifetime_spend) || 0
        };
        this.maintenanceHistoryLoaded = true;
        this.maintenanceHistoryLoading = false;
      },
      error: () => {
        this.maintenanceHistoryError = 'Unable to load maintenance history.';
        this.maintenanceHistoryLoading = false;
      }
    });
  }

  retryMaintenanceHistory(): void {
    if (!this.selectedVehicleDetails) return;
    this.loadMaintenanceHistory(this.selectedVehicleDetails.id, this.maintenancePage || 1);
  }

  onMaintenancePageChange(page: number): void {
    if (!this.selectedVehicleDetails) return;
    if (page < 1 || page > this.maintenanceTotalPages) return;
    this.loadMaintenanceHistory(this.selectedVehicleDetails.id, page);
  }

  get maintenanceTotalPages(): number {
    const size = this.maintenanceMeta?.pageSize || this.maintenancePageSize;
    return Math.max(1, Math.ceil((this.maintenanceMeta?.total || 0) / size));
  }

  get lastWorkOrderDate(): string | null {
    // Rows come back ordered by work_orders.created_at DESC, so the first row of page 1 is the latest.
    if (this.maintenancePage !== 1 || !this.maintenanceRows.length) return null;
    const first = this.maintenanceRows[0];
    return first?.completion_date || first?.request_date || null;
  }

  canViewInvoices(): boolean {
    return this.permissions.hasPermission(PERMISSIONS.INVOICES_VIEW);
  }

  /** Scope: row click → open /work-order/:id in a new tab. */
  openWorkOrder(row: MaintenanceRow): void {
    if (!row?.work_order_id) return;
    window.open(`/work-order/${row.work_order_id}`, '_blank', 'noopener');
  }

  /**
   * Scope: invoice pill click → download PDF.
   * Open the gateway URL in a new tab — the API streams the PDF.
   */
  openInvoicePdf(invoice: MaintenanceInvoice | null | undefined, event?: Event): void {
    if (event) event.stopPropagation();
    if (!invoice?.id) return;
    window.open(`${environment.apiUrl}/invoices/${invoice.id}/pdf`, '_blank', 'noopener');
  }

  getMaintenanceStatusBadge(status: string | null | undefined): string {
    const normalized = (status || '').toString().trim().toUpperCase();
    if (normalized === 'COMPLETED' || normalized === 'CLOSED' || normalized === 'INVOICED') return 'badge-success';
    if (normalized === 'CANCELED' || normalized === 'CANCELLED') return 'badge-muted';
    if (normalized === 'IN_PROGRESS' || normalized === 'OPEN') return 'badge-info';
    return 'badge-warning';
  }

  getMaintenanceStatusLabel(status: string | null | undefined): string {
    const normalized = (status || '').toString().trim();
    if (!normalized) return '—';
    return normalized.replace(/_/g, ' ');
  }

  trackByMaintenanceRow(_index: number, row: MaintenanceRow): string {
    return row?.work_order_id || String(_index);
  }

  private resetMaintenanceHistoryState(): void {
    this.maintenanceHistoryLoading = false;
    this.maintenanceHistoryError = '';
    this.maintenanceHistoryLoaded = false;
    this.maintenanceRows = [];
    this.maintenanceMeta = { page: 1, pageSize: this.maintenancePageSize, total: 0, lifetime_spend: 0 };
    this.maintenancePage = 1;
  }

  loadEquipmentSafetySummary(vehicleId: string): void {
    if (!vehicleId) return;
    this.equipmentSafetyLoading = true;
    this.equipmentSafetyError = '';

    this.apiService.getSafetyIncidents({ vehicle_id: vehicleId, page: 1, pageSize: 100 }).subscribe({
      next: (resp: any) => {
        const incidents = Array.isArray(resp?.data) ? resp.data : [];
        const sorted = [...incidents].sort((a: any, b: any) => {
          const aTime = new Date(a?.incident_date || 0).getTime();
          const bTime = new Date(b?.incident_date || 0).getTime();
          return bTime - aTime;
        });

        this.equipmentSafetySummary = {
          totalIncidents: incidents.length,
          openIncidents: incidents.filter((i: any) => i?.status && i.status !== 'closed').length,
          preventableIncidents: incidents.filter((i: any) => i?.preventability === 'preventable').length,
          dotRecordableIncidents: incidents.filter((i: any) => !!i?.dot_recordable).length,
          totalEstimatedLoss: incidents.reduce((sum: number, i: any) => sum + Number(i?.estimated_loss_amount || 0), 0),
          lastIncidentDate: sorted[0]?.incident_date || null,
          recentIncidents: sorted.slice(0, 3)
        };
        this.equipmentSafetyLoading = false;
      },
      error: () => {
        this.equipmentSafetyError = 'Unable to load accident history summary.';
        this.equipmentSafetyLoading = false;
      }
    });
  }

  safetyStatusClass(status: string): string {
    return status === 'closed' ? 'safety-status-closed' : 'safety-status-open';
  }
}
