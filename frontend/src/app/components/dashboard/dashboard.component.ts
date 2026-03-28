import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  stats: any = {};
  alerts: any[] = [];
  loading = true;
  isDegraded = false;
  degradedGroups: string[] = [];
  activeOperatingEntityName = '';

  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  alertFilterType: 'all' | 'critical' | 'warning' = 'all';
  alertFilterCategory: 'all' | 'driver' | 'vehicle' | 'maintenance' | 'compliance' = 'all';

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
    this.apiService.getDashboardStats().subscribe({
      next: (data) => {
        this.stats = data;
        this.isDegraded = !!data?.degraded;
        this.degradedGroups = Array.isArray(data?.degradedGroups) ? data.degradedGroups : [];
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading dashboard stats:', error);
        this.loading = false;
      }
    });

    this.apiService.getAlerts().subscribe({
      next: (data) => {
        this.alerts = data || [];
      },
      error: (error) => {
        console.error('Error loading alerts:', error);
      }
    });
  }

  get filteredAlerts(): any[] {
    return (this.alerts || []).filter(a => {
      if (this.alertFilterType !== 'all' && a.type !== this.alertFilterType) return false;
      if (this.alertFilterCategory !== 'all' && a.category !== this.alertFilterCategory) return false;
      return true;
    });
  }

  getAlertClass(type: string): string {
    if (type === 'critical' || type === 'danger' || type === 'error') return 'alert-critical';
    if (type === 'warning') return 'alert-warning';
    return 'alert-info';
  }

  getAlertLink(alert: any): string | null {
    if (alert.driverId) return '/drivers/dqf';
    if (alert.vehicleId) return '/vehicles';
    return null;
  }

  getAlertQueryParams(alert: any): any {
    if (alert.driverId) {
      const params: any = { highlight: alert.driverId };
      if (alert.category === 'compliance' && alert.message?.toLowerCase().includes('clearinghouse')) params.filter = 'clearinghouse';
      else if (alert.category === 'compliance' && alert.message?.toLowerCase().includes('dqf')) params.filter = 'dqf-low';
      else if (alert.message?.toLowerCase().includes('medical') || alert.message?.toLowerCase().includes('cdl')) params.filter = 'med-certs';
      return params;
    }
    if (alert.vehicleId) {
      if (alert.category === 'maintenance') return { filter: 'maintenance-due' };
      if (alert.category === 'vehicle') return { filter: 'oos' };
      return { vehicleId: alert.vehicleId };
    }
    return {};
  }
}
