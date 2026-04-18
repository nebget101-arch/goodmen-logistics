import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AccessControlService } from '../../services/access-control.service';

interface WorkOrderRow {
  id: string;
  work_order_number: string;
  title: string;
  customer_name: string;
  vehicle_unit: string;
  type: string;
  priority: string;
  status: string;
  assigned_to_name: string;
  assigned_to_id: string;
  total_amount: number;
  invoice_status: string;
  invoice_id: string;
  location_name: string;
  scheduled_date: string;
  created_at: string;
  completed_at: string;
}

interface StatsCard {
  label: string;
  value: number;
  icon: string;
  accent: string;
  filterFn: () => void;
}

interface CustomerOption {
  id: string;
  company_name: string;
}

interface VehicleOption {
  id: string;
  unit_number: string;
}

interface MechanicOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-maintenance',
  templateUrl: './maintenance.component.html',
  styleUrls: ['./maintenance.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MaintenanceComponent implements OnInit, OnDestroy {
  /* ── data ── */
  allWorkOrders: WorkOrderRow[] = [];
  filteredWorkOrders: WorkOrderRow[] = [];
  loading = true;

  /* ── stats ── */
  statsCards: StatsCard[] = [];
  openCount = 0;
  waitingPartsCount = 0;
  completedTodayCount = 0;
  overdueCount = 0;

  /* ── filter options ── */
  statuses = ['DRAFT', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED', 'CLOSED', 'CANCELED'];
  types = ['REPAIR', 'PM', 'INSPECTION', 'TIRE', 'OTHER'];
  priorities = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
  invoiceStatuses = ['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'VOID'];

  customers: CustomerOption[] = [];
  vehicles: VehicleOption[] = [];
  mechanics: MechanicOption[] = [];
  locations: { id: string; name: string }[] = [];

  /* ── active filters ── */
  filterStatus = '';
  filterType = '';
  filterPriority = '';
  filterAssignedTo = '';
  filterCustomer = '';
  filterVehicle = '';
  filterDateFrom = '';
  filterDateTo = '';
  filterSearch = '';
  filterInvoiceStatus = '';

  /* ── quick-filter flags ── */
  quickMyOrders = false;
  quickUrgent = false;
  quickOverdue = false;

  /* ── multi-select ── */
  selectedIds = new Set<string>();
  allSelected = false;

  /* ── bulk upload ── */
  bulkUploadFile: File | null = null;
  bulkUploading = false;
  bulkUploadMessage = '';
  bulkUploadError = '';
  bulkUploadResults: { successful?: { id: string }[]; failed?: { row: number; errors: string[] }[]; total?: number } | null = null;
  showBulkUpload = false;

  /* ── current user ── */
  private currentUserId = '';
  private currentUserName = '';

  private destroy$ = new Subject<void>();
  private search$ = new Subject<string>();

  constructor(
    private apiService: ApiService,
    private router: Router,
    private route: ActivatedRoute,
    private access: AccessControlService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const user = this.access.getUser();
    if (user) {
      this.currentUserId = user.id;
      this.currentUserName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    }

    this.initDefaultDateRange();
    this.restoreFiltersFromUrl();

    this.search$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.applyClientFilters();
      this.syncFiltersToUrl();
    });

    this.loadLocations();
    this.loadCustomers();
    this.loadVehicles();
    this.loadDriversAsMechanics();
    this.loadWorkOrders();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /* ══════════════════════════════════════════════════
     DATA LOADING
     ══════════════════════════════════════════════════ */

  loadWorkOrders(): void {
    this.loading = true;
    this.cdr.markForCheck();

    const serverFilters: Record<string, string> = { pageSize: '10000' };
    if (this.filterStatus) serverFilters['status'] = this.filterStatus;
    if (this.filterType) serverFilters['type'] = this.filterType;

    this.apiService.listWorkOrders(serverFilters).subscribe({
      next: (res: { rows?: WorkOrderRow[]; data?: WorkOrderRow[] }) => {
        this.allWorkOrders = res.rows || res.data || [];
        this.computeStats();
        this.applyClientFilters();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.allWorkOrders = [];
        this.filteredWorkOrders = [];
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  loadLocations(): void {
    this.apiService.getLocations().subscribe({
      next: (data: { id: string; name: string }[]) => {
        const all = data || [];
        this.locations = this.access.getFilteredLocations(all);
        this.cdr.markForCheck();
      }
    });
  }

  loadCustomers(): void {
    this.apiService.getCustomers({ pageSize: 500 }).subscribe({
      next: (res: { rows?: CustomerOption[]; data?: CustomerOption[] } | CustomerOption[]) => {
        const list = Array.isArray(res) ? res : (res as { rows?: CustomerOption[]; data?: CustomerOption[] }).rows || (res as { rows?: CustomerOption[]; data?: CustomerOption[] }).data || [];
        this.customers = list;
        this.cdr.markForCheck();
      }
    });
  }

  loadVehicles(): void {
    this.apiService.getVehicles().subscribe({
      next: (res: { rows?: VehicleOption[]; data?: VehicleOption[] } | VehicleOption[]) => {
        const list = Array.isArray(res) ? res : (res as { rows?: VehicleOption[]; data?: VehicleOption[] }).rows || (res as { rows?: VehicleOption[]; data?: VehicleOption[] }).data || [];
        this.vehicles = list;
        this.cdr.markForCheck();
      }
    });
  }

  loadDriversAsMechanics(): void {
    this.apiService.getDrivers().subscribe({
      next: (res: { rows?: { id: string; first_name?: string; last_name?: string }[]; data?: { id: string; first_name?: string; last_name?: string }[] } | { id: string; first_name?: string; last_name?: string }[]) => {
        const list = Array.isArray(res)
          ? res
          : (res as { rows?: { id: string; first_name?: string; last_name?: string }[] }).rows
            || (res as { data?: { id: string; first_name?: string; last_name?: string }[] }).data
            || [];
        this.mechanics = list.map((d: { id: string; first_name?: string; last_name?: string }) => ({
          id: d.id,
          name: [d.first_name, d.last_name].filter(Boolean).join(' ') || d.id
        }));
        this.cdr.markForCheck();
      }
    });
  }

  /* ══════════════════════════════════════════════════
     STATS COMPUTATION
     ══════════════════════════════════════════════════ */

  computeStats(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const openStatuses = ['DRAFT', 'IN_PROGRESS', 'WAITING_PARTS'];

    this.openCount = this.allWorkOrders.filter(wo => openStatuses.includes(wo.status)).length;
    this.waitingPartsCount = this.allWorkOrders.filter(wo => wo.status === 'WAITING_PARTS').length;
    this.completedTodayCount = this.allWorkOrders.filter(wo => {
      if (wo.status !== 'COMPLETED' || !wo.completed_at) return false;
      const d = new Date(wo.completed_at);
      d.setHours(0, 0, 0, 0);
      return d.getTime() === today.getTime();
    }).length;
    this.overdueCount = this.allWorkOrders.filter(wo => {
      if (!openStatuses.includes(wo.status) || !wo.scheduled_date) return false;
      return new Date(wo.scheduled_date) < today;
    }).length;

    this.statsCards = [
      { label: 'Open Work Orders', value: this.openCount, icon: 'build', accent: 'blue', filterFn: () => this.setQuickFilterOpen() },
      { label: 'Waiting for Parts', value: this.waitingPartsCount, icon: 'inventory_2', accent: 'amber', filterFn: () => this.setStatusFilter('WAITING_PARTS') },
      { label: 'Completed Today', value: this.completedTodayCount, icon: 'check_circle', accent: 'green', filterFn: () => this.setStatusFilter('COMPLETED') },
      { label: 'Overdue', value: this.overdueCount, icon: 'warning', accent: 'red', filterFn: () => this.toggleQuickOverdue() }
    ];
  }

  /* ══════════════════════════════════════════════════
     FILTERING
     ══════════════════════════════════════════════════ */

  applyClientFilters(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const openStatuses = ['DRAFT', 'IN_PROGRESS', 'WAITING_PARTS'];

    let result = [...this.allWorkOrders];

    // Status filter (already applied on server, but also on client for quick chip filtering)
    if (this.filterStatus) {
      result = result.filter(wo => wo.status === this.filterStatus);
    }

    // Type
    if (this.filterType) {
      result = result.filter(wo => wo.type === this.filterType);
    }

    // Priority
    if (this.filterPriority) {
      result = result.filter(wo => wo.priority === this.filterPriority);
    }

    // Assigned to
    if (this.filterAssignedTo) {
      result = result.filter(wo => wo.assigned_to_id === this.filterAssignedTo);
    }

    // Customer
    if (this.filterCustomer) {
      result = result.filter(wo =>
        (wo.customer_name || '').toLowerCase().includes(this.filterCustomer.toLowerCase())
      );
    }

    // Vehicle
    if (this.filterVehicle) {
      result = result.filter(wo =>
        (wo.vehicle_unit || '').toLowerCase().includes(this.filterVehicle.toLowerCase())
      );
    }

    // Invoice status
    if (this.filterInvoiceStatus) {
      result = result.filter(wo => wo.invoice_status === this.filterInvoiceStatus);
    }

    // Date range
    if (this.filterDateFrom) {
      const from = new Date(this.filterDateFrom);
      result = result.filter(wo => new Date(wo.created_at) >= from);
    }
    if (this.filterDateTo) {
      const to = new Date(this.filterDateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(wo => new Date(wo.created_at) <= to);
    }

    // Search
    if (this.filterSearch) {
      const q = this.filterSearch.toLowerCase();
      result = result.filter(wo =>
        (wo.work_order_number || '').toLowerCase().includes(q) ||
        (wo.title || '').toLowerCase().includes(q) ||
        (wo.vehicle_unit || '').toLowerCase().includes(q) ||
        (wo.customer_name || '').toLowerCase().includes(q) ||
        (wo.assigned_to_name || '').toLowerCase().includes(q)
      );
    }

    // Quick filters
    if (this.quickMyOrders) {
      result = result.filter(wo => wo.assigned_to_id === this.currentUserId);
    }

    if (this.quickUrgent) {
      result = result.filter(wo => wo.priority === 'URGENT');
    }

    if (this.quickOverdue) {
      result = result.filter(wo =>
        openStatuses.includes(wo.status) && wo.scheduled_date && new Date(wo.scheduled_date) < today
      );
    }

    this.filteredWorkOrders = result;
    this.clearSelection();
    this.cdr.markForCheck();
  }

  onSearchInput(value: string): void {
    this.filterSearch = value;
    this.search$.next(value);
  }

  applyFilters(): void {
    this.applyClientFilters();
    this.syncFiltersToUrl();
  }

  setStatusFilter(status: string): void {
    this.filterStatus = this.filterStatus === status ? '' : status;
    this.quickMyOrders = false;
    this.quickUrgent = false;
    this.quickOverdue = false;
    this.applyFilters();
  }

  setQuickFilterOpen(): void {
    this.filterStatus = '';
    this.quickMyOrders = false;
    this.quickUrgent = false;
    this.quickOverdue = false;
    // Show only open statuses by not setting a filter — we filter on the client
    // Actually reload with open statuses
    this.applyFilters();
  }

  toggleQuickMyOrders(): void {
    this.quickMyOrders = !this.quickMyOrders;
    this.applyFilters();
  }

  toggleQuickUrgent(): void {
    this.quickUrgent = !this.quickUrgent;
    this.applyFilters();
  }

  toggleQuickOverdue(): void {
    this.quickOverdue = !this.quickOverdue;
    this.applyFilters();
  }

  clearFilters(): void {
    this.filterStatus = '';
    this.filterType = '';
    this.filterPriority = '';
    this.filterAssignedTo = '';
    this.filterCustomer = '';
    this.filterVehicle = '';
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.filterSearch = '';
    this.filterInvoiceStatus = '';
    this.quickMyOrders = false;
    this.quickUrgent = false;
    this.quickOverdue = false;
    this.initDefaultDateRange();
    this.loadWorkOrders();
    this.syncFiltersToUrl();
  }

  getActiveFilterCount(): number {
    let count = 0;
    if (this.filterStatus) count++;
    if (this.filterType) count++;
    if (this.filterPriority) count++;
    if (this.filterAssignedTo) count++;
    if (this.filterCustomer) count++;
    if (this.filterVehicle) count++;
    if (this.filterDateFrom) count++;
    if (this.filterDateTo) count++;
    if (this.filterSearch) count++;
    if (this.filterInvoiceStatus) count++;
    if (this.quickMyOrders) count++;
    if (this.quickUrgent) count++;
    if (this.quickOverdue) count++;
    return count;
  }

  /* ══════════════════════════════════════════════════
     URL QUERY PARAM PERSISTENCE
     ══════════════════════════════════════════════════ */

  private syncFiltersToUrl(): void {
    const qp: Record<string, string> = {};
    if (this.filterStatus) qp['status'] = this.filterStatus;
    if (this.filterType) qp['type'] = this.filterType;
    if (this.filterPriority) qp['priority'] = this.filterPriority;
    if (this.filterAssignedTo) qp['assignedTo'] = this.filterAssignedTo;
    if (this.filterCustomer) qp['customer'] = this.filterCustomer;
    if (this.filterVehicle) qp['vehicle'] = this.filterVehicle;
    if (this.filterDateFrom) qp['dateFrom'] = this.filterDateFrom;
    if (this.filterDateTo) qp['dateTo'] = this.filterDateTo;
    if (this.filterSearch) qp['search'] = this.filterSearch;
    if (this.filterInvoiceStatus) qp['invoice'] = this.filterInvoiceStatus;
    if (this.quickMyOrders) qp['my'] = '1';
    if (this.quickUrgent) qp['urgent'] = '1';
    if (this.quickOverdue) qp['overdue'] = '1';

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: qp,
      queryParamsHandling: '',
      replaceUrl: true
    });
  }

  private restoreFiltersFromUrl(): void {
    const qp = this.route.snapshot.queryParams;
    if (qp['status']) this.filterStatus = qp['status'];
    if (qp['type']) this.filterType = qp['type'];
    if (qp['priority']) this.filterPriority = qp['priority'];
    if (qp['assignedTo']) this.filterAssignedTo = qp['assignedTo'];
    if (qp['customer']) this.filterCustomer = qp['customer'];
    if (qp['vehicle']) this.filterVehicle = qp['vehicle'];
    if (qp['dateFrom']) this.filterDateFrom = qp['dateFrom'];
    if (qp['dateTo']) this.filterDateTo = qp['dateTo'];
    if (qp['search']) this.filterSearch = qp['search'];
    if (qp['invoice']) this.filterInvoiceStatus = qp['invoice'];
    if (qp['my'] === '1') this.quickMyOrders = true;
    if (qp['urgent'] === '1') this.quickUrgent = true;
    if (qp['overdue'] === '1') this.quickOverdue = true;
  }

  private initDefaultDateRange(): void {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);
    this.filterDateFrom = sevenDaysAgo.toISOString().slice(0, 10);
    this.filterDateTo = now.toISOString().slice(0, 10);
  }

  /* ══════════════════════════════════════════════════
     BADGES
     ══════════════════════════════════════════════════ */

  getStatusBadge(status: string): string {
    switch (status) {
      case 'COMPLETED':
      case 'CLOSED':
        return 'badge-success';
      case 'WAITING_PARTS':
        return 'badge-warning';
      case 'CANCELED':
        return 'badge-danger';
      case 'IN_PROGRESS':
        return 'badge-info';
      case 'DRAFT':
        return 'badge-muted';
      default:
        return 'badge-info';
    }
  }

  getTypeBadge(type: string): string {
    switch (type) {
      case 'REPAIR':
        return 'badge-danger';
      case 'PM':
        return 'badge-info';
      case 'INSPECTION':
        return 'badge-warning';
      case 'TIRE':
        return 'badge-muted';
      default:
        return 'badge-info';
    }
  }

  getPriorityBadge(priority: string): string {
    switch (priority) {
      case 'URGENT':
        return 'badge-danger';
      case 'HIGH':
        return 'badge-warning';
      case 'NORMAL':
        return 'badge-info';
      case 'LOW':
        return 'badge-muted';
      default:
        return 'badge-info';
    }
  }

  getInvoiceBadge(status: string): string {
    if (status === 'PAID') return 'badge-success';
    if (status === 'PARTIAL') return 'badge-warning';
    if (status === 'VOID') return 'badge-danger';
    return 'badge-info';
  }

  formatStatusLabel(status: string): string {
    return (status || '').replace(/_/g, ' ');
  }

  /* ══════════════════════════════════════════════════
     AGE CALCULATION
     ══════════════════════════════════════════════════ */

  getAge(createdAt: string): string {
    if (!createdAt) return '-';
    const diff = Date.now() - new Date(createdAt).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return '1 day';
    return `${days} days`;
  }

  /* ══════════════════════════════════════════════════
     MULTI-SELECT
     ══════════════════════════════════════════════════ */

  toggleSelectAll(): void {
    if (this.allSelected) {
      this.selectedIds.clear();
    } else {
      this.filteredWorkOrders.forEach(wo => this.selectedIds.add(wo.id));
    }
    this.allSelected = !this.allSelected;
    this.cdr.markForCheck();
  }

  toggleRowSelect(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.allSelected = this.selectedIds.size === this.filteredWorkOrders.length && this.filteredWorkOrders.length > 0;
    this.cdr.markForCheck();
  }

  isRowSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  clearSelection(): void {
    this.selectedIds.clear();
    this.allSelected = false;
  }

  /* ══════════════════════════════════════════════════
     BULK ACTIONS
     ══════════════════════════════════════════════════ */

  bulkAssignTo(mechanicId: string): void {
    if (!mechanicId || this.selectedIds.size === 0) return;
    const ids = Array.from(this.selectedIds);
    let completed = 0;
    ids.forEach(id => {
      this.apiService.updateWorkOrder(id, { assigned_to_id: mechanicId }).subscribe({
        next: () => {
          completed++;
          if (completed === ids.length) {
            this.loadWorkOrders();
          }
        }
      });
    });
  }

  bulkChangePriority(priority: string): void {
    if (!priority || this.selectedIds.size === 0) return;
    const ids = Array.from(this.selectedIds);
    let completed = 0;
    ids.forEach(id => {
      this.apiService.updateWorkOrder(id, { priority }).subscribe({
        next: () => {
          completed++;
          if (completed === ids.length) {
            this.loadWorkOrders();
          }
        }
      });
    });
  }

  exportSelectedCsv(): void {
    const selected = this.filteredWorkOrders.filter(wo => this.selectedIds.has(wo.id));
    if (selected.length === 0) return;

    const headers = ['WO #', 'Title', 'Customer', 'Vehicle', 'Type', 'Priority', 'Status', 'Assigned', 'Total', 'Created'];
    const rows = selected.map(wo => [
      wo.work_order_number,
      wo.title || '',
      wo.customer_name || '',
      wo.vehicle_unit || '',
      wo.type || '',
      wo.priority || '',
      wo.status || '',
      wo.assigned_to_name || '',
      wo.total_amount?.toString() || '0',
      wo.created_at || ''
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `work-orders-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ══════════════════════════════════════════════════
     ROW ACTIONS
     ══════════════════════════════════════════════════ */

  goToWorkOrder(): void {
    this.router.navigate(['/work-order']);
  }

  editWorkOrder(record: WorkOrderRow): void {
    if (!record?.id) return;
    this.router.navigate(['/work-order', record.id]);
  }

  viewWorkOrder(record: WorkOrderRow): void {
    if (!record?.id) return;
    this.router.navigate(['/work-order', record.id]);
  }

  quickStatusChange(record: WorkOrderRow, newStatus: string): void {
    if (!record?.id) return;
    this.apiService.updateWorkOrderStatus(record.id, newStatus).subscribe({
      next: () => this.loadWorkOrders()
    });
  }

  generateInvoice(record: WorkOrderRow): void {
    if (!record?.id) return;
    this.apiService.generateInvoiceFromWorkOrder(record.id).subscribe({
      next: () => this.loadWorkOrders()
    });
  }

  /* ══════════════════════════════════════════════════
     BULK UPLOAD
     ══════════════════════════════════════════════════ */

  toggleBulkUpload(): void {
    this.showBulkUpload = !this.showBulkUpload;
    this.cdr.markForCheck();
  }

  downloadWorkOrderTemplate(): void {
    this.bulkUploadError = '';
    this.apiService.downloadWorkOrderUploadTemplate().subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'work-order-upload-template.xlsx';
        link.click();
        window.URL.revokeObjectURL(url);
      },
      error: (error: { error?: { error?: string }; message?: string }) => {
        this.bulkUploadError = error?.error?.error || error?.message || 'Failed to download template';
        this.cdr.markForCheck();
      }
    });
  }

  onBulkFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target?.files?.[0] || null;
    this.bulkUploadFile = file;
    this.bulkUploadMessage = '';
    this.bulkUploadError = '';
    this.bulkUploadResults = null;
    this.cdr.markForCheck();
  }

  clearBulkUpload(): void {
    this.bulkUploadFile = null;
    this.bulkUploadMessage = '';
    this.bulkUploadError = '';
    this.bulkUploadResults = null;
    this.cdr.markForCheck();
  }

  uploadBulkWorkOrders(): void {
    if (!this.bulkUploadFile || this.bulkUploading) return;
    this.bulkUploading = true;
    this.bulkUploadMessage = '';
    this.bulkUploadError = '';
    this.bulkUploadResults = null;
    this.cdr.markForCheck();

    this.apiService.bulkUploadWorkOrders(this.bulkUploadFile).subscribe({
      next: (res: { message?: string; results?: { successful?: { id: string }[]; failed?: { row: number; errors: string[] }[]; total?: number } | null }) => {
        this.bulkUploadMessage = res?.message || 'Bulk upload completed';
        this.bulkUploadResults = res?.results || null;
        this.bulkUploading = false;
        this.cdr.markForCheck();
        this.loadWorkOrders();
      },
      error: (error: { error?: { error?: string }; message?: string }) => {
        this.bulkUploadError = error?.error?.error || error?.message || 'Bulk upload failed';
        this.bulkUploading = false;
        this.cdr.markForCheck();
      }
    });
  }

  /* ══════════════════════════════════════════════════
     TRACKBY
     ══════════════════════════════════════════════════ */

  trackById(_index: number, item: WorkOrderRow): string {
    return item.id;
  }
}
