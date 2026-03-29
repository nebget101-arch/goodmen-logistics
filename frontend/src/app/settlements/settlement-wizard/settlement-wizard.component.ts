import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

type WizardStep = 'week' | 'driver' | 'date_basis' | 'summary';

@Component({
  selector: 'app-settlement-wizard',
  templateUrl: './settlement-wizard.component.html',
  styleUrls: ['./settlement-wizard.component.css']
})
export class SettlementWizardComponent implements OnInit, OnDestroy {
  currentStep: WizardStep = 'week';
  steps: { id: WizardStep; label: string; icon: string }[] = [
    { id: 'week', label: 'Period', icon: 'calendar_month' },
    { id: 'driver', label: 'Driver', icon: 'badge' },
    { id: 'date_basis', label: 'Date basis', icon: 'event' },
    { id: 'summary', label: 'Summary', icon: 'summarize' }
  ];

  /** Selected payroll period (from list or newly created). */
  payrollPeriodId = '';
  periodStart = '';
  periodEnd = '';
  /** For "create new period" form. */
  newPeriodStart = '';
  newPeriodEnd = '';
  driverId = '';
  driverName = '';
  /** Backend: pickup | delivery - which date to use for eligible loads. */
  dateBasis: 'pickup' | 'delivery' = 'pickup';

  payrollPeriods: { id: string; period_start: string; period_end: string; status: string }[] = [];
  drivers: { id: string; firstName?: string; lastName?: string; name?: string; payableTo?: string }[] = [];
  loading = false;
  saving = false;
  error = '';
  creatingPeriod = false;
  activeOperatingEntityName = '';

  dateBasisOptions = [
    { value: 'pickup', label: 'Pickup date' },
    { value: 'delivery', label: 'Delivery date' }
  ];

  payrollPeriodOptions: { value: string; label: string }[] = [];
  driverOptions: { value: string; label: string }[] = [];

  private rebuildPayrollPeriodOptions(): void {
    this.payrollPeriodOptions = this.payrollPeriods.map(p => ({
      value: p.id,
      label: `${p.period_start} \u2013 ${p.period_end} (${p.status})`
    }));
  }

  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  constructor(
    private apiService: ApiService,
    private router: Router,
    private operatingEntityContext: OperatingEntityContextService
  ) {}

  ngOnInit(): void {
    this.bindOperatingEntityContext();
    this.setDefaultWeek();
    this.loadPayrollPeriods();
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
          this.loadPayrollPeriods();
          this.loadDrivers();
        }
      });
  }

  private setDefaultWeek(): void {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    this.periodStart = monday.toISOString().slice(0, 10);
    this.periodEnd = sunday.toISOString().slice(0, 10);
    this.newPeriodStart = this.periodStart;
    this.newPeriodEnd = this.periodEnd;
  }

  loadPayrollPeriods(): void {
    this.apiService.getPayrollPeriods({ limit: 100 }).subscribe({
      next: (res: any) => {
        const list = Array.isArray(res) ? res : res?.data ?? res?.rows ?? [];
        this.payrollPeriods = list.filter((p: any) => ['draft', 'open'].includes((p.status || '').toLowerCase()));
        this.rebuildPayrollPeriodOptions();
        if (this.payrollPeriods.length === 1 && !this.payrollPeriodId) {
          this.payrollPeriodId = this.payrollPeriods[0].id;
          this.onPeriodSelect();
        }
      }
    });
  }

  loadDrivers(): void {
    this.apiService.getDispatchDrivers().subscribe({
      next: (res: any) => {
        const list = res?.data ?? res?.rows ?? res ?? [];
        this.drivers = Array.isArray(list) ? list : [];
        this.driverOptions = this.drivers.map(d => ({
          value: d.id,
          label: this.getDriverDisplayName(d)
        }));
      }
    });
  }

  setStep(step: WizardStep): void {
    this.error = '';
    this.currentStep = step;
  }

  onPeriodSelect(): void {
    const p = this.payrollPeriods.find((x) => x.id === this.payrollPeriodId);
    if (p) {
      this.periodStart = p.period_start || '';
      this.periodEnd = p.period_end || '';
    }
  }

  createNewPeriod(): void {
    if (!this.newPeriodStart || !this.newPeriodEnd) {
      this.error = 'Enter period start and end dates';
      return;
    }
    this.error = '';
    this.creatingPeriod = true;
    this.apiService.createPayrollPeriod({
      period_start: this.newPeriodStart,
      period_end: this.newPeriodEnd,
      run_type: 'weekly'
    }).subscribe({
      next: (row: any) => {
        this.payrollPeriods = [{ id: row.id, period_start: row.period_start, period_end: row.period_end, status: row.status }, ...this.payrollPeriods];
        this.rebuildPayrollPeriodOptions();
        this.payrollPeriodId = row.id;
        this.periodStart = row.period_start;
        this.periodEnd = row.period_end;
        this.creatingPeriod = false;
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to create period';
        this.creatingPeriod = false;
      }
    });
  }

  onDriverChange(): void {
    const d = this.drivers.find((x) => x.id === this.driverId);
    this.driverName = d ? this.getDriverDisplayName(d) : '';
  }

  getDriverDisplayName(d: { id: string; firstName?: string; lastName?: string; name?: string }): string {
    if (d.name) return d.name;
    const first = d.firstName ?? '';
    const last = d.lastName ?? '';
    return (first + ' ' + last).trim() || d.id || '—';
  }

  canProceed(): boolean {
    switch (this.currentStep) {
      case 'week':
        return !!this.payrollPeriodId;
      case 'driver':
        return !!this.driverId;
      case 'date_basis':
        return true;
      case 'summary':
        return true;
      default:
        return false;
    }
  }

  next(): void {
    if (!this.canProceed() && this.currentStep !== 'summary') return;
    const idx = this.steps.findIndex((s) => s.id === this.currentStep);
    if (idx >= 0 && idx < this.steps.length - 1) {
      this.setStep(this.steps[idx + 1].id);
    }
  }

  back(): void {
    const idx = this.steps.findIndex((s) => s.id === this.currentStep);
    if (idx > 0) {
      this.setStep(this.steps[idx - 1].id);
    }
  }

  createDraft(): void {
    this.error = '';
    this.saving = true;
    this.apiService.createSettlementDraft({
      payroll_period_id: this.payrollPeriodId,
      driver_id: this.driverId,
      date_basis: this.dateBasis
    }).subscribe({
      next: (settlement: any) => {
        this.saving = false;
        this.router.navigate(['/settlements', settlement.id], { queryParams: { created: 'draft' } });
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to create settlement';
        this.saving = false;
      }
    });
  }

  cancel(): void {
    this.router.navigate(['/settlements']);
  }

  isActive(stepId: WizardStep): boolean {
    return this.currentStep === stepId;
  }

  isComplete(stepId: WizardStep): boolean {
    const idx = this.steps.findIndex((s) => s.id === stepId);
    const currentIdx = this.steps.findIndex((s) => s.id === this.currentStep);
    return idx < currentIdx;
  }
}
