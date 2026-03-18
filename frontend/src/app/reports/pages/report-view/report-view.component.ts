import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subject, switchMap, takeUntil } from 'rxjs';
import { ReportCard, ReportColumn, ReportFilters, ReportKey, ReportPageConfig } from '../../reports.models';
import { ReportsService } from '../../services/reports.service';
import { OperatingEntityContextService } from '../../../services/operating-entity-context.service';

const REPORT_CONFIG: Record<ReportKey, ReportPageConfig> = {
  overview: {
    key: 'overview',
    title: 'Overview',
    subtitle: 'AI snapshot of top metrics and trends.',
    endpoint: 'overview',
    columns: [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'revenue', label: 'Revenue', type: 'currency' },
      { key: 'expenses', label: 'Expenses', type: 'currency' },
      { key: 'gross_profit', label: 'Gross Profit', type: 'currency' }
    ]
  },
  emails: {
    key: 'emails',
    title: 'Emails',
    subtitle: 'Invoice and settlement email activity.',
    endpoint: 'emails',
    columns: [
      { key: 'event_date', label: 'Date', type: 'date' },
      { key: 'event_type', label: 'Event' },
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'count', label: 'Count', type: 'number' }
    ]
  },
  'total-revenue': {
    key: 'total-revenue',
    title: 'Total Revenue',
    subtitle: 'Revenue trend by period.',
    endpoint: 'total-revenue',
    columns: [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'loads_count', label: 'Loads', type: 'number' },
      { key: 'total_revenue', label: 'Revenue', type: 'currency' }
    ]
  },
  'rate-per-mile': {
    key: 'rate-per-mile',
    title: 'Rate per Mile',
    subtitle: 'Loaded miles and average RPM.',
    endpoint: 'rate-per-mile',
    columns: [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'loaded_miles', label: 'Loaded Miles', type: 'number' },
      { key: 'revenue', label: 'Revenue', type: 'currency' },
      { key: 'rpm', label: 'RPM', type: 'currency' }
    ]
  },
  'revenue-by-dispatcher': {
    key: 'revenue-by-dispatcher',
    title: 'Revenue by Dispatcher',
    subtitle: 'Dispatcher productivity and revenue contribution.',
    endpoint: 'revenue-by-dispatcher',
    columns: [
      { key: 'dispatcher_name', label: 'Dispatcher' },
      { key: 'loads_count', label: 'Loads', type: 'number' },
      { key: 'total_revenue', label: 'Revenue', type: 'currency' },
      { key: 'avg_revenue_per_load', label: 'Avg / Load', type: 'currency' }
    ]
  },
  'payment-summary': {
    key: 'payment-summary',
    title: 'Payment Summary',
    subtitle: 'Paid, outstanding, and payment-method distribution.',
    endpoint: 'payment-summary',
    columns: [
      { key: 'method', label: 'Method' },
      { key: 'payment_count', label: 'Payments', type: 'number' },
      { key: 'total_paid', label: 'Total Paid', type: 'currency' }
    ]
  },
  expenses: {
    key: 'expenses',
    title: 'Expenses',
    subtitle: 'Expense totals by category and source.',
    endpoint: 'expenses',
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'source', label: 'Source' },
      { key: 'expense_count', label: 'Count', type: 'number' },
      { key: 'total_amount', label: 'Amount', type: 'currency' }
    ]
  },
  'gross-profit': {
    key: 'gross-profit',
    title: 'Gross Profit',
    subtitle: 'Revenue, expenses, and gross profit trend.',
    endpoint: 'gross-profit',
    columns: [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'revenue', label: 'Revenue', type: 'currency' },
      { key: 'expenses', label: 'Expenses', type: 'currency' },
      { key: 'gross_profit', label: 'Gross Profit', type: 'currency' },
      { key: 'margin_pct', label: 'Margin', type: 'percent' }
    ]
  },
  'gross-profit-per-load': {
    key: 'gross-profit-per-load',
    title: 'Gross Profit per Load',
    subtitle: 'Load-level profitability.',
    endpoint: 'gross-profit-per-load',
    columns: [
      { key: 'load_number', label: 'Load #' },
      { key: 'completed_date', label: 'Completed', type: 'date' },
      { key: 'revenue', label: 'Revenue', type: 'currency' },
      { key: 'expenses', label: 'Expenses', type: 'currency' },
      { key: 'gross_profit', label: 'Gross Profit', type: 'currency' }
    ]
  },
  'profit-loss': {
    key: 'profit-loss',
    title: 'Profit & Loss',
    subtitle: 'P&L statement-style report by period.',
    endpoint: 'profit-loss',
    columns: [
      { key: 'period', label: 'Period', type: 'date' },
      { key: 'revenue', label: 'Revenue', type: 'currency' },
      { key: 'cost_of_operations', label: 'Cost of Operations', type: 'currency' },
      { key: 'gross_profit', label: 'Gross Profit', type: 'currency' }
    ]
  }
};

@Component({
  selector: 'app-report-view',
  templateUrl: './report-view.component.html',
  styleUrls: ['./report-view.component.css']
})
export class ReportViewComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  config!: ReportPageConfig;
  isLoading = false;
  isAllEntitiesMode = false;
  error = '';
  cards: ReportCard[] = [];
  rows: Record<string, unknown>[] = [];
  reportSummary: Record<string, unknown> = {};

  constructor(
    private route: ActivatedRoute,
    private reportsService: ReportsService,
    private operatingEntityContext: OperatingEntityContextService
  ) {}

  ngOnInit(): void {
    this.operatingEntityContext.context$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (!state.isLoaded) return;
        const nextId = state.selectedOperatingEntityId || null;
        this.isAllEntitiesMode = nextId === 'all';
        if (this.lastOperatingEntityId === undefined) {
          this.lastOperatingEntityId = nextId;
          return;
        }
        if (this.lastOperatingEntityId !== nextId && this.config?.endpoint) {
          this.lastOperatingEntityId = nextId;
          this.fetchReport(this.getCurrentFilters());
        }
      });

    this.route.data
      .pipe(
        takeUntil(this.destroy$),
        switchMap((data) => {
          const reportKey = data['reportKey'] as ReportKey;
          this.config = REPORT_CONFIG[reportKey] || REPORT_CONFIG.overview;
          return this.route.queryParams;
        })
      )
      .subscribe((qp) => {
        this.fetchReport({
          startDate: qp['startDate'] || undefined,
          endDate: qp['endDate'] || undefined,
          dispatcherId: qp['dispatcherId'] || undefined,
          driverId: qp['driverId'] || undefined,
          status: qp['status'] || undefined,
          period: qp['period'] || undefined
        });
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  exportAs(format: 'csv' | 'pdf'): void {
    this.reportsService
      .exportReport(this.config.key, format, this.getCurrentFilters())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${this.config.key}.${format}`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: () => {
          this.error = 'Export failed. Please try again.';
        }
      });
  }

  asColumns(): ReportColumn[] {
    const baseColumns = this.config?.columns || [];
    if (!this.isAllEntitiesMode) return baseColumns;
    const hasEntityColumn = baseColumns.some((c) => c.key === 'operating_entity_name');
    if (hasEntityColumn) return baseColumns;
    return [{ key: 'operating_entity_name', label: 'Operating Entity' }, ...baseColumns];
  }

  operatingEntitySubtotals(): Array<{ operating_entity_name: string; subtotal: number }> {
    const rows = (this.reportSummary?.['operatingEntitySubtotals'] as Array<{ operating_entity_name: string; subtotal: number }>) || [];
    return Array.isArray(rows) ? rows : [];
  }

  format(value: unknown, type: ReportColumn['type']): string {
    if (value === null || value === undefined || value === '') return '—';
    if (type === 'currency') return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (type === 'number') return Number(value).toLocaleString();
    if (type === 'percent') return `${Number(value).toFixed(2)}%`;
    if (type === 'date') {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
    }
    return String(value);
  }

  trackByIndex(index: number): number {
    return index;
  }

  private fetchReport(filters: ReportFilters): void {
    this.isLoading = true;
    this.error = '';
    this.reportsService.getReport(this.config.endpoint, filters).pipe(takeUntil(this.destroy$)).subscribe({
      next: (resp) => {
        this.cards = resp.cards || [];
        this.rows = resp.data || [];
        this.reportSummary = (resp.summary || {}) as Record<string, unknown>;
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Unable to load report data.';
        this.rows = [];
        this.cards = [];
        this.reportSummary = {};
        this.isLoading = false;
      }
    });
  }

  private getCurrentFilters(): ReportFilters {
    const qp = this.route.snapshot.queryParams;
    return {
      startDate: qp['startDate'] || undefined,
      endDate: qp['endDate'] || undefined,
      dispatcherId: qp['dispatcherId'] || undefined,
      driverId: qp['driverId'] || undefined,
      status: qp['status'] || undefined,
      period: qp['period'] || undefined
    };
  }
}
