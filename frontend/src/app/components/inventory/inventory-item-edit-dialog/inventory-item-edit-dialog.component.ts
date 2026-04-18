import {
  Component, Input, Output, EventEmitter,
  OnChanges, SimpleChanges,
  ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { ApiService } from '../../../services/api.service';

/** Minimal editable fields for an inventory item. */
interface InventoryEditForm {
  bin_id: string | null;
  reorder_level: number | null;
}

/**
 * FN-705 — Inline edit dialog for an inventory item.
 *
 * Replaces the free-text bin_location input with <app-bin-picker> bound to bin_id.
 * bin_location is kept as a read-only display until the backend deprecates the field.
 *
 * Usage:
 *   <app-inventory-item-edit-dialog
 *     [item]="editingItem"
 *     [isOpen]="showEditDialog"
 *     (saved)="onItemSaved($event)"
 *     (close)="showEditDialog = false"
 *   ></app-inventory-item-edit-dialog>
 */
@Component({
  selector: 'app-inventory-item-edit-dialog',
  templateUrl: './inventory-item-edit-dialog.component.html',
  styleUrls: ['./inventory-item-edit-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InventoryItemEditDialogComponent implements OnChanges {

  // ── Inputs ────────────────────────────────────────────────────────────────

  /** The inventory item to edit. Pass null to keep dialog closed. */
  @Input() item: any = null;

  /** Controls visibility. */
  @Input() isOpen = false;

  // ── Outputs ───────────────────────────────────────────────────────────────

  /** Emits the updated inventory item after a successful save. */
  @Output() saved = new EventEmitter<any>();

  /** Emits when the dialog should close without saving. */
  @Output() close = new EventEmitter<void>();

  // ── State ─────────────────────────────────────────────────────────────────

  form: InventoryEditForm = { bin_id: null, reorder_level: null };

  saving = false;
  saveError = '';

  constructor(
    private api: ApiService,
    private cdr: ChangeDetectorRef
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.item) {
      this.resetForm();
    }
  }

  // ── Derived helpers ───────────────────────────────────────────────────────

  /** Location that should be passed to the bin picker. */
  get locationId(): string {
    return this.item?.location_id ?? '';
  }

  /**
   * Legacy text value: shown read-only when the item has a bin_location string
   * but no bin_id. Lets the user see the old value and replace it with a proper bin.
   */
  get legacyBinLocation(): string | null {
    return this.item?.bin_location ?? null;
  }

  /** True when legacy text exists and no new bin_id has been picked. */
  get showLegacyNote(): boolean {
    return !!this.legacyBinLocation && !this.form.bin_id;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  onSave(): void {
    if (!this.item?.id || this.saving) return;

    this.saving    = true;
    this.saveError = '';
    this.cdr.markForCheck();

    const payload: Record<string, unknown> = {
      bin_id: this.form.bin_id || null,
      reorder_level: this.form.reorder_level !== null ? Number(this.form.reorder_level) : null,
    };

    // Clear legacy text when a real bin is selected
    if (this.form.bin_id) {
      payload['bin_location'] = null;
    }

    this.api.updateInventoryItem(this.item.id, payload).subscribe({
      next: (res: any) => {
        const updated = res?.data ?? { ...this.item, ...payload };
        this.saving = false;
        this.saved.emit(updated);
        this.close.emit();
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.saveError = err?.error?.error ?? 'Failed to save changes.';
        this.saving    = false;
        this.cdr.markForCheck();
      }
    });
  }

  onClose(): void {
    if (!this.saving) {
      this.close.emit();
    }
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('iied-backdrop')) {
      this.onClose();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private resetForm(): void {
    this.form = {
      bin_id:        this.item?.bin_id       ?? null,
      reorder_level: this.item?.reorder_level ?? null,
    };
    this.saveError = '';
    this.saving    = false;
  }
}
