import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { FmcsaSafetyService, FmcsaInspection, FmcsaInspectionDetail } from '../fmcsa-safety.service';
import { ApiService } from '../../services/api.service';

interface DriverOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface VehicleOption {
  id: string;
  unit_number: string;
  plate_number?: string;
}

@Component({
  selector: 'app-fmcsa-inspections',
  templateUrl: './fmcsa-inspections.component.html',
  styleUrls: ['./fmcsa-inspections.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FmcsaInspectionsComponent implements OnInit {
  rows: FmcsaInspection[] = [];
  total = 0;
  loading = false;
  error = '';

  drivers: DriverOption[] = [];
  vehicles: VehicleOption[] = [];

  selectedInspection: FmcsaInspection | null = null;
  detailLoading = false;
  detail: FmcsaInspectionDetail | null = null;

  showMatchModal = false;
  matchingInspection: FmcsaInspection | null = null;
  selectedMatchDriverId = '';
  selectedMatchVehicleId = '';
  savingMatch = false;

  rematching = false;

  // Filter state
  filterMatchStatus = '';
  filterDateFrom = '';
  filterDateTo = '';
  filterOosOnly = false;

  limit = 50;
  offset = 0;

  // Summary card values
  totalCount = 0;
  oosCount = 0;
  cleanCount = 0;
  unmatchedCount = 0;

  constructor(
    private fmcsa: FmcsaSafetyService,
    private api: ApiService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadInspections();
    this.loadDriversAndVehicles();
  }

  loadInspections(): void {
    this.loading = true;
    this.error = '';

    const filters: { match_status?: string; date_from?: string; date_to?: string; oos_only?: boolean; limit?: number; offset?: number } = {
      limit: this.limit,
      offset: this.offset,
    };
    if (this.filterMatchStatus) filters.match_status = this.filterMatchStatus;
    if (this.filterDateFrom) filters.date_from = this.filterDateFrom;
    if (this.filterDateTo) filters.date_to = this.filterDateTo;
    if (this.filterOosOnly) filters.oos_only = true;

    this.fmcsa.getInspections(filters).subscribe({
      next: (res) => {
        this.rows = res.rows;
        this.total = res.total;
        this.computeSummary(res.rows);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Failed to load inspections. Please try again.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private computeSummary(rows: FmcsaInspection[]): void {
    this.totalCount = this.total;
    this.oosCount = rows.filter(r => r.oos_vehicle || r.oos_driver).length;
    this.cleanCount = rows.filter(r => !r.oos_vehicle && !r.oos_driver && r.violation_count === 0).length;
    this.unmatchedCount = rows.filter(r => r.match_status === 'unmatched').length;
  }

  loadDriversAndVehicles(): void {
    forkJoin({
      vehicles: this.api.getVehicles(),
      drivers: this.api.getDrivers(),
    }).subscribe({
      next: (res) => {
        this.vehicles = (res.vehicles as VehicleOption[]) || [];
        this.drivers = (res.drivers as DriverOption[]) || [];
        this.cdr.markForCheck();
      },
      error: () => {
        // Non-fatal — match modal will just have empty dropdowns
        this.cdr.markForCheck();
      },
    });
  }

  applyFilters(): void {
    this.offset = 0;
    this.loadInspections();
  }

  clearFilters(): void {
    this.filterMatchStatus = '';
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.filterOosOnly = false;
    this.offset = 0;
    this.loadInspections();
  }

  selectRow(row: FmcsaInspection): void {
    if (this.selectedInspection?.id === row.id) {
      this.closeDetail();
      return;
    }
    this.selectedInspection = row;
    this.detail = null;
    this.loadDetail(row.id);
  }

  loadDetail(id: string): void {
    this.detailLoading = true;
    this.cdr.markForCheck();
    this.fmcsa.getInspectionDetail(id).subscribe({
      next: (res) => {
        this.detail = res;
        this.detailLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.detailLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  closeDetail(): void {
    this.selectedInspection = null;
    this.detail = null;
    this.cdr.markForCheck();
  }

  openMatchModal(row: FmcsaInspection): void {
    this.matchingInspection = row;
    this.selectedMatchDriverId = row.matched_driver_id ?? '';
    this.selectedMatchVehicleId = row.matched_vehicle_id ?? '';
    this.showMatchModal = true;
    this.cdr.markForCheck();
  }

  closeMatchModal(): void {
    this.showMatchModal = false;
    this.matchingInspection = null;
    this.selectedMatchDriverId = '';
    this.selectedMatchVehicleId = '';
    this.savingMatch = false;
    this.cdr.markForCheck();
  }

  saveMatch(): void {
    if (!this.matchingInspection) return;
    this.savingMatch = true;
    this.cdr.markForCheck();

    const payload: { driver_id?: string; vehicle_id?: string } = {};
    if (this.selectedMatchDriverId) payload.driver_id = this.selectedMatchDriverId;
    if (this.selectedMatchVehicleId) payload.vehicle_id = this.selectedMatchVehicleId;

    this.fmcsa.matchInspection(this.matchingInspection.id, payload).subscribe({
      next: () => {
        this.savingMatch = false;
        this.closeMatchModal();
        this.loadInspections();
      },
      error: () => {
        this.savingMatch = false;
        this.cdr.markForCheck();
      },
    });
  }

  triggerRematch(): void {
    this.rematching = true;
    this.cdr.markForCheck();
    this.fmcsa.rematchInspections().subscribe({
      next: () => {
        this.rematching = false;
        this.loadInspections();
      },
      error: () => {
        this.rematching = false;
        this.cdr.markForCheck();
      },
    });
  }

  prevPage(): void {
    if (this.offset > 0) {
      this.offset = Math.max(0, this.offset - this.limit);
      this.loadInspections();
    }
  }

  nextPage(): void {
    if (this.offset + this.limit < this.total) {
      this.offset += this.limit;
      this.loadInspections();
    }
  }

  matchStatusClass(status: string): string {
    switch (status) {
      case 'matched': return 'badge-green';
      case 'manual':  return 'badge-blue';
      case 'partial': return 'badge-yellow';
      default:        return 'badge-red';
    }
  }

  driverName(id: string | null): string {
    if (!id) return '—';
    const d = this.drivers.find(dr => dr.id === id);
    return d ? `${d.first_name} ${d.last_name}` : id;
  }

  vehicleDisplay(id: string | null): string {
    if (!id) return '—';
    const v = this.vehicles.find(ve => ve.id === id);
    return v ? v.unit_number : id;
  }

  oosClass(row: FmcsaInspection): string {
    return (row.oos_vehicle || row.oos_driver) ? 'oos-flag' : '';
  }

  canMatch(row: FmcsaInspection): boolean {
    return row.match_status === 'unmatched' || row.match_status === 'partial';
  }

  get currentPage(): number {
    return Math.floor(this.offset / this.limit) + 1;
  }

  get totalPages(): number {
    return Math.ceil(this.total / this.limit);
  }
}
