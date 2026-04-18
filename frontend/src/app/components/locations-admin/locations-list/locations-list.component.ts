import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { ApiService } from '../../../services/api.service';
import { Location, LocationListItem, LocationListResponse, LocationType } from '../../../models/location.model';
import { DialogTab } from '../location-edit-dialog/location-edit-dialog.component';

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

  // ── Edit dialog ────────────────────────────────────────────────────────────
  showEditDialog = false;
  editingLocation: Location | null = null;
  editDialogInitialTab: DialogTab = 'details';

  // ── Delete dialog ──────────────────────────────────────────────────────────
  showDeleteDialog = false;
  deletingLocation: LocationListItem | null = null;

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

  // ── Add / Edit / Manage ───────────────────────────────────────────────────

  /** Open dialog in "Add" mode (no location pre-loaded). */
  onAddLocation(): void {
    this.editingLocation = null;
    this.editDialogInitialTab = 'details';
    this.showEditDialog = true;
    this.cdr.markForCheck();
  }

  /** Fetch full location then open in "Edit" mode on the Details tab. */
  onEditLocation(loc: LocationListItem): void {
    this.actionLoadingId = loc.id;
    this.cdr.markForCheck();
    this.api.getLocationById(loc.id).subscribe({
      next: (res: any) => {
        this.editingLocation = res?.data ?? res;
        this.editDialogInitialTab = 'details';
        this.showEditDialog = true;
        this.actionLoadingId = null;
        this.cdr.markForCheck();
      },
      error: () => {
        this.actionLoadingId = null;
        this.cdr.markForCheck();
      }
    });
  }

  /** Open edit dialog pre-navigated to the Bins tab. */
  onManageBins(loc: LocationListItem): void {
    this.editingLocation = loc as unknown as Location;
    this.editDialogInitialTab = 'bins';
    this.showEditDialog = true;
    this.cdr.markForCheck();
  }

  /** Open edit dialog pre-navigated to the Users tab. */
  onManageUsers(loc: LocationListItem): void {
    this.editingLocation = loc as unknown as Location;
    this.editDialogInitialTab = 'users';
    this.showEditDialog = true;
    this.cdr.markForCheck();
  }

  // ── Edit dialog events ─────────────────────────────────────────────────────

  onEditDialogSaved(): void {
    this.showEditDialog = false;
    this.editingLocation = null;
    this.loadLocations();
  }

  onEditDialogClose(): void {
    this.showEditDialog = false;
    this.editingLocation = null;
    this.cdr.markForCheck();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  onDeleteLocation(loc: LocationListItem): void {
    this.deletingLocation = loc;
    this.showDeleteDialog = true;
    this.cdr.markForCheck();
  }

  onDeleteDialogClose(): void {
    this.showDeleteDialog = false;
    this.deletingLocation = null;
    this.cdr.markForCheck();
  }

  onLocationDeleted(id: string): void {
    this.locations = this.locations.filter(l => l.id !== id);
    this.total = Math.max(0, this.total - 1);
    this.showDeleteDialog = false;
    this.deletingLocation = null;
    this.cdr.markForCheck();
  }

  onLocationMarkedInactive(id: string): void {
    this.locations = this.locations.map(l =>
      l.id === id ? { ...l, active: false } : l
    );
    this.showDeleteDialog = false;
    this.deletingLocation = null;
    this.cdr.markForCheck();
  }

  // ── Display helpers ────────────────────────────────────────────────────────

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
