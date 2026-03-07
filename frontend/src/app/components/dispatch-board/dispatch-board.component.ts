import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoadsService } from '../../services/loads.service';
import { ApiService } from '../../services/api.service';
import { LoadListItem } from '../../models/load-dashboard.model';

interface DriverRow {
  id: string | null;
  name: string;
  unitNumber?: string;
  phone?: string;
  type: 'driver' | 'unassigned';
}

interface DayColumn {
  date: Date;
  label: string;
  dayNum: number;
  isToday: boolean;
}

type SortField = 'driver' | 'unit' | 'delivery';
type SortDir = 'asc' | 'desc';

interface CustomFilter {
  id: string;
  name: string;
  driverIds: string[];
}

@Component({
  selector: 'app-dispatch-board',
  templateUrl: './dispatch-board.component.html',
  styleUrls: ['./dispatch-board.component.css']
})
export class DispatchBoardComponent implements OnInit {
  weekStart: Date = this.getWeekStart(new Date());
  drivers: DriverRow[] = [];
  loads: LoadListItem[] = [];
  unassignedLoads: LoadListItem[] = [];
  loading = true;
  searchText = '';
  dateSearch: string = '';

  sortField: SortField = 'driver';
  sortDir: SortDir = 'asc';
  sortOptions: { value: SortField; dir: SortDir; label: string }[] = [
    { value: 'driver', dir: 'asc', label: "Driver's Name ↑" },
    { value: 'driver', dir: 'desc', label: "Driver's Name ↓" },
    { value: 'unit', dir: 'asc', label: 'Unit Number ↑' },
    { value: 'unit', dir: 'desc', label: 'Unit Number ↓' },
    { value: 'delivery', dir: 'asc', label: 'Delivery Date ↑' },
    { value: 'delivery', dir: 'desc', label: 'Delivery Date ↓' }
  ];
  selectedSortOption = this.sortOptions[0];

  filterBy: 'all' | 'today' | 'tomorrow' | 'ready' | 'unassigned' = 'all';
  filterOptions = [
    { value: 'all', label: 'All' },
    { value: 'today', label: "Today's Trucks" },
    { value: 'tomorrow', label: "Tomorrow's Trucks" },
    { value: 'ready', label: 'Ready Now' },
    { value: 'unassigned', label: 'Unassigned Loads' }
  ];

  loadStatusFilter: string = '';
  loadStatusOptions = ['', 'DELIVERED', 'EN_ROUTE', 'IN_TRANSIT', 'DISPATCHED', 'PICKED_UP', 'NEW'];

  driverFilterId: string | null = null;
  driverFilterOpen = false;
  customFilters: CustomFilter[] = [];
  showFilterModal = false;
  editingFilter: CustomFilter | null = null;
  filterName = '';
  filterDriverSearch = '';
  filterSelectedIds = new Set<string>();

  private readonly STORAGE_KEY = 'fleetneuron_dispatch_filters';

  constructor(
    private loadsService: LoadsService,
    private apiService: ApiService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  get days(): DayColumn[] {
    const out: DayColumn[] = [];
    const today = this.toDateOnly(new Date());
    for (let i = 0; i < 7; i++) {
      const d = new Date(this.weekStart);
      d.setDate(d.getDate() + i);
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = d.getDate();
      const ordinal = this.getOrdinal(dayNum);
      out.push({
        date: d,
        label: `${dayName} ${ordinal}`,
        dayNum,
        isToday: this.toDateOnly(d) === today
      });
    }
    return out;
  }

  getOrdinal(n: number): string {
    if (n >= 11 && n <= 13) return n + 'th';
    const r = n % 10;
    if (r === 1) return n + 'st';
    if (r === 2) return n + 'nd';
    if (r === 3) return n + 'rd';
    return n + 'th';
  }

  get driverFilterLabel(): string {
    if (this.driverFilterId === 'all' || !this.driverFilterId) return 'Show All';
    const f = this.customFilters.find(x => x.id === this.driverFilterId);
    return f?.name || 'Custom';
  }

  get weekRangeLabel(): string {
    const end = new Date(this.weekStart);
    end.setDate(end.getDate() + 6);
    return `${this.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  get filteredDrivers(): DriverRow[] {
    let list = [...this.drivers];
    if (this.driverFilterId === 'all' || !this.driverFilterId) return list;
    const filter = this.customFilters.find(f => f.id === this.driverFilterId);
    if (!filter || !filter.driverIds.length) return list;
    const ids = new Set(filter.driverIds);
    return list.filter(d => d.id && ids.has(d.id));
  }

  get sortedFilteredDrivers(): DriverRow[] {
    const list = [...this.filteredDrivers];
    const sf = this.sortField;
    const sd = this.sortDir;
    list.sort((a, b) => {
      if (a.type === 'unassigned' && b.type !== 'unassigned') return 1;
      if (a.type !== 'unassigned' && b.type === 'unassigned') return -1;
      if (a.type === 'unassigned') return 0;
      let cmp = 0;
      if (sf === 'driver') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sf === 'unit') cmp = (a.unitNumber || '').localeCompare(b.unitNumber || '');
      else cmp = 0;
      return sd === 'asc' ? cmp : -cmp;
    });
    return list;
  }

  /** Loads for a driver that touch the visible week (pickup or delivery in range). */
  getLoadsForDriver(driverId: string | null): LoadListItem[] {
    const source = driverId === null ? this.unassignedLoads : this.loads;
    const weekStartStr = this.toDateOnly(this.weekStart);
    const weekEnd = new Date(this.weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = this.toDateOnly(weekEnd);
    return source.filter(l => {
      if (driverId !== null) {
        const loadDriverId = this.getLoadDriverId(l);
        const driverIdStr = driverId.toString().trim();
        if (!loadDriverId || loadDriverId !== driverIdStr) return false;
      }
      const delivery = l.delivery_date ? this.toDateOnly(l.delivery_date) : null;
      const pickup = l.pickup_date ? this.toDateOnly(l.pickup_date) : null;
      const start = pickup || delivery || '';
      const end = delivery || pickup || start;
      return (start >= weekStartStr && start <= weekEndStr) || (end >= weekStartStr && end <= weekEndStr);
    });
  }

  /** True if the given day column (0-based index) is covered by any load for this driver. */
  isDayCoveredByLoad(driverId: string | null, dayIndex: number): boolean {
    const col = dayIndex + 1;
    const loads = this.getLoadsForDriver(driverId);
    return loads.some(load => {
      const { startCol, span } = this.getLoadSpan(load);
      return col >= startCol && col < startCol + span;
    });
  }

  /** Grid column start (1-7) and span for a load card. Uses local-date parsing to avoid timezone shift. */
  getLoadSpan(load: LoadListItem): { startCol: number; span: number } {
    const pickup = load.pickup_date ? this.toDateOnly(load.pickup_date) : null;
    const delivery = load.delivery_date ? this.toDateOnly(load.delivery_date) : null;
    const startDate = pickup || delivery || '';
    const endDate = delivery || pickup || startDate;
    let startIdx = this.getDayIndexWithinWeek(startDate);
    let endIdx = this.getDayIndexWithinWeek(endDate);
    if (startIdx > endIdx) [startIdx, endIdx] = [endIdx, startIdx];
    const span = Math.max(1, endIdx - startIdx + 1);
    return { startCol: startIdx + 1, span };
  }

  /** Resolve load's driver ID from driver_id, driverId, or driver_name match. */
  private getLoadDriverId(load: any): string | null {
    const id = (load.driver_id ?? load.driverId ?? null);
    if (id != null && String(id).trim()) return String(id).trim();
    const name = (load.driver_name ?? '').toString().trim();
    if (!name) return null;
    const driver = this.drivers.find(d => d.type === 'driver' && d.id && d.name.toLowerCase() === name.toLowerCase());
    return driver?.id ?? null;
  }

  getLoadCardPickup(load: LoadListItem): string {
    const city = (load.pickup_city || '').trim();
    const state = (load.pickup_state || '').trim();
    return [city, state].filter(Boolean).join(', ') || '—';
  }

  getLoadCardDelivery(load: LoadListItem): string {
    const city = (load.delivery_city || '').trim();
    const state = (load.delivery_state || '').trim();
    return [city, state].filter(Boolean).join(', ') || '—';
  }

  getLoadDeliveryDate(load: LoadListItem): string {
    const d = load.delivery_date || load.completed_date || null;
    if (!d) return '';
    const parsed = this.parseDateLocal(String(d));
    if (!parsed) return '';
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }

  /** Pickup date in MM/DD/YY format. */
  getLoadPickupDateMMDDYY(load: LoadListItem): string {
    const d = load.pickup_date || null;
    if (!d) return '';
    const parsed = this.parseDateLocal(String(d));
    if (!parsed) return '';
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const y = String(parsed.getFullYear()).slice(-2);
    return `${m}/${day}/${y}`;
  }

  /** Delivery date in MM/DD/YY format. */
  getLoadDeliveryDateMMDDYY(load: LoadListItem): string {
    const d = load.delivery_date || load.completed_date || null;
    if (!d) return '';
    const parsed = this.parseDateLocal(String(d));
    if (!parsed) return '';
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const y = String(parsed.getFullYear()).slice(-2);
    return `${m}/${day}/${y}`;
  }

  getLoadTooltip(load: LoadListItem): string {
    const parts: string[] = [];
    const rate = load.rate != null ? `$${Number(load.rate).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '';
    if (rate) parts.push(`Price: ${rate}`);
    const pickup = [load.pickup_city, load.pickup_state, load.pickup_zip].filter(Boolean).map(s => (s || '').trim()).filter(Boolean).join(', ');
    if (pickup) parts.push(`Pickup: ${pickup}`);
    const delivery = [load.delivery_city, load.delivery_state, load.delivery_zip].filter(Boolean).map(s => (s || '').trim()).filter(Boolean).join(', ');
    if (delivery) parts.push(`Delivery: ${delivery}`);
    return parts.join('\n');
  }

  getLoadCardClass(load: LoadListItem): string {
    const s = (load.status || '').toString().toUpperCase().replace(/[\s-]+/g, '_');
    const b = (load.billing_status || '').toString().toUpperCase().replace(/[\s-]+/g, '_');
    let cls = 'load-card load-card-default';
    if (['CANCELLED', 'CANCELED'].includes(s)) cls = 'load-card load-card-cancelled';
    else if (['DELIVERED'].includes(s)) cls = 'load-card load-card-delivered';
    else if (['EN_ROUTE', 'IN_TRANSIT', 'PICKED_UP'].includes(s)) cls = 'load-card load-card-enroute';
    else if (['DISPATCHED', 'NEW'].includes(s)) cls = 'load-card load-card-dispatched';
    if (['PAID', 'FUNDED'].includes(b)) cls += ' load-card-billing-paid';
    else if (['INVOICED', 'SENT_TO_FACTORING'].includes(b)) cls += ' load-card-billing-invoiced';
    else if (['PENDING', 'BOL_RECEIVED'].includes(b)) cls += ' load-card-billing-pending';
    return cls;
  }

  ngOnInit(): void {
    this.loadCustomFilters();
    this.loadData();
  }

  private loadCustomFilters(): void {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) this.customFilters = JSON.parse(raw);
    } catch (_e) { this.customFilters = []; }
  }

  private saveCustomFilters(): void {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.customFilters));
  }

  private getWeekStart(d: Date): Date {
    const x = new Date(d);
    x.setDate(x.getDate() - x.getDay());
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /** Parse date as local to avoid UTC midnight shifting to previous day. Supports YYYY-MM-DD and MM/DD/YY. */
  private parseDateLocal(str: string | null | undefined): Date | null {
    if (!str) return null;
    const s = String(str).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
      return isNaN(d.getTime()) ? null : d;
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const month = parseInt(m[1], 10) - 1;
      const day = parseInt(m[2], 10);
      let year = parseInt(m[3], 10);
      if (year < 100) year += year < 50 ? 2000 : 1900;
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  private toDateOnly(d: Date | string): string {
    if (typeof d === 'string') {
      const parsed = this.parseDateLocal(d);
      if (!parsed) return '';
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Day index 0-6 within the visible week for a date string. */
  private getDayIndexWithinWeek(dateStr: string): number {
    const parsed = this.parseDateLocal(dateStr);
    if (!parsed) return 0;
    const weekStart = new Date(this.weekStart);
    weekStart.setHours(0, 0, 0, 0);
    parsed.setHours(0, 0, 0, 0);
    const diffMs = parsed.getTime() - weekStart.getTime();
    const diffDays = Math.round(diffMs / 86400000);
    return Math.max(0, Math.min(6, diffDays));
  }

  prevWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() - 7);
    this.weekStart = d;
    this.loadData();
  }

  nextWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() + 7);
    this.weekStart = d;
    this.loadData();
  }

  goToDate(d: Date): void {
    this.weekStart = this.getWeekStart(d);
    this.loadData();
  }

  /** For AI date picker: current dateSearch as Date | null (local). */
  get dateSearchAsDate(): Date | null {
    if (!this.dateSearch || !this.dateSearch.trim()) return null;
    const parts = this.dateSearch.trim().split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  onDatePickerChange(date: Date | null): void {
    if (!date) return;
    this.dateSearch = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    this.goToDate(date);
  }

  searchByDate(): void {
    if (this.dateSearch) {
      const d = new Date(this.dateSearch);
      if (!Number.isNaN(d.getTime())) this.goToDate(d);
    }
  }

  setSort(opt: { value: SortField; dir: SortDir; label: string }): void {
    if (!opt) return;
    this.sortField = opt.value;
    this.sortDir = opt.dir;
    this.selectedSortOption = opt;
  }

  setFilterBy(value: string): void {
    this.filterBy = value as any;
    this.applyViewFilters();
  }

  setLoadStatusFilter(value: string): void {
    this.loadStatusFilter = value;
    this.loadData();
  }

  setDriverFilter(id: string | null): void {
    this.driverFilterId = id;
  }

  openFilterModal(filter?: CustomFilter): void {
    this.editingFilter = filter || null;
    this.filterName = filter?.name || '';
    this.filterSelectedIds = new Set(filter?.driverIds || []);
    this.filterDriverSearch = '';
    this.driverFilterOpen = false;
    this.showFilterModal = true;
  }

  closeFilterModal(): void {
    this.showFilterModal = false;
    this.editingFilter = null;
  }

  saveFilter(): void {
    const name = this.filterName.trim();
    if (!name) return;
    const driverIds = Array.from(this.filterSelectedIds);
    const id = this.editingFilter?.id || `f_${Date.now()}`;
    const existing = this.customFilters.findIndex(f => f.id === id);
    const entry: CustomFilter = { id, name, driverIds };
    if (existing >= 0) this.customFilters[existing] = entry;
    else this.customFilters.push(entry);
    this.saveCustomFilters();
    this.driverFilterId = id;
    this.closeFilterModal();
  }

  removeFilter(): void {
    if (!this.editingFilter) return;
    this.customFilters = this.customFilters.filter(f => f.id !== this.editingFilter!.id);
    this.saveCustomFilters();
    if (this.driverFilterId === this.editingFilter.id) this.driverFilterId = 'all';
    this.closeFilterModal();
  }

  toggleFilterDriver(driverId: string): void {
    if (this.filterSelectedIds.has(driverId)) this.filterSelectedIds.delete(driverId);
    else this.filterSelectedIds.add(driverId);
    this.filterSelectedIds = new Set(this.filterSelectedIds);
  }

  setDriverSelected(driverId: string, event: Event): void {
    const checked = (event?.target as HTMLInputElement)?.checked ?? false;
    if (checked) this.filterSelectedIds.add(driverId);
    else this.filterSelectedIds.delete(driverId);
    this.filterSelectedIds = new Set(this.filterSelectedIds);
    this.cdr.markForCheck();
  }

  toggleDriverSelection(driverId: string): void {
    if (this.filterSelectedIds.has(driverId)) this.filterSelectedIds.delete(driverId);
    else this.filterSelectedIds.add(driverId);
    this.filterSelectedIds = new Set(this.filterSelectedIds);
    this.cdr.markForCheck();
  }

  get filterModalDrivers(): { id: string; name: string; type: string }[] {
    const list = (this.drivers || []).filter(d => d.type === 'driver' && d.id) as { id: string; name: string; unitNumber?: string }[];
    const q = (this.filterDriverSearch || '').toLowerCase();
    let out = list.map(d => ({ id: d.id!, name: d.name, type: 'driver' }));
    if (q) out = out.filter(d => d.name.toLowerCase().includes(q));
    return out;
  }

  applyViewFilters(): void {
    // Filter by today/tomorrow/ready/unassigned affects which drivers/loads show
    this.loadData();
  }

  loadData(): void {
    this.loading = true;
    const start = new Date(this.weekStart);
    const end = new Date(this.weekStart);
    end.setDate(end.getDate() + 6);
    const dateFrom = this.toDateOnly(start);
    const dateTo = this.toDateOnly(end);

    const loadFilters: any = {
      dateFrom,
      dateTo,
      pageSize: 500
    };
    if (this.loadStatusFilter) loadFilters.status = this.loadStatusFilter;

    this.apiService.getDispatchDrivers().subscribe({
      next: (driverData: any) => {
        const arr = Array.isArray(driverData) ? driverData : (driverData?.data || driverData?.rows || []);
        this.drivers = arr.map((d: any) => ({
          id: d.id,
          name: `${d.first_name || d.firstName || ''} ${d.last_name || d.lastName || ''}`.trim() || 'Unknown',
          unitNumber: d.unit_number || d.unitNumber || d.truck_unit_number || d.truck_unit,
          phone: d.phone,
          type: 'driver' as const
        }));
        this.drivers.push({ id: null, name: 'Unassigned Loads', type: 'unassigned' });
        this.loadsService.listLoads(loadFilters).subscribe({
          next: (res) => {
            const allLoads = (res?.data || []) as (LoadListItem & { driver_id?: string; driverId?: string; driver_name?: string })[];
            const getAssignedDriverId = (l: any) =>
              (l.driver_id && String(l.driver_id).trim()) ||
              (l.driverId && String(l.driverId).trim()) ||
              this.resolveDriverIdByName(l.driver_name);
            this.loads = allLoads.filter(l => !!getAssignedDriverId(l));
            this.unassignedLoads = allLoads.filter(l => !getAssignedDriverId(l));
            this.loading = false;
          },
          error: () => {
            this.loading = false;
            this.loads = [];
            this.unassignedLoads = [];
          }
        });
      },
      error: () => {
        this.loading = false;
        this.drivers = [{ id: null, name: 'Unassigned Loads', type: 'unassigned' }];
        this.loads = [];
        this.unassignedLoads = [];
      }
    });
  }

  private resolveDriverIdByName(driverName: string | null | undefined): string | null {
    const name = (driverName ?? '').toString().trim();
    if (!name) return null;
    const d = this.drivers.find(x => x.type === 'driver' && x.id && x.name.toLowerCase() === name.toLowerCase());
    return d?.id ?? null;
  }

  goToLoad(load: LoadListItem): void {
    this.router.navigate(['/loads'], { queryParams: { loadId: load.id } });
  }

  newLoad(): void {
    this.router.navigate(['/loads'], { queryParams: { create: '1' } });
  }
}
