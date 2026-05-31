import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';
import { KpiStatus } from '../../shared/kpi-card/kpi-card.component';

/** View-model for one KPI tile in the loads/billing clusters (FN-1640). */
export interface DashboardKpiCard {
  label: string;
  value: number;
  subline: string;
  status: KpiStatus;
  routerLink: string;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  stats: any = {};
  loading = true;
  isDegraded = false;
  degradedGroups: string[] = [];
  activeOperatingEntityName = '';

  /** FN-1640 — KPI cards rendered via <app-kpi-card>. Rebuilt on each load
      so the OnPush primitives see stable input references. */
  loadsCards: DashboardKpiCard[] = [];
  billingCards: DashboardKpiCard[] = [];

  /** Skeleton placeholder counts per cluster (mirror the real card counts). */
  readonly loadsSkeletonCount = 4;
  readonly billingSkeletonCount = 5;

  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  constructor(
    private apiService: ApiService,
    private operatingEntityContext: OperatingEntityContextService
  ) { }

  ngOnInit(): void {
    this.bindOperatingEntityContext();
    this.loadDashboard();
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
          this.loadDashboard();
        }
      });
  }

  loadDashboard(): void {
    this.loading = true;
    this.apiService.getDashboardStats().subscribe({
      next: (data) => {
        this.stats = data || {};
        this.isDegraded = !!data?.degraded;
        this.degradedGroups = Array.isArray(data?.degradedGroups) ? data.degradedGroups : [];
        this.buildKpiCards();
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading dashboard stats:', error);
        this.loading = false;
      }
    });
  }

  /** FN-1640 — Retry handler for the degraded-data banner. */
  retry(): void {
    this.loadDashboard();
  }

  /**
   * Build the loads + billing KPI card view-models from `stats`.
   * Status mapping preserves the legacy template's emphasis:
   * Delivered/Paid → good, Funded → warning, everything else → info.
   * Backend does not emit `previousPeriodValue`, so no trend chip is set
   * (delta is intentionally omitted rather than fabricated — see FN-1637
   * Open Items).
   */
  private buildKpiCards(): void {
    const s = this.stats || {};
    this.loadsCards = [
      { label: 'Dispatched', value: s.loadsDispatched ?? 0, subline: 'Assigned, ready to move', status: 'info', routerLink: '/loads' },
      { label: 'In Transit', value: s.loadsInTransit ?? 0, subline: 'Currently on the road', status: 'info', routerLink: '/loads' },
      { label: 'Delivered', value: s.loadsDelivered ?? 0, subline: 'Completed', status: 'good', routerLink: '/loads' },
      { label: 'Canceled', value: s.loadsCanceled ?? 0, subline: 'Cancelled loads', status: 'info', routerLink: '/loads' }
    ];
    this.billingCards = [
      { label: 'Pending', value: s.billingPending ?? 0, subline: 'Awaiting billing', status: 'info', routerLink: '/loads' },
      { label: 'Canceled', value: s.billingCanceled ?? 0, subline: 'Billing canceled', status: 'info', routerLink: '/loads' },
      { label: 'Invoiced', value: s.billingInvoiced ?? 0, subline: 'BOL received / Sent to factoring', status: 'info', routerLink: '/loads' },
      { label: 'Funded', value: s.billingFunded ?? 0, subline: 'Advance funded', status: 'warning', routerLink: '/loads' },
      { label: 'Paid', value: s.billingPaid ?? 0, subline: 'Payment received', status: 'good', routerLink: '/loads' }
    ];
  }
}
