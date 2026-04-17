import {
  Component, Input, OnInit, OnChanges, SimpleChanges,
  ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { ApiService } from '../../../services/api.service';
import { LocationBin, BinType, BinFormValue, BulkBinPayload } from '../../../models/location.model';

interface BinForm {
  bin_code: string;
  bin_name: string;
  bin_type: BinType | '';
  zone: string;
  aisle: string;
  shelf: string;
  position: string;
  capacity_notes: string;
  active: boolean;
}

@Component({
  selector: 'app-bins-tab',
  templateUrl: './bins-tab.component.html',
  styleUrls: ['./bins-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BinsTabComponent implements OnInit, OnChanges {

  @Input() locationId = '';
  @Input() locationType = '';

  bins: LocationBin[] = [];
  filteredBins: LocationBin[] = [];
  searchQuery = '';
  loading = false;
  error = '';

  // Dialog state
  showAddDialog = false;
  showEditDialog = false;
  showBulkDialog = false;
  showDeleteConfirm = false;

  // Form state
  binForm: BinForm = this.emptyForm();
  editingBin: LocationBin | null = null;
  deletingBin: LocationBin | null = null;
  saving = false;

  // Bulk create state
  bulkMode: 'range' | 'zone' = 'range';
  bulkPattern = '';
  bulkZone = '';
  bulkRows = '';
  bulkBinType: BinType | '' = '';
  bulkPreview: string[] = [];
  bulkSaving = false;

  readonly binTypeOptions: Array<{ value: BinType; label: string }> = [
    { value: 'SHELF',    label: 'Shelf' },
    { value: 'RACK',     label: 'Rack' },
    { value: 'FLOOR',    label: 'Floor' },
    { value: 'CABINET',  label: 'Cabinet' },
    { value: 'FREEZER',  label: 'Freezer' },
    { value: 'OUTDOOR',  label: 'Outdoor' },
  ];

  constructor(
    private api: ApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.locationId && this.isBinCapable) {
      this.loadBins();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['locationId'] && !changes['locationId'].firstChange) {
      if (this.locationId && this.isBinCapable) {
        this.loadBins();
      }
    }
  }

  get isBinCapable(): boolean {
    return this.locationType === 'SHOP' || this.locationType === 'WAREHOUSE';
  }

  // ─── Load ──────────────────────────────────────────────────────────────

  loadBins(): void {
    this.error = '';
    this.loading = true;
    this.cdr.markForCheck();

    this.api.getLocationBins(this.locationId).subscribe({
      next: (data: LocationBin[]) => {
        this.bins = Array.isArray(data) ? data : [];
        this.applyFilter();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err: { error?: { error?: string } }) => {
        this.error = err?.error?.error || 'Failed to load bins.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ─── Filter ────────────────────────────────────────────────────────────

  applyFilter(): void {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) {
      this.filteredBins = [...this.bins];
    } else {
      this.filteredBins = this.bins.filter(b =>
        b.bin_code.toLowerCase().includes(q) ||
        (b.bin_name && b.bin_name.toLowerCase().includes(q)) ||
        (b.zone && b.zone.toLowerCase().includes(q))
      );
    }
  }

  onSearch(): void {
    this.applyFilter();
    this.cdr.markForCheck();
  }

  // ─── Add ───────────────────────────────────────────────────────────────

  openAddDialog(): void {
    this.binForm = this.emptyForm();
    this.showAddDialog = true;
    this.error = '';
    this.cdr.markForCheck();
  }

  closeAddDialog(): void {
    this.showAddDialog = false;
    this.cdr.markForCheck();
  }

  saveNewBin(): void {
    if (!this.binForm.bin_code.trim()) { return; }

    this.saving = true;
    this.error = '';
    this.cdr.markForCheck();

    const payload: BinFormValue = {
      bin_code: this.binForm.bin_code.trim(),
      bin_name: this.binForm.bin_name.trim() || null,
      bin_type: (this.binForm.bin_type as BinType) || null,
      zone: this.binForm.zone.trim() || null,
      aisle: this.binForm.aisle.trim() || null,
      shelf: this.binForm.shelf.trim() || null,
      position: this.binForm.position.trim() || null,
      capacity_notes: this.binForm.capacity_notes.trim() || null,
    };

    this.api.createLocationBin(this.locationId, payload).subscribe({
      next: () => {
        this.saving = false;
        this.showAddDialog = false;
        this.loadBins();
      },
      error: (err: { error?: { error?: string } }) => {
        this.error = err?.error?.error || 'Failed to create bin.';
        this.saving = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ─── Edit ──────────────────────────────────────────────────────────────

  openEditDialog(bin: LocationBin): void {
    this.editingBin = bin;
    this.binForm = {
      bin_code: bin.bin_code,
      bin_name: bin.bin_name || '',
      bin_type: bin.bin_type || '',
      zone: bin.zone || '',
      aisle: bin.aisle || '',
      shelf: bin.shelf || '',
      position: bin.position || '',
      capacity_notes: bin.capacity_notes || '',
      active: bin.active,
    };
    this.showEditDialog = true;
    this.error = '';
    this.cdr.markForCheck();
  }

  closeEditDialog(): void {
    this.showEditDialog = false;
    this.editingBin = null;
    this.cdr.markForCheck();
  }

  saveEditBin(): void {
    if (!this.editingBin || !this.binForm.bin_code.trim()) { return; }

    this.saving = true;
    this.error = '';
    this.cdr.markForCheck();

    const updates: Partial<BinFormValue> = {
      bin_code: this.binForm.bin_code.trim(),
      bin_name: this.binForm.bin_name.trim() || null,
      bin_type: (this.binForm.bin_type as BinType) || null,
      zone: this.binForm.zone.trim() || null,
      aisle: this.binForm.aisle.trim() || null,
      shelf: this.binForm.shelf.trim() || null,
      position: this.binForm.position.trim() || null,
      capacity_notes: this.binForm.capacity_notes.trim() || null,
      active: this.binForm.active,
    };

    this.api.updateLocationBin(this.locationId, this.editingBin.id, updates).subscribe({
      next: () => {
        this.saving = false;
        this.showEditDialog = false;
        this.editingBin = null;
        this.loadBins();
      },
      error: (err: { error?: { error?: string } }) => {
        this.error = err?.error?.error || 'Failed to update bin.';
        this.saving = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ─── Delete ────────────────────────────────────────────────────────────

  openDeleteConfirm(bin: LocationBin): void {
    this.deletingBin = bin;
    this.showDeleteConfirm = true;
    this.cdr.markForCheck();
  }

  closeDeleteConfirm(): void {
    this.showDeleteConfirm = false;
    this.deletingBin = null;
    this.cdr.markForCheck();
  }

  confirmDelete(): void {
    if (!this.deletingBin) { return; }

    this.saving = true;
    this.error = '';
    this.cdr.markForCheck();

    this.api.deleteLocationBin(this.locationId, this.deletingBin.id).subscribe({
      next: () => {
        this.saving = false;
        this.showDeleteConfirm = false;
        this.deletingBin = null;
        this.loadBins();
      },
      error: (err: { error?: { error?: string } }) => {
        this.error = err?.error?.error || 'Failed to delete bin.';
        this.saving = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ─── Bulk Create ───────────────────────────────────────────────────────

  openBulkDialog(): void {
    this.bulkMode = 'range';
    this.bulkPattern = '';
    this.bulkZone = '';
    this.bulkRows = '';
    this.bulkBinType = '';
    this.bulkPreview = [];
    this.showBulkDialog = true;
    this.error = '';
    this.cdr.markForCheck();
  }

  closeBulkDialog(): void {
    this.showBulkDialog = false;
    this.cdr.markForCheck();
  }

  generatePreview(): void {
    if (this.bulkMode === 'range') {
      this.bulkPreview = this.parseRangePattern(this.bulkPattern.trim());
    } else {
      this.bulkPreview = this.parseZoneRows(
        this.bulkZone.trim(),
        this.bulkRows.trim()
      );
    }
    this.cdr.markForCheck();
  }

  confirmBulkCreate(): void {
    if (this.bulkPreview.length === 0) { return; }

    this.bulkSaving = true;
    this.error = '';
    this.cdr.markForCheck();

    const payload: BulkBinPayload = {
      bin_type: (this.bulkBinType as BinType) || null,
    };

    if (this.bulkMode === 'range') {
      payload.pattern = this.bulkPattern.trim();
    } else {
      payload.zone = this.bulkZone.trim();
      payload.rows = this.bulkRows.trim().split('\n').map(r => r.trim()).filter(Boolean);
    }

    this.api.bulkCreateBins(this.locationId, payload).subscribe({
      next: () => {
        this.bulkSaving = false;
        this.showBulkDialog = false;
        this.loadBins();
      },
      error: (err: { error?: { error?: string } }) => {
        this.error = err?.error?.error || 'Failed to bulk create bins.';
        this.bulkSaving = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  getTypeBadgeClass(type: BinType | null): string {
    if (!type) { return 'bin-type-badge bin-type-unknown'; }
    return `bin-type-badge bin-type-${type.toLowerCase()}`;
  }

  getTypeLabel(type: BinType | null): string {
    if (!type) { return '--'; }
    const found = this.binTypeOptions.find(o => o.value === type);
    return found ? found.label : type;
  }

  private emptyForm(): BinForm {
    return {
      bin_code: '',
      bin_name: '',
      bin_type: '',
      zone: '',
      aisle: '',
      shelf: '',
      position: '',
      capacity_notes: '',
      active: true,
    };
  }

  /**
   * Parse a range pattern like "A-1..A-20" into an array of bin codes.
   * Supports formats: "A-1..A-20", "SHELF-01..SHELF-10", "A1..A20"
   */
  private parseRangePattern(pattern: string): string[] {
    const match = pattern.match(/^(.+?)(\d+)\.\.(.+?)(\d+)$/);
    if (!match) { return []; }

    const [, prefixA, startStr, prefixB, endStr] = match;
    // Prefixes must match for a valid range
    if (prefixA !== prefixB) { return []; }

    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end) || start > end) { return []; }

    // Cap at 200 to prevent excessive generation
    const count = Math.min(end - start + 1, 200);
    const padLen = startStr.length;
    const codes: string[] = [];

    for (let i = start; i < start + count; i++) {
      codes.push(`${prefixA}${String(i).padStart(padLen, '0')}`);
    }

    return codes;
  }

  /**
   * Parse zone + rows into bin codes.
   * Each row becomes zone-row (e.g. zone "A", rows "1\n2\n3" => A-1, A-2, A-3)
   */
  private parseZoneRows(zone: string, rowsStr: string): string[] {
    if (!zone || !rowsStr) { return []; }

    const rows = rowsStr.split('\n').map(r => r.trim()).filter(Boolean);
    return rows.map(row => `${zone}-${row}`);
  }
}
