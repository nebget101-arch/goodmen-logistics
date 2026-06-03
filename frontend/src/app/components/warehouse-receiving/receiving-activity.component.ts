import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { ActivityDrawerLine, ActivityDrawerTicket } from './receiving-activity-drawer.component';

type DateRangePreset = 'today' | '7d' | '30d' | 'custom';

interface ActivityRow {
  id: string;
  ticketNumber: string;
  postedAt: string | null;
  vendorName: string;
  referenceNumber: string;
  postedByName: string;
  totalParts: number;
  totalCost: number;
  raw: any;
}

interface ByUserAggRow { userId: string | null; name: string; count: number; }
interface ByVendorAggRow { name: string; count: number; }

interface ActivityFilters {
  preset: DateRangePreset;
  from: string | null;
  to: string | null;
  userId: string | null;
  vendor: string | null;
  ticketNumber: string;
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * FN-1494 — Receiving Activity report (POSTED tickets only).
 *
 * Filters are reflected in the URL (deep-linkable). The table shows the
 * paginated server response; row click opens a focus-trapped detail drawer.
 * Ticket# search narrows the *current page* client-side because the backend
 * (FN-1493) has no ticket# filter — it's intended as a quick refinement on
 * top of date/user/vendor narrowing, not a primary filter.
 */
@Component({
  selector: 'app-receiving-activity',
  templateUrl: './receiving-activity.component.html',
  styleUrls: ['./receiving-activity.component.css'],
})
export class ReceivingActivityComponent implements OnInit, OnChanges, OnDestroy {
  @Input() locationId = '';

  filters: ActivityFilters = {
    preset: '7d',
    from: null,
    to: null,
    userId: null,
    vendor: null,
    ticketNumber: '',
  };

  loading = false;
  error = '';
  rows: ActivityRow[] = [];
  total = 0;
  totalParts = 0;
  totalCost = 0;
  totalLines = 0;
  uniqueUsers = 0;
  byUser: ByUserAggRow[] = [];
  byVendor: ByVendorAggRow[] = [];
  page = 1;
  pageSize = DEFAULT_PAGE_SIZE;

  users: { id: string; name: string }[] = [];
  selectedTicket: ActivityDrawerTicket | null = null;
  showMobileFilters = false;

  private destroy$ = new Subject<void>();
  private filterChange$ = new Subject<void>();
  private skipUrlSync = false;

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.skipUrlSync = true;
    this.applyQueryParams(this.route.snapshot.queryParamMap);
    this.skipUrlSync = false;

    this.filterChange$
      .pipe(debounceTime(250), takeUntil(this.destroy$))
      .subscribe(() => this.fetch(true));

    this.loadUsers();
    this.fetch(true);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['locationId'] && !changes['locationId'].firstChange) {
      this.page = 1;
      this.fetch(true);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadUsers(): void {
    this.api.listUsers().subscribe({
      next: (res: any) => {
        const list = res?.data || res || [];
        this.users = list
          .map((u: any) => ({
            id: u.id || u.user_id,
            name: this.formatName(u),
          }))
          .filter((u: { id: string; name: string }) => !!u.id);
      },
      error: () => {
        // Typeahead degrades gracefully: user can still pick from byUser aggregations.
      },
    });
  }

  private formatName(u: any): string {
    const first = (u?.first_name || u?.firstName || '').trim();
    const last = (u?.last_name || u?.lastName || '').trim();
    const combined = `${first} ${last}`.trim();
    return combined || u?.username || u?.email || 'Unknown';
  }

  // ─── Filter mutations ─────────────────────────────────────────────────────

  setPreset(preset: DateRangePreset): void {
    this.filters.preset = preset;
    if (preset !== 'custom') {
      const range = this.computePresetRange(preset);
      this.filters.from = range.from;
      this.filters.to = range.to;
    }
    this.page = 1;
    this.syncUrl();
    this.filterChange$.next();
  }

  onCustomDateChange(): void {
    this.filters.preset = 'custom';
    this.page = 1;
    this.syncUrl();
    this.filterChange$.next();
  }

  onUserChange(userId: string): void {
    this.filters.userId = userId || null;
    this.page = 1;
    this.syncUrl();
    this.filterChange$.next();
  }

  onVendorChange(vendor: string): void {
    this.filters.vendor = vendor || null;
    this.page = 1;
    this.syncUrl();
    this.filterChange$.next();
  }

  onTicketSearch(): void {
    // Pure client-side narrow on visibleRows — no fetch.
    this.syncUrl();
  }

  clearAllFilters(): void {
    this.filters = {
      preset: '7d',
      from: null,
      to: null,
      userId: null,
      vendor: null,
      ticketNumber: '',
    };
    const r = this.computePresetRange('7d');
    this.filters.from = r.from;
    this.filters.to = r.to;
    this.page = 1;
    this.syncUrl();
    this.filterChange$.next();
  }

  // ─── Pagination ───────────────────────────────────────────────────────────

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  prevPage(): void {
    if (this.page <= 1) return;
    this.page -= 1;
    this.syncUrl();
    this.fetch(false);
  }

  nextPage(): void {
    if (this.page >= this.totalPages) return;
    this.page += 1;
    this.syncUrl();
    this.fetch(false);
  }

  // ─── Data fetch ───────────────────────────────────────────────────────────

  fetch(resetPage = false): void {
    if (resetPage) this.page = 1;
    this.loading = true;
    this.error = '';
    this.api
      .getReceivingActivity({
        locationId: this.locationId || undefined,
        from: this.filters.from || undefined,
        to: this.filters.to || undefined,
        userId: this.filters.userId || undefined,
        vendor: this.filters.vendor || undefined,
        page: this.page,
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (res: any) => {
          const data = Array.isArray(res?.data) ? res.data : [];
          this.rows = data.map((t: any) => this.toRow(t));
          this.total = Number(res?.total ?? 0);
          this.totalParts = Number(res?.totalParts ?? 0);
          this.totalCost = Number(res?.totalCost ?? 0);
          this.totalLines = Number(res?.totalLines ?? 0);
          this.byUser = Array.isArray(res?.byUser) ? res.byUser : [];
          this.byVendor = Array.isArray(res?.byVendor) ? res.byVendor : [];
          this.uniqueUsers = this.byUser.filter(u => !!u.userId).length;
          this.loading = false;
        },
        error: (err: any) => {
          this.error = err?.error?.error || err?.message || 'Failed to load activity';
          this.loading = false;
        },
      });
  }

  retry(): void {
    this.fetch(false);
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  get visibleRows(): ActivityRow[] {
    const q = this.filters.ticketNumber.trim().toLowerCase();
    if (!q) return this.rows;
    return this.rows.filter(r =>
      (r.ticketNumber || '').toLowerCase().includes(q) ||
      (r.referenceNumber || '').toLowerCase().includes(q)
    );
  }

  // ─── Drawer ───────────────────────────────────────────────────────────────

  openTicket(row: ActivityRow): void {
    const t = row.raw || {};
    const lines: ActivityDrawerLine[] = Array.isArray(t.lines)
      ? t.lines.map((l: any) => ({
          sku: l.sku || '',
          name: l.name || '',
          qty: Number(l.qty_received ?? l.qty ?? 0),
          unitCost: Number(l.unit_cost ?? l.unitCost ?? 0),
        }))
      : [];

    let ticketParts = 0;
    let ticketCost = 0;
    for (const l of lines) {
      ticketParts += l.qty;
      ticketCost += l.qty * l.unitCost;
    }

    const invoiceUrl = t.invoice_file_url || t.invoiceFileUrl || t.invoice_url || null;
    const invoiceName = t.invoice_file_name || t.invoiceFileName || null;

    this.selectedTicket = {
      id: row.id,
      ticketNumber: row.ticketNumber,
      vendorName: row.vendorName,
      referenceNumber: row.referenceNumber,
      postedAt: row.postedAt,
      postedByName: row.postedByName,
      locationName: t.location_name || t.locationName || '',
      totalParts: ticketParts,
      totalCost: ticketCost,
      invoiceUrl,
      invoiceFileName: invoiceName,
      lines,
    };
  }

  onRowKeydown(event: KeyboardEvent, row: ActivityRow): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openTicket(row);
    }
  }

  closeDrawer(): void {
    this.selectedTicket = null;
  }

  // ─── CSV ──────────────────────────────────────────────────────────────────

  csvUrl(): string {
    return this.api.getReceivingActivityCsvUrl({
      locationId: this.locationId || undefined,
      from: this.filters.from || undefined,
      to: this.filters.to || undefined,
      userId: this.filters.userId || undefined,
      vendor: this.filters.vendor || undefined,
    });
  }

  // ─── URL sync ─────────────────────────────────────────────────────────────

  private syncUrl(): void {
    if (this.skipUrlSync) return;
    const queryParams: Record<string, string | null> = {
      preset: this.filters.preset === '7d' ? null : this.filters.preset,
      from: this.filters.preset === 'custom' ? this.filters.from : null,
      to: this.filters.preset === 'custom' ? this.filters.to : null,
      userId: this.filters.userId,
      vendor: this.filters.vendor,
      q: this.filters.ticketNumber || null,
      page: this.page > 1 ? String(this.page) : null,
    };
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private applyQueryParams(map: import('@angular/router').ParamMap): void {
    const preset = (map.get('preset') as DateRangePreset | null) || '7d';
    this.filters.preset = preset;
    if (preset === 'custom') {
      this.filters.from = map.get('from');
      this.filters.to = map.get('to');
    } else {
      const r = this.computePresetRange(preset);
      this.filters.from = r.from;
      this.filters.to = r.to;
    }
    this.filters.userId = map.get('userId');
    this.filters.vendor = map.get('vendor');
    this.filters.ticketNumber = map.get('q') || '';
    const page = parseInt(map.get('page') || '1', 10);
    this.page = Number.isFinite(page) && page > 0 ? page : 1;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private computePresetRange(preset: DateRangePreset): { from: string | null; to: string | null } {
    if (preset === 'custom') return { from: this.filters.from, to: this.filters.to };
    const now = new Date();
    const end = now.toISOString();
    let start = new Date(now);
    if (preset === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (preset === '7d') {
      start.setDate(start.getDate() - 7);
    } else if (preset === '30d') {
      start.setDate(start.getDate() - 30);
    }
    return { from: start.toISOString(), to: end };
  }

  private toRow(t: any): ActivityRow {
    const lines = Array.isArray(t?.lines) ? t.lines : [];
    let parts = 0;
    let cost = 0;
    for (const l of lines) {
      const q = Number(l.qty_received ?? 0);
      const c = Number(l.unit_cost ?? 0);
      parts += q;
      cost += q * c;
    }
    return {
      id: t.id,
      ticketNumber: t.ticket_number || t.ticketNumber || '',
      postedAt: t.posted_at || t.postedAt || null,
      vendorName: t.vendor_name || t.vendorName || '',
      referenceNumber: t.reference_number || t.referenceNumber || '',
      postedByName: t.posted_by_name || t.postedByName || '',
      totalParts: parts,
      totalCost: cost,
      raw: t,
    };
  }

  // Mobile filter sheet
  toggleMobileFilters(): void {
    this.showMobileFilters = !this.showMobileFilters;
  }

  closeMobileFilters(): void {
    this.showMobileFilters = false;
  }

  trackRow = (_i: number, r: ActivityRow): string => r.id;
}
