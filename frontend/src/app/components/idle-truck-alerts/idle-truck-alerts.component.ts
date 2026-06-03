import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

export interface IdleTruckAlert {
  id: string;
  tenantId: string;
  vehicleId: string;
  driverId: string | null;
  equipmentOwnerId: string | null;
  alertType: 'week_1_idle' | 'week_2_no_response';
  accruedDeductions: number;
  responseStatus: 'pending' | 'acknowledged' | 'resolved' | 'escalated';
  responseNotes: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  createdAt: string;
  truckNumber: string | null;
  driverName: string | null;
}

@Component({
  selector: 'app-idle-truck-alerts',
  templateUrl: './idle-truck-alerts.component.html',
  styleUrls: ['./idle-truck-alerts.component.css']
})
export class IdleTruckAlertsComponent implements OnInit, OnDestroy {
  alerts: IdleTruckAlert[] = [];
  total = 0;
  loading = false;
  error = '';
  successMessage = '';

  alertTypeFilter = '';
  responseStatusFilter = '';

  readonly alertTypeOptions = [
    { value: 'week_1_idle', label: 'Week 1 Idle' },
    { value: 'week_2_no_response', label: 'Week 2 No Response' }
  ];
  readonly responseStatusOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'escalated', label: 'Escalated' }
  ];
  readonly respondStatusOptions = [
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'escalated', label: 'Escalated' }
  ];

  // Respond modal state
  showRespondModal = false;
  respondingAlert: IdleTruckAlert | null = null;
  respondStatus = 'acknowledged';
  respondNotes = '';
  saving = false;

  private destroy$ = new Subject<void>();

  constructor(
    private apiService: ApiService,
    private operatingEntityContext: OperatingEntityContextService
  ) {}

  ngOnInit(): void {
    this.operatingEntityContext.context$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (state.isLoaded) this.loadAlerts();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadAlerts(): void {
    this.loading = true;
    this.error = '';
    const filters: any = { limit: 100, offset: 0 };
    if (this.alertTypeFilter) filters.alert_type = this.alertTypeFilter;
    if (this.responseStatusFilter) filters.response_status = this.responseStatusFilter;

    this.apiService.listIdleTruckAlerts(filters).subscribe({
      next: (res: any) => {
        const list = Array.isArray(res) ? res : res?.alerts ?? [];
        this.total = res?.total ?? list.length;
        this.alerts = list.map((r: any) => this.mapRow(r));
        this.loading = false;
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to load alerts';
        this.loading = false;
      }
    });
  }

  private mapRow(r: any): IdleTruckAlert {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      vehicleId: r.vehicle_id,
      driverId: r.driver_id || null,
      equipmentOwnerId: r.equipment_owner_id || null,
      alertType: r.alert_type,
      accruedDeductions: Number(r.accrued_deductions) || 0,
      responseStatus: r.response_status || 'pending',
      responseNotes: r.response_notes || null,
      respondedBy: r.responded_by || null,
      respondedAt: r.responded_at ? this.toDateOnly(r.responded_at) : null,
      createdAt: this.toDateOnly(r.created_at),
      truckNumber: r.truck_number || null,
      driverName: r.driver_name || null
    };
  }

  private toDateOnly(value: any): string {
    if (!value) return '';
    const str = String(value);
    const iso = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? str : d.toISOString().slice(0, 10);
  }

  applyFilters(): void {
    this.loadAlerts();
  }

  clearFilters(): void {
    this.alertTypeFilter = '';
    this.responseStatusFilter = '';
    this.loadAlerts();
  }

  openRespondModal(alert: IdleTruckAlert): void {
    this.respondingAlert = alert;
    this.respondStatus = 'acknowledged';
    this.respondNotes = '';
    this.showRespondModal = true;
  }

  closeRespondModal(): void {
    this.showRespondModal = false;
    this.respondingAlert = null;
    this.respondNotes = '';
  }

  confirmRespond(): void {
    if (!this.respondingAlert || this.saving) return;
    this.saving = true;
    this.error = '';
    this.successMessage = '';

    this.apiService.respondToIdleTruckAlert(this.respondingAlert.id, this.respondStatus, this.respondNotes).subscribe({
      next: () => {
        this.successMessage = `Alert marked as ${this.respondStatus}.`;
        this.saving = false;
        this.closeRespondModal();
        this.loadAlerts();
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Action failed';
        this.saving = false;
      }
    });
  }

  getAlertTypeLabel(type: string): string {
    return type === 'week_1_idle' ? 'Week 1 Idle' : 'Week 2 — No Response';
  }

  getAlertTypeClass(type: string): string {
    return type === 'week_1_idle' ? 'badge-week1' : 'badge-week2';
  }

  getStatusClass(status: string): string {
    const m: Record<string, string> = {
      pending: 'badge-pending',
      acknowledged: 'badge-acknowledged',
      resolved: 'badge-resolved',
      escalated: 'badge-escalated'
    };
    return m[status] ?? 'badge-muted';
  }

  getStatusLabel(status: string): string {
    const m: Record<string, string> = {
      pending: 'Pending',
      acknowledged: 'Acknowledged',
      resolved: 'Resolved',
      escalated: 'Escalated'
    };
    return m[status] ?? status;
  }

  get unresolvedCount(): number {
    return this.alerts.filter(a => a.responseStatus === 'pending').length;
  }
}
