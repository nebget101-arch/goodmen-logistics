import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { HttpErrorResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

interface RecurringDeduction {
  id: string;
  driver_id: string | null;
  payee_id: string | null;
  equipment_id: string | null;
  rule_scope: string;
  description: string;
  amount_type: string;
  amount: number;
  frequency: string;
  start_date: string;
  end_date: string | null;
  source_type: string | null;
  applies_when: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
  // Enriched fields from joins
  driver_name?: string;
  payee_name?: string;
  expense_type?: string;
}

interface RecurringDeductionCreatePayload {
  driver_id?: string;
  payee_id?: string;
  equipment_id?: string;
  rule_scope: string;
  description: string;
  amount_type: string;
  amount: number;
  frequency: string;
  start_date: string;
  end_date?: string;
  source_type?: string;
  applies_when?: string;
  enabled: boolean;
}

interface RecurringDeductionUpdatePayload {
  driver_id?: string;
  payee_id?: string;
  equipment_id?: string;
  rule_scope?: string;
  description?: string;
  amount_type?: string;
  amount?: number;
  frequency?: string;
  start_date?: string;
  end_date?: string;
  enabled?: boolean;
  applies_when?: string;
  source_type?: string;
}

@Component({
  selector: 'app-scheduled-deductions',
  templateUrl: './scheduled-deductions.component.html',
  styleUrls: ['./scheduled-deductions.component.css']
})
export class ScheduledDeductionsComponent implements OnInit {
  deductions: RecurringDeduction[] = [];
  drivers: any[] = [];
  payees: any[] = [];
  loading = true;
  showModal = false;
  saving = false;
  backfilling = false;
  editingId: string | null = null;
  backfillResult: any = null;
  backfillWarning = '';

  filters = {
    driverId: '',
    enabled: ''
  };

  backfillForm = {
    driver_id: '',
    start_date: '',
    end_date: '',
    include_locked: false,
    dry_run: false,
    limit: 500
  };

  formData: Partial<RecurringDeduction> = {
    driver_id: null,
    payee_id: null,
    equipment_id: null,
    rule_scope: 'driver',
    description: '',
    amount_type: 'fixed',
    amount: 0,
    frequency: 'weekly',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: null,
    source_type: null,
    applies_when: 'always',
    enabled: true
  };

  amountTypeOptions = [
    { value: 'fixed', label: 'Fixed amount' },
    { value: 'percentage', label: 'Percentage of gross' }
  ];

  frequencyOptions = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Bi-weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'per_settlement', label: 'Per settlement' }
  ];

  ruleScopeOptions = [
    { value: 'driver', label: 'Driver-specific' },
    { value: 'payee', label: 'Payee-specific' },
    { value: 'equipment', label: 'Equipment-specific' },
    { value: 'global', label: 'Global (all drivers)' }
  ];

  appliesWhenOptions = [
    { value: 'always', label: 'Always' },
    { value: 'has_loads', label: 'Only when driver has loads' },
    { value: 'specific_expense', label: 'Based on expense responsibility' }
  ];

  expenseTypeOptions = [
    { value: 'fuel', label: 'Fuel' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'eld', label: 'ELD' },
    { value: 'trailer_rent', label: 'Trailer rent' },
    { value: 'toll', label: 'Tolls' },
    { value: 'repairs', label: 'Repairs' }
  ];

  constructor(private apiService: ApiService) {}

  ngOnInit(): void {
    this.loadDeductions();
    this.loadDrivers();
    this.loadPayees();
  }

  loadDeductions(): void {
    this.loading = true;
    const params: any = {};
    if (this.filters.driverId) params.driver_id = this.filters.driverId;
    if (this.filters.enabled) params.enabled = this.filters.enabled;

    this.apiService.getRecurringDeductions(params).subscribe({
      next: (data: RecurringDeduction[]) => {
        this.deductions = data || [];
        this.loading = false;
      },
      error: (err: HttpErrorResponse) => {
        console.error('Error loading deductions:', err);
        this.loading = false;
      }
    });
  }

  loadDrivers(): void {
    this.apiService.getDrivers().subscribe({
      next: (data) => {
        this.drivers = data || [];
      },
      error: (err) => console.error('Error loading drivers:', err)
    });
  }

  loadPayees(): void {
    this.apiService.getAllPayees({ is_active: true, limit: 200 }).subscribe({
      next: (data) => {
        this.payees = data || [];
      },
      error: (err) => console.error('Error loading payees:', err)
    });
  }

  clearFilters(): void {
    this.filters = {
      driverId: '',
      enabled: ''
    };
    this.loadDeductions();
  }

  openNew(): void {
    this.editingId = null;
    this.formData = {
      driver_id: null,
      payee_id: null,
      equipment_id: null,
      rule_scope: 'driver',
      description: '',
      amount_type: 'fixed',
      amount: 0,
      frequency: 'weekly',
      start_date: new Date().toISOString().slice(0, 10),
      end_date: null,
      source_type: null,
      applies_when: 'always',
      enabled: true
    };
    this.showModal = true;
  }

  openEdit(deduction: RecurringDeduction): void {
    this.editingId = deduction.id;
    const normalizedStartDate = this.normalizeDateInput(deduction.start_date) || undefined;
    const normalizedEndDate = this.normalizeDateInput(deduction.end_date) || undefined;
    this.formData = {
      ...deduction,
      start_date: normalizedStartDate,
      end_date: normalizedEndDate
    };
    this.showModal = true;
  }

  closeModal(): void {
    if (this.saving) return;
    this.showModal = false;
    this.editingId = null;
  }

  save(): void {
    if (!this.formData.description || this.formData.amount === undefined) {
      alert('Description and amount are required');
      return;
    }

    this.saving = true;
    const createPayload: RecurringDeductionCreatePayload = {
      driver_id: this.formData.driver_id ?? undefined,
      payee_id: this.formData.payee_id ?? undefined,
      equipment_id: this.formData.equipment_id ?? undefined,
      rule_scope: this.formData.rule_scope || 'driver',
      description: this.formData.description || '',
      amount_type: this.formData.amount_type || 'fixed',
      amount: Number(this.formData.amount ?? 0),
      frequency: this.formData.frequency || 'weekly',
      start_date: this.formData.start_date || new Date().toISOString().slice(0, 10),
      end_date: this.formData.end_date ?? undefined,
      source_type: this.formData.source_type ?? undefined,
      applies_when: this.formData.applies_when || 'always',
      enabled: this.formData.enabled ?? true
    };

    const updatePayload: RecurringDeductionUpdatePayload = {
      driver_id: createPayload.driver_id,
      payee_id: createPayload.payee_id,
      equipment_id: createPayload.equipment_id,
      rule_scope: createPayload.rule_scope,
      description: createPayload.description,
      amount_type: createPayload.amount_type,
      amount: createPayload.amount,
      frequency: createPayload.frequency,
      start_date: createPayload.start_date,
      end_date: createPayload.end_date,
      enabled: createPayload.enabled,
      applies_when: createPayload.applies_when,
      source_type: createPayload.source_type
    };

    if (this.editingId) {
      // Update existing
      this.apiService.updateRecurringDeduction(this.editingId, updatePayload).subscribe({
        next: () => {
          this.loadDeductions();
          this.saving = false;
          this.showModal = false;
        },
        error: (err: HttpErrorResponse) => {
          console.error('Error updating deduction:', err);
          alert('Failed to update deduction');
          this.saving = false;
        }
      });
    } else {
      // Create new
      this.apiService.createRecurringDeduction(createPayload).subscribe({
        next: () => {
          this.loadDeductions();
          this.saving = false;
          this.showModal = false;
        },
        error: (err: HttpErrorResponse) => {
          console.error('Error creating deduction:', err);
          alert('Failed to create deduction');
          this.saving = false;
        }
      });
    }
  }

  toggleEnabled(deduction: RecurringDeduction): void {
    const newStatus = !deduction.enabled;
    this.apiService.updateRecurringDeduction(deduction.id, { enabled: newStatus }).subscribe({
      next: () => {
        deduction.enabled = newStatus;
      },
      error: (err: HttpErrorResponse) => {
        console.error('Error toggling deduction:', err);
        alert('Failed to update deduction status');
      }
    });
  }

  getDriverName(driverId: string | null): string {
    if (!driverId) return '—';
    const driver = this.drivers.find(d => d.id === driverId);
    return driver ? `${driver.firstName} ${driver.lastName}` : driverId;
  }

  getPayeeName(payeeId: string | null): string {
    if (!payeeId) return '—';
    const payee = this.payees.find(p => p.id === payeeId);
    return payee ? payee.name : payeeId;
  }

  formatAmount(deduction: RecurringDeduction): string {
    if (deduction.amount_type === 'percentage') {
      return `${deduction.amount}%`;
    }
    return `$${deduction.amount.toFixed(2)}`;
  }

  getFrequencyLabel(frequency: string): string {
    const option = this.frequencyOptions.find(o => o.value === frequency);
    return option ? option.label : frequency;
  }

  private normalizeDateInput(value?: string | null): string | null {
    if (!value) return null;
    return String(value).slice(0, 10);
  }

  onBackfillCriteriaChange(): void {
    this.updateBackfillWarning();
  }

  private updateBackfillWarning(): void {
    this.backfillWarning = '';
    if (!this.backfillForm.start_date || !this.backfillForm.end_date) {
      return;
    }

    this.apiService.getRecurringDeductions({
      driver_id: this.backfillForm.driver_id || undefined,
      enabled: true
    }).pipe(catchError(() => of([]))).subscribe({
      next: (rules: any[]) => {
        const normalizedEnd = this.normalizeDateInput(this.backfillForm.end_date);
        if (!normalizedEnd) {
          this.backfillWarning = '';
          return;
        }

        const futureRules = (Array.isArray(rules) ? rules : [])
          .map((rule) => ({ ...rule, normalizedStartDate: this.normalizeDateInput(rule?.start_date) }))
          .filter((rule) => !!rule.normalizedStartDate && rule.normalizedStartDate > normalizedEnd)
          .sort((left, right) => String(left.normalizedStartDate).localeCompare(String(right.normalizedStartDate)));

        if (!futureRules.length) {
          this.backfillWarning = '';
          return;
        }

        const earliestStart = futureRules[0].normalizedStartDate;
        this.backfillWarning = `${futureRules.length} active scheduled deduction ${futureRules.length === 1 ? 'rule starts' : 'rules start'} after this backfill range. Earliest start date: ${earliestStart}.`;
      }
    });
  }

  runBackfill(): void {
    if (!this.backfillForm.start_date || !this.backfillForm.end_date) {
      alert('Start date and end date are required for backfill.');
      return;
    }

    if (this.backfillForm.end_date < this.backfillForm.start_date) {
      alert('End date must be on or after start date.');
      return;
    }

    this.backfilling = true;
    this.backfillResult = null;
    this.updateBackfillWarning();

    this.apiService.backfillRecurringDeductions({
      driver_id: this.backfillForm.driver_id || undefined,
      start_date: this.backfillForm.start_date,
      end_date: this.backfillForm.end_date,
      include_locked: this.backfillForm.include_locked,
      dry_run: this.backfillForm.dry_run,
      limit: this.backfillForm.limit
    }).subscribe({
      next: (res: any) => {
        this.backfillResult = res;
        this.backfilling = false;
        if (!this.backfillForm.dry_run) {
          this.loadDeductions();
        }
      },
      error: (err: HttpErrorResponse) => {
        console.error('Backfill failed:', err);
        alert(err?.error?.error || 'Backfill failed');
        this.backfilling = false;
      }
    });
  }
}
