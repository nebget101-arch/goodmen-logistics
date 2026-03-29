import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { ExpensePaymentCategoriesService, ExpensePaymentCategory } from '../../services/expense-payment-categories.service';
import { Subject, forkJoin, of, takeUntil } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';
import { AiSelectOption } from '../../shared/ai-select/ai-select.component';

@Component({
  selector: 'app-settlement-detail',
  templateUrl: './settlement-detail.component.html',
  styleUrls: ['./settlement-detail.component.css']
})
export class SettlementDetailComponent implements OnInit, OnDestroy {
  settlementId: string | null = null;
  loading = false;
  saving = false;
  error = '';
  successMessage = '';
  activeOperatingEntityName = '';
  dataSourceMode: 'normalized' | 'fallback' = 'normalized';

  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  settlement: any = null;
  period: any = null;
  driver: any = null;
  primaryPayee: any = null;
  additionalPayee: any = null;

  loadItems: any[] = [];
  adjustmentItems: any[] = [];
  availableLoads: any[] = [];

  scheduledDeductions: any[] = [];
  variableDeductions: any[] = [];
  manualAdjustments: any[] = [];
  scheduledDeductionWarning = '';

  // V2 dual-settlement fields
  fuelAdjustments: any[] = [];
  tollAdjustments: any[] = [];
  carriedBalanceAdjs: any[] = [];
  balanceTransferAdjs: any[] = [];

  // Categories for dropdowns
  expenseCategories: ExpensePaymentCategory[] = [];
  revenueCategories: ExpensePaymentCategory[] = [];

  // Searchable category dropdown state
  categorySearchQuery = '';
  filteredCategories: ExpensePaymentCategory[] = [];
  showCategoryDropdown = false;
  selectedCategoryName = '';
  isCreatingCategory = false;
  newCategoryName = '';

  addLoadId = '';
  addAdjustment = {
    item_type: 'deduction',
    source_type: 'manual',
    description: '',
    amount: 0,
    apply_to: 'primary_payee',
    category_id: ''
  };

  emailOptions = {
    to_driver: true,
    to_additional_payee: false,
    cc_internal: false
  };

  lastGeneratedSettlementPdfUrl = '';

  readonly adjustmentItemTypeOptions: AiSelectOption<string>[] = [
    { value: 'deduction', label: 'Deduction' },
    { value: 'earning', label: 'Earning' },
    { value: 'reimbursement', label: 'Reimbursement' },
    { value: 'advance', label: 'Advance' },
    { value: 'correction', label: 'Correction' }
  ];

  readonly adjustmentApplyToOptions: AiSelectOption<string>[] = [
    { value: 'primary_payee', label: 'Primary payee' },
    { value: 'additional_payee', label: 'Additional payee' },
    { value: 'settlement', label: 'Settlement' }
  ];

  get availableLoadSelectOptions(): AiSelectOption<string>[] {
    return (this.availableLoads || []).map((l: any) => ({
      value: String(l.id),
      label: `${l.load_number || l.id} • $${Number(l.rate || 0).toFixed(2)}`
    }));
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private apiService: ApiService,
    private categoriesService: ExpensePaymentCategoriesService,
    private operatingEntityContext: OperatingEntityContextService
  ) {}

  ngOnInit(): void {
    this.bindOperatingEntityContext();
    this.settlementId = this.route.snapshot.paramMap.get('id');
    if (this.settlementId) {
      this.loadDetail(this.settlementId);
    }
    // Load expense and revenue categories for the form
    this.loadCategories();
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
          if (this.settlementId) this.loadDetail(this.settlementId);
        }
      });
  }

  loadCategories(): void {
    forkJoin({
      expense: this.categoriesService.getFlatCategories('expense'),
      revenue: this.categoriesService.getFlatCategories('revenue')
    }).subscribe({
      next: (result) => {
        this.expenseCategories = result.expense;
        this.revenueCategories = result.revenue;
      },
      error: (err) => {
        console.error('Failed to load categories:', err);
      }
    });
  }

  backToList(): void {
    this.router.navigate(['/settlements']);
  }

  loadDetail(id: string): void {
    this.loading = true;
    this.error = '';
    this.successMessage = '';
    this.dataSourceMode = 'normalized';
    this.scheduledDeductionWarning = '';
    this.settlement = null;
    this.period = null;
    this.driver = null;
    this.primaryPayee = null;
    this.additionalPayee = null;
    this.loadItems = [];
    this.adjustmentItems = [];
    this.availableLoads = [];
    this.scheduledDeductions = [];
    this.variableDeductions = [];
    this.manualAdjustments = [];
    this.fuelAdjustments = [];
    this.tollAdjustments = [];
    this.carriedBalanceAdjs = [];
    this.balanceTransferAdjs = [];

    forkJoin({
      settlementRes: this.apiService.getSettlement(id),
      loadsRes: this.apiService.getLoads().pipe(catchError(() => of([])))
    }).subscribe({
      next: ({ settlementRes, loadsRes }) => {
        const settlement = settlementRes?.settlement || settlementRes;
        this.settlement = settlement || null;
        this.loadItems = Array.isArray(settlementRes?.load_items) ? settlementRes.load_items : [];
        this.adjustmentItems = Array.isArray(settlementRes?.adjustment_items) ? settlementRes.adjustment_items : [];

        // Prefer normalized response fields from contract guard adapter.
        this.period = settlementRes?.period || null;
        this.driver = settlementRes?.driver || null;
        this.primaryPayee = settlementRes?.primary_payee || null;
        this.additionalPayee = settlementRes?.additional_payee || null;

        const driverIdForFallback = this.settlement?.driver_id || this.driver?.id || null;
        if ((!this.additionalPayee || !this.additionalPayee.id) && driverIdForFallback) {
          this.apiService.getPayeeAssignment(driverIdForFallback).pipe(catchError(() => of(null))).subscribe({
            next: (payeeRes: any) => {
              const fallbackAdditional = payeeRes?.additional_payee || null;
              if (fallbackAdditional) {
                this.additionalPayee = fallbackAdditional;
              }
              this.logAdditionalPayeeDiagnostics(settlementRes, payeeRes);
            },
            error: () => {
              this.logAdditionalPayeeDiagnostics(settlementRes, null);
            }
          });
        } else {
          this.logAdditionalPayeeDiagnostics(settlementRes, null);
        }

        const allLoads = Array.isArray(loadsRes?.data) ? loadsRes.data : (Array.isArray(loadsRes) ? loadsRes : []);
        this.availableLoads = allLoads.filter((l: any) => {
          const belongsToDriver = !this.settlement?.driver_id || l.driver_id === this.settlement.driver_id;
          const alreadyIncluded = this.loadItems.some((x) => x.load_id === l.id);
          return belongsToDriver && !alreadyIncluded;
        });

        this.buildBuckets(settlementRes?.adjustment_groups || null);
        const settlementPeriodEnd = this.period?.period_end || settlementRes?.period_end || this.settlement?.date || null;
        this.loadScheduledDeductionWarning(
          driverIdForFallback,
          settlementPeriodEnd,
          [this.primaryPayee?.id || this.settlement?.primary_payee_id, this.additionalPayee?.id || this.settlement?.additional_payee_id].filter(Boolean)
        );

        // Backward compatibility: if core related entities are missing,
        // fetch enriched payload from Phase 4 helper endpoint.
        if (!this.driver && !this.period && !this.primaryPayee && !this.additionalPayee) {
          this.apiService.getSettlementPdfPayload(id).pipe(catchError(() => of(null))).subscribe({
            next: (pdfRes: any) => {
              this.period = pdfRes?.period || this.period;
              this.driver = pdfRes?.driver || this.driver;
              this.primaryPayee = pdfRes?.primary_payee || this.primaryPayee;
              this.additionalPayee = pdfRes?.additional_payee || this.additionalPayee;
              this.dataSourceMode = 'fallback';
              this.loading = false;
            },
            error: () => {
              this.loading = false;
            }
          });
          return;
        }

        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to load settlement detail';
        this.settlement = null;
        this.period = null;
        this.driver = null;
        this.primaryPayee = null;
        this.additionalPayee = null;
        this.loadItems = [];
        this.adjustmentItems = [];
        this.availableLoads = [];
        this.scheduledDeductions = [];
        this.variableDeductions = [];
        this.manualAdjustments = [];
        this.loading = false;
      }
    });
  }

  buildBuckets(groups?: { scheduled?: any[]; variable?: any[]; manual?: any[] } | null): void {
    const adjustments = Array.isArray(this.adjustmentItems) ? this.adjustmentItems : [];

    if (groups?.scheduled || groups?.variable || groups?.manual) {
      this.scheduledDeductions = Array.isArray(groups?.scheduled) ? groups.scheduled : [];
      this.variableDeductions = Array.isArray(groups?.variable) ? groups.variable : [];
      this.manualAdjustments = Array.isArray(groups?.manual) ? groups.manual : [];
    } else {
      this.scheduledDeductions = adjustments.filter((a) => {
        const source = (a.source_type || '').toLowerCase();
        return source === 'scheduled_rule' || source === 'scheduled';
      });

      this.variableDeductions = adjustments.filter((a) => {
        const source = (a.source_type || '').toLowerCase();
        return (source.startsWith('imported_') || source === 'variable') &&
          source !== 'imported_fuel' && source !== 'imported_toll';
      });

      this.manualAdjustments = adjustments.filter((a) => {
        const source = (a.source_type || 'manual').toLowerCase();
        return source === 'manual' || source === '';
      });
    }

    // V2-specific buckets (always derived from raw adjustments)
    this.fuelAdjustments = adjustments.filter((a) => (a.source_type || '').toLowerCase() === 'imported_fuel');
    this.tollAdjustments = adjustments.filter((a) => (a.source_type || '').toLowerCase() === 'imported_toll');
    this.carriedBalanceAdjs = adjustments.filter((a) => (a.source_type || '').toLowerCase() === 'carried_balance');
    this.balanceTransferAdjs = adjustments.filter((a) => (a.source_type || '').toLowerCase() === 'balance_transfer');
  }

  isLocked(): boolean {
    const s = (this.settlement?.settlement_status || '').toLowerCase();
    return s === 'approved' || s === 'paid' || s === 'void';
  }

  getDriverName(): string {
    const first = this.driver?.first_name || this.driver?.firstName || '';
    const last = this.driver?.last_name || this.driver?.lastName || '';
    return `${first} ${last}`.trim() || this.settlement?.driver_id || '—';
  }

  getSettlementTitle(): string {
    const period = this.getSettlementPayrollPeriodLabel();
    return period && period !== '—' ? `Settlement ${period}` : 'Settlement';
  }

  getSettlementNumberDisplay(): string {
    const driver = this.getDriverName().replace(/\s+/g, '_').toUpperCase();
    const start = this.dateOnly(this.period?.period_start || this.settlement?.period_start);
    const end = this.dateOnly(this.period?.period_end || this.settlement?.period_end || this.settlement?.date);
    const periodToken = start !== '—' && end !== '—' ? `${start}_TO_${end}` : 'NO_PERIOD';
    return `STL-${driver}-${periodToken}`;
  }

  dateOnly(value: any): string {
    if (!value) return '—';
    const str = String(value);
    const iso = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return str;
    return d.toISOString().slice(0, 10);
  }

  getTotalFor(items: any[]): number {
    return (items || []).reduce((sum, x) => sum + (Number(x?.amount) || 0), 0);
  }

  getScheduledTotalForDisplay(): number {
    return (this.scheduledDeductions || [])
      .filter((x) => !this.isScheduledDeductionRemoved(x))
      .reduce((sum, x) => sum + (Number(x?.amount) || 0), 0);
  }

  getScheduledDeductionTypeLabel(item: any): string {
    const sourceType = String(item?.source_type || 'scheduled_rule').toLowerCase();
    if (sourceType === 'scheduled_rule') return 'Scheduled deduction';
    if (sourceType === 'insurance') return 'Insurance deduction';
    if (sourceType === 'fuel') return 'Fuel deduction';
    if (sourceType === 'eld') return 'ELD deduction';
    if (sourceType === 'trailer_rent') return 'Trailer rent deduction';
    if (sourceType === 'toll') return 'Toll deduction';
    if (sourceType === 'repairs') return 'Repairs deduction';
    return `${sourceType.replace(/_/g, ' ')} deduction`;
  }

  getSettlementPayrollPeriodLabel(): string {
    const start = this.dateOnly(this.period?.period_start || this.settlement?.period_start);
    const end = this.dateOnly(this.period?.period_end || this.settlement?.period_end || this.settlement?.date);
    if (start === '—' && end === '—') return '—';
    if (start === '—') return end;
    if (end === '—') return start;
    return `${start} → ${end}`;
  }

  getScheduledDeductionTargetLabel(item: any): string {
    const applyTo = String(item?.apply_to || 'primary_payee').toLowerCase();
    if (applyTo === 'additional_payee') {
      const name = this.additionalPayee?.name || this.settlement?.additional_payee_id || 'Additional payee';
      return `Additional payee: ${name}`;
    }
    if (applyTo === 'settlement') {
      return 'Settlement-level deduction';
    }
    const primaryName = this.primaryPayee?.name || this.settlement?.primary_payee_id || 'Primary payee';
    return `Primary payee: ${primaryName}`;
  }

  getScheduledDeductionTargetShortLabel(item: any): string {
    const applyTo = String(item?.apply_to || 'primary_payee').toLowerCase();
    return applyTo === 'additional_payee' ? 'additional payee' : 'primary payee';
  }

  isScheduledDeductionRemoved(item: any): boolean {
    return String(item?.status || '').toLowerCase() === 'removed';
  }

  prefillManualFromScheduled(item: any): void {
    const applyToRaw = String(item?.apply_to || 'primary_payee').toLowerCase();
    const normalizedApplyTo = applyToRaw === 'additional_payee' ? 'additional_payee' : 'primary_payee';

    this.addAdjustment = {
      item_type: 'deduction',
      source_type: 'manual',
      description: item?.description || 'Scheduled deduction',
      amount: Number(item?.amount || 0),
      apply_to: normalizedApplyTo,
      category_id: ''
    };
    this.successMessage = `Prefilled manual deduction for ${normalizedApplyTo === 'additional_payee' ? 'additional payee' : 'primary payee'}. Click Add in Manual adjustments to save.`;
  }

  removeScheduledDeductionFromCalculation(item: any): void {
    if (!this.settlementId || !item?.id || this.saving) return;
    if (this.isLocked()) {
      this.error = 'Settlement is locked.';
      return;
    }

    this.saving = true;
    this.error = '';
    this.successMessage = '';

    this.apiService.removeSettlementAdjustment(this.settlementId, item.id).subscribe({
      next: () => {
        this.successMessage = 'Scheduled deduction removed from this settlement calculation.';
        this.saving = false;
        this.loadDetail(this.settlementId as string);
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to remove scheduled deduction';
        this.saving = false;
      }
    });
  }

  addScheduledDeductionBackToCalculation(item: any): void {
    if (!this.settlementId || !item?.id || this.saving) return;
    if (this.isLocked()) {
      this.error = 'Settlement is locked.';
      return;
    }

    this.saving = true;
    this.error = '';
    this.successMessage = '';

    this.apiService.restoreSettlementAdjustment(this.settlementId, item.id).subscribe({
      next: () => {
        this.successMessage = 'Scheduled deduction added back to this settlement calculation.';
        this.saving = false;
        this.loadDetail(this.settlementId as string);
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to add scheduled deduction back';
        this.saving = false;
      }
    });
  }

  private loadScheduledDeductionWarning(driverId: string | null, settlementPeriodEnd: string | null, payeeIds: string[] = []): void {
    this.scheduledDeductionWarning = '';

    if (!driverId || !settlementPeriodEnd || this.scheduledDeductions.length > 0) {
      return;
    }

    const normalizedPeriodEnd = this.normalizeDateValue(settlementPeriodEnd);
    if (!normalizedPeriodEnd) {
      return;
    }

    this.apiService.getRecurringDeductions({ driver_id: driverId, payee_ids: payeeIds, enabled: true }).pipe(catchError(() => of([]))).subscribe({
      next: (rules: any[]) => {
        if (this.scheduledDeductions.length > 0) {
          this.scheduledDeductionWarning = '';
          return;
        }

        const futureRules = (Array.isArray(rules) ? rules : [])
          .map((rule) => ({ ...rule, normalizedStartDate: this.normalizeDateValue(rule?.start_date) }))
          .filter((rule) => !!rule.normalizedStartDate && rule.normalizedStartDate > normalizedPeriodEnd)
          .sort((left, right) => String(left.normalizedStartDate).localeCompare(String(right.normalizedStartDate)));

        if (!futureRules.length) {
          return;
        }

        const earliestStart = futureRules[0].normalizedStartDate;
        const ruleLabel = futureRules.length === 1 ? 'rule starts' : `rules start, earliest on`;
        this.scheduledDeductionWarning = `${futureRules.length} active scheduled deduction ${futureRules.length === 1 ? 'rule' : 'rules'} ${ruleLabel} ${earliestStart}, after this settlement period ended on ${normalizedPeriodEnd}. Edit the rule start date or backfill a later period.`;
      }
    });
  }

  private normalizeDateValue(value: unknown): string {
    if (!value) return '';
    const text = String(value);
    const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDate) return isoDate[1];
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  }

  addLoad(): void {
    if (!this.settlementId || !this.addLoadId || this.saving) return;
    this.saving = true;
    this.error = '';
    this.successMessage = '';
    this.apiService.addSettlementLoad(this.settlementId, { load_id: this.addLoadId }).subscribe({
      next: () => {
        this.addLoadId = '';
        this.successMessage = 'Load added and totals recalculated.';
        this.saving = false;
        this.loadDetail(this.settlementId as string);
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to add load';
        this.saving = false;
      }
    });
  }

  removeLoad(loadItemId: string): void {
    if (!this.settlementId || !loadItemId || this.saving) return;
    this.saving = true;
    this.error = '';
    this.successMessage = '';
    this.apiService.removeSettlementLoad(this.settlementId, loadItemId).subscribe({
      next: () => {
        this.successMessage = 'Load removed and totals recalculated.';
        this.saving = false;
        this.loadDetail(this.settlementId as string);
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to remove load';
        this.saving = false;
      }
    });
  }

  addManualAdjustment(): void {
    if (!this.settlementId || this.saving) return;
    if (!this.addAdjustment.description.trim()) {
      this.error = 'Description is required for adjustment.';
      return;
    }
    if (!this.addAdjustment.amount) {
      this.error = 'Amount is required for adjustment.';
      return;
    }

    this.saving = true;
    this.error = '';
    this.successMessage = '';

    this.apiService.addSettlementAdjustment(this.settlementId, {
      item_type: this.addAdjustment.item_type,
      source_type: this.addAdjustment.source_type,
      description: this.addAdjustment.description,
      amount: Number(this.addAdjustment.amount),
      apply_to: this.addAdjustment.apply_to,
      category_id: this.addAdjustment.category_id || null
    }).subscribe({
      next: () => {
        this.addAdjustment = {
          item_type: 'deduction',
          source_type: 'manual',
          description: '',
          amount: 0,
          apply_to: 'primary_payee',
          category_id: ''
        };
        this.successMessage = 'Manual adjustment added.';
        this.saving = false;
        this.loadDetail(this.settlementId as string);
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to add adjustment';
        this.saving = false;
      }
    });
  }

  removeAdjustment(adjustmentId: string): void {
    if (!this.settlementId || !adjustmentId || this.saving) return;
    this.saving = true;
    this.error = '';
    this.successMessage = '';
    this.apiService.removeSettlementAdjustment(this.settlementId, adjustmentId).subscribe({
      next: () => {
        this.successMessage = 'Adjustment removed.';
        this.saving = false;
        this.loadDetail(this.settlementId as string);
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to remove adjustment';
        this.saving = false;
      }
    });
  }

  recalcTotals(): void {
    if (!this.settlementId || this.saving) return;
    this.saving = true;
    this.error = '';
    this.successMessage = '';
    this.apiService.recalcSettlement(this.settlementId).subscribe({
      next: (recalcRes: any) => {
        console.log('[Settlement Debug] recalc response', {
          settlement_id: this.settlementId,
          subtotal_driver_pay: recalcRes?.subtotal_driver_pay,
          subtotal_additional_payee: recalcRes?.subtotal_additional_payee,
          net_pay_driver: recalcRes?.net_pay_driver,
          net_pay_additional_payee: recalcRes?.net_pay_additional_payee,
          additional_payee_id: recalcRes?.additional_payee_id
        });
        this.successMessage = 'Totals recalculated.';
        this.saving = false;
        this.loadDetail(this.settlementId as string);
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to recalculate totals';
        this.saving = false;
      }
    });
  }

  approve(): void {
    if (!this.settlementId || this.saving) return;
    this.saving = true;
    this.error = '';
    this.successMessage = '';
    this.apiService.approveSettlement(this.settlementId).subscribe({
      next: () => {
        this.successMessage = 'Settlement approved.';
        this.saving = false;
        this.loadDetail(this.settlementId as string);
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to approve settlement';
        this.saving = false;
      }
    });
  }

  voidSettlement(): void {
    if (!this.settlementId || this.saving) return;
    this.saving = true;
    this.error = '';
    this.successMessage = '';
    this.apiService.voidSettlement(this.settlementId).subscribe({
      next: () => {
        this.successMessage = 'Settlement voided.';
        this.saving = false;
        this.loadDetail(this.settlementId as string);
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to void settlement';
        this.saving = false;
      }
    });
  }

  sendEmail(): void {
    if (!this.settlementId || this.saving) return;
    this.saving = true;
    this.error = '';
    this.successMessage = '';
    this.apiService.sendSettlementEmail(this.settlementId, this.emailOptions).subscribe({
      next: (res: any) => {
        const count = Array.isArray(res?.recipients) ? res.recipients.length : 0;
        this.successMessage = `Email request sent (${count} recipient${count === 1 ? '' : 's'}).`;
        this.saving = false;
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to send settlement email';
        this.saving = false;
      }
    });
  }

  generateSettlementPdfToCloud(): void {
    if (!this.settlementId || this.saving) return;
    this.saving = true;
    this.error = '';
    this.successMessage = '';

    this.apiService.generateSettlementPdfToR2(this.settlementId).subscribe({
      next: (res: any) => {
        const url = res?.download_url || '';
        this.lastGeneratedSettlementPdfUrl = url;
        if (url) {
          window.open(url, '_blank');
        }
        this.successMessage = url
          ? 'Settlement PDF generated and uploaded to Cloudflare R2.'
          : 'Settlement PDF generated in Cloudflare R2.';
        this.saving = false;
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to generate settlement PDF';
        this.saving = false;
      }
    });
  }

  downloadSettlementPdf(): void {
    if (!this.settlementId || this.saving) return;
    this.saving = true;
    this.error = '';
    this.successMessage = '';

    this.apiService.downloadSettlementPdfBlob(this.settlementId).subscribe({
      next: (blob: Blob) => {
        const fileName = `${this.getSettlementNumberDisplay()}.pdf`;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        this.successMessage = 'Settlement PDF downloaded.';
        this.saving = false;
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to download settlement PDF';
        this.saving = false;
      }
    });
  }

  getDataSourceLabel(): string {
    return this.dataSourceMode === 'fallback' ? 'Fallback enriched payload' : 'Normalized settlement contract';
  }

  isV2Settlement(): boolean {
    return !!(this.settlement?.settlement_type);
  }

  isEoSettlement(): boolean {
    return (this.settlement?.settlement_type || '') === 'equipment_owner';
  }

  getSettlementTypeLabel(): string {
    const t = (this.settlement?.settlement_type || '').toLowerCase();
    if (t === 'equipment_owner') return 'Equipment Owner';
    if (t === 'driver') return 'Driver';
    return '';
  }

  getSettlementTypeClass(): string {
    const t = (this.settlement?.settlement_type || '').toLowerCase();
    if (t === 'equipment_owner') return 'badge-eo';
    if (t === 'driver') return 'badge-driver-type';
    return '';
  }

  getCarriedBalance(): number {
    return Number(this.settlement?.carried_balance) || 0;
  }

  hasNegativeNet(): boolean {
    return this.getCarriedBalance() > 0 && Number(this.settlement?.net_pay_driver) === 0;
  }

  private logAdditionalPayeeDiagnostics(detail: any, payeeAssignmentRes: any | null): void {
    const additionalFromDetail = detail?.additional_payee || null;
    const additionalFromAssignment = payeeAssignmentRes?.additional_payee || null;
    const additional = additionalFromDetail || additionalFromAssignment || null;

    let snapshotRate: number | null = null;
    const firstItem = Array.isArray(this.loadItems) && this.loadItems.length ? this.loadItems[0] : null;
    if (firstItem?.pay_basis_snapshot) {
      const snapshot = typeof firstItem.pay_basis_snapshot === 'string'
        ? (() => {
            try { return JSON.parse(firstItem.pay_basis_snapshot); } catch { return {}; }
          })()
        : firstItem.pay_basis_snapshot;
      const parsed = Number(snapshot?.additional_payee_rate);
      snapshotRate = Number.isFinite(parsed) ? parsed : null;
    }

    const rawRate = additional?.additional_payee_rate ?? snapshotRate;
    const rate = Number(rawRate);
    const validRate = Number.isFinite(rate) ? rate : 0;

    console.groupCollapsed(`[Settlement Debug] Additional Payee diagnostics: ${this.settlementId || 'unknown'}`);
    console.log('additional_payee(detail)', additionalFromDetail);
    console.log('additional_payee(assignment fallback)', additionalFromAssignment);
    console.log('chosen additional payee', additional);
    console.log('additional_payee_rate raw', rawRate, 'numeric', validRate);

    (this.loadItems || []).forEach((item: any) => {
      const gross = Number(item?.gross_amount) || 0;
      const expected = (gross * validRate) / 100;
      console.log('load check', {
        load_id: item?.load_id,
        load_number: item?.load_number,
        gross_amount: gross,
        expected_additional_payee_amount: expected,
        actual_additional_payee_amount: Number(item?.additional_payee_amount) || 0
      });
    });
    console.groupEnd();
  }

  // Category dropdown methods
  getAvailableCategories(): ExpensePaymentCategory[] {
    // Return revenue categories for earnings/reimbursements, expense categories for others
    const isRevenue = this.addAdjustment.item_type === 'earning' || this.addAdjustment.item_type === 'reimbursement';
    return isRevenue ? this.revenueCategories : this.expenseCategories;
  }

  get filteredStandardCategories(): ExpensePaymentCategory[] {
    return this.filteredCategories.filter(category => category.source === 'global');
  }

  get filteredCustomCategories(): ExpensePaymentCategory[] {
    return this.filteredCategories.filter(category => category.source !== 'global');
  }

  onCategorySearchFocus(): void {
    this.showCategoryDropdown = true;
    this.filterCategories();
  }

  onCategorySearchBlur(): void {
    // Delay to allow click events to fire
    setTimeout(() => {
      this.showCategoryDropdown = false;
    }, 200);
  }

  onCategorySearchInput(): void {
    this.filterCategories();
    this.showCategoryDropdown = true;
  }

  filterCategories(): void {
    const query = this.categorySearchQuery.toLowerCase().trim();
    const available = this.getAvailableCategories();
    
    if (!query) {
      this.filteredCategories = available;
    } else {
      this.filteredCategories = available.filter(cat => 
        cat.name.toLowerCase().includes(query) ||
        cat.code.toString().includes(query)
      );
    }
  }

  selectCategory(category: ExpensePaymentCategory): void {
    this.addAdjustment.category_id = category.id;
    this.selectedCategoryName = category.name;
    this.categorySearchQuery = category.name;
    this.showCategoryDropdown = false;
  }

  clearCategorySelection(): void {
    this.addAdjustment.category_id = '';
    this.selectedCategoryName = '';
    this.categorySearchQuery = '';
    this.filteredCategories = this.getAvailableCategories();
  }

  showCreateNewCategory(): boolean {
    // Show "Create new" option if search query exists and no exact match found
    if (!this.categorySearchQuery.trim()) return false;
    const query = this.categorySearchQuery.toLowerCase();
    return !this.filteredCategories.some(cat => cat.name.toLowerCase() === query);
  }

  startCreatingCategory(): void {
    this.isCreatingCategory = true;
    this.newCategoryName = this.categorySearchQuery;
  }

  cancelCreateCategory(): void {
    this.isCreatingCategory = false;
    this.newCategoryName = '';
  }

  createNewCategory(): void {
    if (!this.newCategoryName.trim() || this.saving) return;
    
    this.saving = true;
    this.error = '';
    
    const isRevenue = this.addAdjustment.item_type === 'earning' || this.addAdjustment.item_type === 'reimbursement';
    const categoryData = {
      name: this.newCategoryName.trim(),
      type: (isRevenue ? 'revenue' : 'expense') as 'expense' | 'revenue',
      description: 'Custom category created from settlement'
    };

    this.categoriesService.createCategory(categoryData).subscribe({
      next: (newCategory) => {
        newCategory.source = 'custom';

        // Add to appropriate list
        if (isRevenue) {
          this.revenueCategories.push(newCategory);
        } else {
          this.expenseCategories.push(newCategory);
        }
        
        // Select the newly created category
        this.selectCategory(newCategory);
        
        this.isCreatingCategory = false;
        this.newCategoryName = '';
        this.saving = false;
        this.successMessage = `Category "${newCategory.name}" created successfully`;
        
        // Clear success message after 3 seconds
        setTimeout(() => {
          this.successMessage = '';
        }, 3000);
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to create category';
        this.saving = false;
      }
    });
  }
}
