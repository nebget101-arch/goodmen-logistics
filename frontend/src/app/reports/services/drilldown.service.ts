import { Injectable } from '@angular/core';
import { DrilldownTarget, ReportFilters, ReportKey } from '../reports.models';

// FN-1183: Pure nav-target construction for report drill-downs.
// URL contracts: see docs/reports/drilldown-contracts.md.
//
// Returns null when no useful destination exists for a given row/card —
// callers render plain (no link, no hover affordance).
@Injectable({ providedIn: 'root' })
export class DrilldownService {
  /**
   * Build a nav target for a report row. Picks the most specific destination
   * available given the row's identifier columns and the source report.
   *
   * Order of preference per row:
   *   1. load_id / load_number      → /loads with loadId
   *   2. customer_id / broker_id    → /shop-clients/:id (customer detail)
   *   3. driver_id                  → /drivers?driverId=...
   *   4. dispatcher_id (revenue)    → /loads?dispatcherId=...
   *
   * Date range from the source report's filters carries to /loads as
   * `from`/`to` query params (ISO yyyy-MM-dd).
   */
  getRowTarget(
    reportKey: ReportKey,
    row: Record<string, unknown>,
    filters: ReportFilters
  ): DrilldownTarget | null {
    if (!row) return null;

    const loadId = pickId(row, ['load_id', 'loadId']);
    if (loadId) {
      return { destination: 'loads', commands: ['/loads'], queryParams: { loadId } };
    }

    const customerId = pickId(row, ['customer_id', 'customerId', 'broker_id', 'brokerId']);
    if (customerId) {
      return { destination: 'customers', commands: ['/shop-clients', customerId] };
    }

    const driverId = pickId(row, ['driver_id', 'driverId']);
    if (driverId) {
      const qp = this.dateRangeParams(filters);
      qp['driverId'] = driverId;
      return { destination: 'drivers', commands: ['/drivers'], queryParams: qp };
    }

    if (reportKey === 'revenue-by-dispatcher') {
      const dispatcherId = pickId(row, ['dispatcher_id', 'dispatcherId']);
      if (dispatcherId) {
        const qp = this.dateRangeParams(filters);
        qp['dispatcherId'] = dispatcherId;
        return { destination: 'loads', commands: ['/loads'], queryParams: qp };
      }
    }

    return null;
  }

  /**
   * Build a nav target for a KPI card. Cards are reportKey-specific:
   * revenue cards → /loads (filtered by date), gross-profit-per-load summary
   * card → /loads (date), payment-summary aggregate → /loads.
   *
   * Cards without a meaningful destination return null.
   */
  getCardTarget(
    reportKey: ReportKey,
    cardKey: string,
    filters: ReportFilters
  ): DrilldownTarget | null {
    if (!cardKey) return null;

    const dateQp = this.dateRangeParams(filters);

    // Revenue / load-level totals → loads list filtered by date range.
    const revenueCards = new Set([
      'total_revenue',
      'totalRevenue',
      'revenue',
      'loads_count',
      'loadsCount',
      'gross_profit',
      'grossProfit',
      'direct_profit',
      'directProfit',
      'fully_loaded_profit',
      'fullyLoadedProfit'
    ]);

    if (revenueCards.has(cardKey)) {
      const qp = { ...dateQp };
      if (filters.dispatcherId) qp['dispatcherId'] = filters.dispatcherId;
      if (filters.driverId) qp['driverId'] = filters.driverId;
      return { destination: 'loads', commands: ['/loads'], queryParams: qp };
    }

    // Outstanding / paid totals on payment-summary aggregate to /loads.
    if (
      reportKey === 'payment-summary' &&
      (cardKey === 'total_paid' || cardKey === 'outstanding')
    ) {
      return { destination: 'loads', commands: ['/loads'], queryParams: dateQp };
    }

    return null;
  }

  private dateRangeParams(filters: ReportFilters): Record<string, string> {
    const qp: Record<string, string> = {};
    const from = filters.startDate || filters.date_from;
    const to = filters.endDate || filters.date_to;
    if (from) qp['from'] = String(from);
    if (to) qp['to'] = String(to);
    return qp;
  }
}

function pickId(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined || v === '') continue;
    return String(v);
  }
  return null;
}
