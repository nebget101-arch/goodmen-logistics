import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

export interface SettlementRow {
  id: string;
  settlementNumber: string;
  periodStart: string;
  periodEnd: string;
  driverId: string;
  driverName: string;
  payableTo: string;
  additionalPayee: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'void';
  gross: number;
  deductions: number;
  netDriver: number;
  netAdditionalPayee: number;
  updatedAt: string;
}

@Component({
  selector: 'app-settlement-list',
  templateUrl: './settlement-list.component.html',
  styleUrls: ['./settlement-list.component.css']
})
export class SettlementListComponent implements OnInit, OnDestroy {
  settlements: SettlementRow[] = [];
  drivers: { id: string; firstName?: string; lastName?: string; name?: string }[] = [];
  loading = false;
  error = '';
  activeOperatingEntityName = '';

  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  filters: {
    weekStart: string;
    driverId: string;
    status: string;
  } = {
    weekStart: '',
    driverId: '',
    status: ''
  };

  /** Backend uses: preparing | ready_for_review | approved | paid | void */
  statusOptions = [
    { value: '', label: 'All statuses' },
    { value: 'preparing', label: 'Draft / Preparing' },
    { value: 'ready_for_review', label: 'Pending approval' },
    { value: 'approved', label: 'Approved' },
    { value: 'paid', label: 'Paid' },
    { value: 'void', label: 'Void' }
  ];

  constructor(
    private apiService: ApiService,
    private router: Router,
    private operatingEntityContext: OperatingEntityContextService
  ) {}

  ngOnInit(): void {
    this.bindOperatingEntityContext();
    this.loadDrivers();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private bindOperatingEntityContext(): void {
    this.operatingEntityContext.context$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (!state.isLoaded) return;

        this.activeOperatingEntityName = state.selectedOperatingEntity?.name || '';
        const nextId = state.selectedOperatingEntityId || null;

        if (this.lastOperatingEntityId === undefined) {
          this.lastOperatingEntityId = nextId;
          return;
        }

        if (this.lastOperatingEntityId !== nextId) {
          this.lastOperatingEntityId = nextId;
          this.loadSettlements();
        }
      });
  }

  loadDrivers(): void {
    this.apiService.getDispatchDrivers().subscribe({
      next: (res: any) => {
        const list = res?.data ?? res?.rows ?? res ?? [];
        this.drivers = Array.isArray(list) ? list : [];
        this.loadSettlements();
      },
      error: () => this.loadSettlements()
    });
  }

  loadSettlements(): void {
    this.loading = true;
    this.error = '';
    const params: any = { limit: 100 };
    if (this.filters.driverId) params.driver_id = this.filters.driverId;
    if (this.filters.status) params.settlement_status = this.filters.status;
    this.apiService.listSettlements(params).subscribe({
      next: (rows: any) => {
        const list = Array.isArray(rows) ? rows : rows?.data ?? rows?.rows ?? [];
        this.settlements = list.map((s: any) => this.mapSettlementRow(s));
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to load settlements';
        this.loading = false;
      }
    });
  }

  /** Convert scientific-notation number strings to fixed-point without floating-point loss */
  private sciToFixed(sci: string): string {
    const m = sci.match(/^(\d+)\.?(\d*)[eE]([+-]?\d+)$/);
    if (!m) return sci;
    const digits = m[1] + m[2];
    const exp = parseInt(m[3], 10);
    const decimalPos = m[1].length + exp;
    if (decimalPos >= digits.length) {
      return digits + '0'.repeat(decimalPos - digits.length);
    }
    return decimalPos > 0 ? digits.slice(0, decimalPos) : '0';
  }

  private toSafeString(val: any): string {
    if (val == null) return '';
    const str = String(val);
    return str.replace(/\d+\.?\d*[eE][+-]?\d+/g, (match) => this.sciToFixed(match));
  }

  private mapSettlementRow(s: any): SettlementRow {
    const driver = this.drivers.find((d) => d.id === s.driver_id);
    const driverName = driver ? this.getDriverDisplayName(driver) : (s.driver_id || '—');
    return {
      id: this.toSafeString(s.id),
      settlementNumber: this.toSafeString(s.settlement_number) || this.toSafeString(s.id),
      periodStart: this.toDateOnly(s.period_start),
      periodEnd: this.toDateOnly(s.period_end),
      driverId: s.driver_id || '',
      driverName,
      payableTo: s.payable_to_name || driverName || '—',
      additionalPayee: s.additional_payee_name ?? '—',
      status: this.normalizeStatus(s.settlement_status),
      gross: Number(s.subtotal_gross) || 0,
      deductions: Number(s.total_deductions) || 0,
      netDriver: Number(s.net_pay_driver) || 0,
      netAdditionalPayee: Number(s.net_pay_additional_payee) || 0,
      updatedAt: this.toDateOnly(s.updated_at || s.created_at)
    };
  }

  private toDateOnly(value: any): string {
    if (!value) return '';
    const str = String(value);
    const iso = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return str;
    return d.toISOString().slice(0, 10);
  }

  private normalizeStatus(backendStatus: string): 'draft' | 'pending_approval' | 'approved' | 'void' {
    const s = (backendStatus || '').toLowerCase();
    if (s === 'preparing') return 'draft';
    if (s === 'ready_for_review') return 'pending_approval';
    if (s === 'approved' || s === 'paid') return 'approved';
    if (s === 'void') return 'void';
    return 'draft';
  }

  clearFilters(): void {
    this.filters = { weekStart: '', driverId: '', status: '' };
    this.loadSettlements();
  }

  openSettlement(id: string): void {
    this.router.navigate(['/settlements', id]);
  }

  createNew(): void {
    this.router.navigate(['/settlements/new']);
  }

  openScheduledDeductions(): void {
    this.router.navigate(['/settlements/scheduled-deductions']);
  }

  getStatusClass(status: string): string {
    const m: Record<string, string> = {
      draft: 'badge-draft',
      pending_approval: 'badge-pending',
      approved: 'badge-success',
      void: 'badge-muted'
    };
    return m[status] ?? 'badge-muted';
  }

  getStatusLabel(status: string): string {
    const m: Record<string, string> = {
      draft: 'Draft',
      pending_approval: 'Pending approval',
      approved: 'Approved',
      void: 'Void'
    };
    return m[status] ?? (status || '—');
  }

  getDriverDisplayName(d: { id: string; firstName?: string; lastName?: string; name?: string }): string {
    if (d.name) return d.name;
    const first = d.firstName ?? '';
    const last = d.lastName ?? '';
    return (first + ' ' + last).trim() || d.id || '—';
  }
}
