import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { debounceTime, Subject } from 'rxjs';

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
  last_inspection_date: string;
  next_pm_due: string;
  next_pm_mileage: number;
  oos_reason?: string;
  registration_expiry?: string;
  inspection_expiry?: string;
}

type SortField = 'unit_number' | 'last_inspection_date';
type SortOrder = 'asc' | 'desc';

@Component({
  selector: 'app-vehicles',
  templateUrl: './vehicles.component.html',
  styleUrls: ['./vehicles.component.css']
})
export class VehiclesComponent implements OnInit {
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
  private searchSubject = new Subject<string>();

  // Sort state
  sortField: SortField = 'unit_number';
  sortOrder: SortOrder = 'asc';

  // Pagination state
  currentPage = 1;
  itemsPerPage = 10;
  totalPages = 1;
  pageSizeOptions = [5, 10, 25, 50];

  // Modal state
  showVehicleForm = false;
  selectedVehicle: Vehicle | null = null;

  // Status filter options
  statusOptions = [
    { value: 'all', label: 'All Vehicles' },
    { value: 'in-service', label: 'In Service' },
    { value: 'out-of-service', label: 'Out of Service' }
  ];

  constructor(private apiService: ApiService) { }

  ngOnInit(): void {
    this.loadVehicles();
    
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
        this.allVehicles = data;
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

    // Apply status filter
    if (this.selectedStatus !== 'all') {
      result = result.filter(vehicle => vehicle.status === this.selectedStatus);
    }

    // Apply sorting
    result.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      if (this.sortField === 'unit_number') {
        aValue = a.unit_number;
        bValue = b.unit_number;
      } else if (this.sortField === 'last_inspection_date') {
        aValue = new Date(a.last_inspection_date).getTime();
        bValue = new Date(b.last_inspection_date).getTime();
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

  updatePagination(): void {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    this.paginatedVehicles = this.filteredVehicles.slice(startIndex, endIndex);
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
    this.sortField = 'unit_number';
    this.sortOrder = 'asc';
    this.currentPage = 1;
    this.itemsPerPage = 10;
    this.applyFiltersAndSort();
  }

  retryLoad(): void {
    this.loadVehicles();
  }

  getStatusBadge(status: string): string {
    return status === 'in-service' ? 'badge-success' : 'badge-danger';
  }

  getStatusLabel(status: string): string {
    return status === 'in-service' ? 'In Service' : 'Out of Service';
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
    this.selectedVehicle = null;
    this.showVehicleForm = true;
  }

  openEditVehicleForm(vehicle: Vehicle): void {
    this.selectedVehicle = vehicle;
    this.showVehicleForm = true;
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
    
    // Check inspection
    if (vehicle.last_inspection_date) {
      const inspectionDate = new Date(vehicle.last_inspection_date);
      const oneYearFromInspection = new Date(inspectionDate);
      oneYearFromInspection.setFullYear(oneYearFromInspection.getFullYear() + 1);
      const daysUntilInspectionDue = Math.floor((oneYearFromInspection.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysUntilInspectionDue < 0) {
        messages.push('Annual inspection overdue');
      } else if (daysUntilInspectionDue <= 60) {
        messages.push(`Inspection due in ${daysUntilInspectionDue} days`);
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
    if (vehicle.last_inspection_date) {
      const inspectionDate = new Date(vehicle.last_inspection_date);
      const oneYearFromInspection = new Date(inspectionDate);
      oneYearFromInspection.setFullYear(oneYearFromInspection.getFullYear() + 1);
      const daysUntilInspectionDue = Math.floor((oneYearFromInspection.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilInspectionDue < 0) return true;
    }
    
    return false;
  }
}
