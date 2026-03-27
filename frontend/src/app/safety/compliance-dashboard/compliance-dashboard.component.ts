import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, finalize } from 'rxjs/operators';
import { AnnualComplianceService } from '../../services/annual-compliance.service';
import { ApiService } from '../../services/api.service';
import {
  ComplianceDashboardSummary,
  ComplianceGridRow,
  MedicalExpiryRow,
  ComplianceItemStatus,
  MedicalCertUrgency,
} from '../../models/annual-compliance.model';

type SortColumn = 'driverName' | 'mvrInquiry' | 'drivingRecordReview' | 'clearinghouseQuery' | 'medicalCert';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'all' | 'overdue' | 'due_soon' | 'compliant';

@Component({
  selector: 'app-compliance-dashboard',
  templateUrl: './compliance-dashboard.component.html',
  styleUrls: ['./compliance-dashboard.component.css']
})
export class ComplianceDashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Data
  summary: ComplianceDashboardSummary | null = null;
  gridRows: ComplianceGridRow[] = [];
  filteredRows: ComplianceGridRow[] = [];
  medicalRows: MedicalExpiryRow[] = [];

  // UI state
  loading = true;
  loadingGrid = true;
  loadingMedical = true;
  error = '';
  generating = false;
  exporting = false;

  // Table controls
  sortColumn: SortColumn = 'driverName';
  sortDirection: SortDirection = 'asc';
  statusFilter: StatusFilter = 'all';

  // Bulk action controls
  selectedYear: number = new Date().getFullYear();
  selectedYearStr: string = String(new Date().getFullYear());
  yearOptions: number[] = [];
  yearSelectOptions: { value: string; label: string }[] = [];

  // Audit / compliance summary data
  auditTrail: any[] = [];
  complianceSummary: any = null;
  auditLoading = true;
  selectedCategory = 'dqf';

  readonly categoryOptions: { value: string; label: string }[] = [
    { value: 'dqf', label: 'Driver Qualification Files' },
    { value: 'hos', label: 'Hours of Service' },
    { value: 'maintenance', label: 'Maintenance Records' },
    { value: 'drug-alcohol', label: 'Drug & Alcohol Testing' },
  ];

  constructor(
    private complianceService: AnnualComplianceService,
    private apiService: ApiService,
    private router: Router
  ) {
    const currentYear = new Date().getFullYear();
    this.yearOptions = [currentYear - 1, currentYear, currentYear + 1];
    this.yearSelectOptions = this.yearOptions.map(y => ({ value: String(y), label: String(y) }));
  }

  ngOnInit(): void {
    this.loadAll();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadAll(): void {
    this.loading = true;
    this.loadingGrid = true;
    this.loadingMedical = true;
    this.error = '';

    this.complianceService.getDashboardSummary()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => { this.summary = data; this.loading = false; },
        error: () => { this.error = 'Failed to load compliance summary'; this.loading = false; }
      });

    this.complianceService.getComplianceGrid()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          this.gridRows = rows;
          this.applyFilter();
          this.loadingGrid = false;
        },
        error: () => { this.loadingGrid = false; }
      });

    this.complianceService.getMedicalExpiryReport()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => { this.medicalRows = rows; this.loadingMedical = false; },
        error: () => { this.loadingMedical = false; }
      });

    this.loadAuditData();
  }

  // ─── Audit / Compliance Summary ────────────────────────────────────────────

  loadAuditData(): void {
    this.auditLoading = true;
    this.apiService.getAuditTrail()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => { this.auditTrail = data; },
        error: () => {}
      });

    this.apiService.getComplianceSummary()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => { this.complianceSummary = data; this.auditLoading = false; },
        error: () => { this.auditLoading = false; }
      });
  }

  exportAuditData(): void {
    this.apiService.exportData(this.selectedCategory)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${this.selectedCategory}-export-${new Date().toISOString().split('T')[0]}.json`;
          a.click();
          window.URL.revokeObjectURL(url);
        },
        error: () => { this.error = 'Failed to export audit data'; }
      });
  }

  getBadgeIcon(action: string): string {
    switch (action) {
      case 'CREATE': return 'add_circle';
      case 'UPDATE': return 'edit';
      case 'DELETE': return 'delete';
      default: return 'info';
    }
  }

  // ─── Filter & Sort ──────────────────────────────────────────────────────────

  applyFilter(): void {
    let rows = [...this.gridRows];

    if (this.statusFilter === 'overdue') {
      rows = rows.filter(r => r.overallStatus === 'overdue');
    } else if (this.statusFilter === 'due_soon') {
      rows = rows.filter(r => r.overallStatus === 'due_soon');
    } else if (this.statusFilter === 'compliant') {
      rows = rows.filter(r => r.overallStatus === 'complete');
    }

    rows.sort((a, b) => {
      let cmp = 0;
      if (this.sortColumn === 'driverName') {
        cmp = a.driverName.localeCompare(b.driverName);
      } else {
        const statusOrder: Record<ComplianceItemStatus, number> = { overdue: 0, due_soon: 1, pending: 2, complete: 3 };
        const aStatus = a[this.sortColumn]?.status ?? 'pending';
        const bStatus = b[this.sortColumn]?.status ?? 'pending';
        cmp = statusOrder[aStatus] - statusOrder[bStatus];
      }
      return this.sortDirection === 'asc' ? cmp : -cmp;
    });

    this.filteredRows = rows;
  }

  onFilterChange(filter: StatusFilter): void {
    this.statusFilter = filter;
    this.applyFilter();
  }

  onSort(column: SortColumn): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
    this.applyFilter();
  }

  sortIcon(column: SortColumn): string {
    if (this.sortColumn !== column) return 'unfold_more';
    return this.sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  // ─── Status helpers ─────────────────────────────────────────────────────────

  statusLabel(status: ComplianceItemStatus): string {
    const labels: Record<ComplianceItemStatus, string> = {
      complete: 'Complete',
      due_soon: 'Due Soon',
      overdue: 'Overdue',
      pending: 'Pending',
    };
    return labels[status] ?? status;
  }

  statusClass(status: ComplianceItemStatus): string {
    return `chip-${status}`;
  }

  urgencyClass(urgency: MedicalCertUrgency): string {
    return `urgency-${urgency}`;
  }

  urgencyLabel(urgency: MedicalCertUrgency): string {
    const labels: Record<MedicalCertUrgency, string> = {
      valid: 'Valid',
      warning: 'Expiring Soon',
      critical: 'Critical',
      expired: 'Expired',
    };
    return labels[urgency] ?? urgency;
  }

  // ─── Navigation ─────────────────────────────────────────────────────────────

  goToDriver(driverId: string): void {
    this.router.navigate(['/drivers/dqf'], { queryParams: { driver: driverId } });
  }

  // ─── Bulk Actions ───────────────────────────────────────────────────────────

  generateItems(): void {
    if (this.generating) return;
    this.generating = true;
    this.complianceService.generateAnnualItems(this.selectedYear)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.generating = false)
      )
      .subscribe({
        next: () => this.loadAll(),
        error: () => { this.error = 'Failed to generate compliance items'; }
      });
  }

  exportReport(): void {
    if (this.exporting) return;
    this.exporting = true;
    this.complianceService.exportReport(this.selectedYear)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => this.exporting = false)
      )
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `compliance-report-${this.selectedYear}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
        },
        error: () => { this.error = 'Failed to export report'; }
      });
  }

  onYearChange(yearStr: string): void {
    this.selectedYearStr = yearStr;
    this.selectedYear = Number(yearStr);
  }

  // ─── Template helpers ───────────────────────────────────────────────────────

  formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
