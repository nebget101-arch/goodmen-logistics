import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { ApiService } from '../../../services/api.service';
import { LocationListItem, LocationListResponse, LocationType } from '../../../models/location.model';

@Component({
  selector: 'app-locations-list',
  templateUrl: './locations-list.component.html',
  styleUrls: ['./locations-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LocationsListComponent implements OnInit {

  searchQuery = '';
  selectedType: LocationType | '' = '';
  selectedActive: 'all' | 'active' | 'inactive' = 'active';

  page = 1;
  pageSize = 25;
  total = 0;

  sortBy = 'name';
  sortDir: 'asc' | 'desc' = 'asc';

  locations: LocationListItem[] = [];
  loading = false;
  error = '';
  actionLoadingId: string | null = null;

  readonly typeOptions: Array<{ value: LocationType; label: string }> = [
    { value: 'SHOP',      label: 'Shop' },
    { value: 'YARD',      label: 'Yard' },
    { value: 'DROP_YARD', label: 'Drop Yard' },
    { value: 'WAREHOUSE', label: 'Warehouse' },
    { value: 'OFFICE',    label: 'Office' },
    { value: 'TERMINAL',  label: 'Terminal' },
  ];

  constructor(
    private api: ApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadLocations();
  }

  loadLocations(): void {
    this.error = '';
    this.loading = true;
    this.cdr.markForCheck();

    const activeParam: boolean | undefined =
      this.selectedActive === 'active'   ? true  :
      this.selectedActive === 'inactive' ? false :
      undefined;

    this.api.listLocations({
      type:     this.selectedType || undefined,
      active:   activeParam,
      search:   this.searchQuery.trim() || undefined,
      page:     this.page,
      pageSize: this.pageSize,
    }).subscribe({
      next: (res: LocationListResponse) => {
        this.locations = Array.isArray(res?.data) ? res.data : [];
        this.total = res?.meta?.total ?? 0;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Failed to load locations.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onSearch(): void {
    this.page = 1;
    this.loadLocations();
  }

  onFilter(): void {
    this.page = 1;
    this.loadLocations();
  }

  onSort(col: string): void {
    if (this.sortBy === col) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = col;
      this.sortDir = 'asc';
    }
    this.page = 1;
    this.loadLocations();
  }

  onPageChange(p: number): void {
    if (p < 1 || p > this.totalPages) { return; }
    this.page = p;
    this.loadLocations();
  }

  onEditLocation(loc: LocationListItem): void {
    console.log('[LocationsAdmin] Edit location stub:', loc.id, loc.name);
  }

  onManageLocation(loc: LocationListItem): void {
    console.log('[LocationsAdmin] Manage location stub:', loc.id, loc.name);
  }

  getTypeLabel(type: LocationType | null): string {
    if (!type) { return '—'; }
    const found = this.typeOptions.find(o => o.value === type);
    return found ? found.label : type;
  }

  getTypeBadgeClass(type: LocationType | null): string {
    switch (type) {
      case 'SHOP':      return 'type-badge type-shop';
      case 'YARD':      return 'type-badge type-yard';
      case 'DROP_YARD': return 'type-badge type-drop-yard';
      case 'WAREHOUSE': return 'type-badge type-warehouse';
      case 'OFFICE':    return 'type-badge type-office';
      case 'TERMINAL':  return 'type-badge type-terminal';
      default:          return 'type-badge type-unknown';
    }
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  sortIcon(col: string): string {
    if (this.sortBy !== col) { return 'unfold_more'; }
    return this.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }
}
