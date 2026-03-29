import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ReportFilters, ReportKey } from '../../reports.models';

interface ReportNavItem {
  key: ReportKey;
  label: string;
  path: string;
}

@Component({
  selector: 'app-reports-shell',
  templateUrl: './reports-shell.component.html',
  styleUrls: ['./reports-shell.component.css']
})
export class ReportsShellComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  readonly navItems: ReportNavItem[] = [
    { key: 'overview', label: 'Overview', path: '/reports/overview' },
    { key: 'emails', label: 'Emails', path: '/reports/emails' },
    { key: 'total-revenue', label: 'Total Revenue', path: '/reports/total-revenue' },
    { key: 'rate-per-mile', label: 'Rate Per Mile', path: '/reports/rate-per-mile' },
    { key: 'revenue-by-dispatcher', label: 'Revenue by Dispatcher', path: '/reports/revenue-by-dispatcher' },
    { key: 'payment-summary', label: 'Payment Summary', path: '/reports/payment-summary' },
    { key: 'expenses', label: 'Expenses', path: '/reports/expenses' },
    { key: 'gross-profit', label: 'Gross Profit', path: '/reports/gross-profit' },
    { key: 'gross-profit-per-load', label: 'Gross Profit per Load', path: '/reports/gross-profit-per-load' },
    { key: 'profit-loss', label: 'Profit & Loss', path: '/reports/profit-loss' },
    { key: 'direct-load-profit', label: 'Direct Load Profit', path: '/reports/direct-load-profit' },
    { key: 'fully-loaded-profit', label: 'Fully Loaded Profit', path: '/reports/fully-loaded-profit' }
  ];

  filters: ReportFilters = {};

  constructor(private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe((qp) => {
      this.filters = {
        startDate: qp['startDate'] || '',
        endDate: qp['endDate'] || '',
        dispatcherId: qp['dispatcherId'] || '',
        driverId: qp['driverId'] || '',
        status: qp['status'] || '',
        period: (qp['period'] as 'day' | 'week' | 'month') || 'week'
      };
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  applyFilters(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.toQueryParams(this.filters),
      queryParamsHandling: 'merge'
    });
  }

  clearFilters(): void {
    this.filters = { period: 'week' };
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        startDate: null,
        endDate: null,
        dispatcherId: null,
        driverId: null,
        status: null,
        period: null
      },
      queryParamsHandling: 'merge'
    });
  }

  readonly navIconMap: Record<string, string> = {
    'overview':               'dashboard',
    'emails':                 'mail',
    'total-revenue':          'attach_money',
    'rate-per-mile':          'speed',
    'revenue-by-dispatcher':  'groups',
    'payment-summary':        'payments',
    'expenses':               'trending_down',
    'gross-profit':           'trending_up',
    'gross-profit-per-load':  'local_shipping',
    'profit-loss':            'balance',
    'direct-load-profit':     'receipt_long',
    'fully-loaded-profit':    'account_balance_wallet'
  };

  navIcon(key: string): string {
    return this.navIconMap[key] ?? 'analytics';
  }

  private toQueryParams(filters: ReportFilters): Params {
    return {
      startDate: filters.startDate || null,
      endDate: filters.endDate || null,
      dispatcherId: filters.dispatcherId || null,
      driverId: filters.driverId || null,
      status: filters.status || null,
      period: filters.period || null
    };
  }
}
