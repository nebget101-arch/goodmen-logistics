import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { debounceTime, Subject } from 'rxjs';
import { PermissionHelperService } from '../../services/permission-helper.service';
import { PERMISSIONS } from '../../models/access-control.model';

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
  vehicle_type?: string;
  company_owned?: boolean;
}

type SortField = 'unit_number' | 'inspection_expiry';
type SortOrder = 'asc' | 'desc';

@Component({
  selector: 'app-vehicles',
  templateUrl: './vehicles.component.html',
  styleUrls: ['./vehicles.component.css']
})
export class VehiclesComponent implements OnInit {
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
  presetFilter: 'maintenance-due' | null = null;
  private searchSubject = new Subject<string>();

  // Sort state
  sortField: SortField = 'unit_number';
  
  // Detail view state
  selectedVehicleDetails: Vehicle | null = null;
  showVehicleDetails = false;
  sortOrder: SortOrder = 'asc';

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
    this.searchSubject.pipe(
      debounceTime(300)
    ).subscribe(query => {
      this.searchQuery = query;
      this.applyFiltersAndSort();
    });
  }

  loadVehicles(): void {
    this.loading = true;
    this.error = null;
    
    this.apiService.getVehicles().subscribe({
      next: (data) => {
        console.log('API returned:', data?.length, 'vehicles');
        // All vehicles from API are company-owned
        this.allVehicles = (data || []);
        console.log('Processing:', this.allVehicles.length, 'vehicles');
        console.log('First vehicle:', this.allVehicles[0]);
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

    // Filter to company-owned equipment and selected type
    result = result.filter(vehicle => vehicle.company_owned !== false);
    result = result.filter(vehicle => this.normalizeVehicleType(vehicle.vehicle_type) === this.vehicleType);

    // Apply search filter
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      result = result.filter(vehicle => 
        vehicle.unit_number.toLowerCase().includes(query) ||
        vehicle.license_plate.toLowerCase().includes(query) ||
        vehicle.vin.toLowerCase().includes(query) ||
        vehicle.make.toLowerCase().includes(query) ||
        vehicle.model.toLowerCase().includes(query) ||
        `${vehicle.make} ${vehicle.model}`.toLowerCase().includes(query)
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

    // Apply sorting
    result.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      if (this.sortField === 'unit_number') {
        aValue = a.unit_number;
        bValue = b.unit_number;
      } else if (this.sortField === 'inspection_expiry') {
        aValue = new Date(a.inspection_expiry).getTime();
        bValue = new Date(b.inspection_expiry).getTime();
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
    this.presetFilter = null;
    this.sortField = 'unit_number';
    this.sortOrder = 'asc';
    this.currentPage = 1;
    this.itemsPerPage = 100;
    this.applyFiltersAndSort();
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
    return this.searchQuery.trim() !== '' || this.selectedStatus !== 'all';
  }

  get displayingRange(): string {
    if (this.filteredVehicles.length === 0) return '0-0 of 0';
    const start = (this.currentPage - 1) * this.itemsPerPage + 1;
    const end = Math.min(this.currentPage * this.itemsPerPage, this.filteredVehicles.length);
    return `${start}-${end} of ${this.filteredVehicles.length}`;
  }

  openAddVehicleForm(): void {
    if (!this.canCreateVehicle()) return;
    this.selectedVehicle = null;
    this.showVehicleForm = true;
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
    this.loadEquipmentSafetySummary(vehicle.id);
  }

  closeVehicleDetails(): void {
    this.showVehicleDetails = false;
    this.selectedVehicleDetails = null;
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
