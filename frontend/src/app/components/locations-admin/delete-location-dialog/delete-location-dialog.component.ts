import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';
import { LocationListItem, LocationDependencies } from '../../../models/location.model';
import { ApiService } from '../../../services/api.service';

/**
 * FN-702 — Delete Location Dialog
 *
 * Three-phase flow:
 *  1. confirm  — user sees the location name and clicks "Delete"
 *  2. has_deps — DELETE returned 409; shows dependency counts + "Mark Inactive" / "Cancel"
 *  3. done     — success (hard-deleted or marked inactive); parent should refresh list
 *
 * Error state surfaces inside the relevant phase rather than replacing it.
 */
type DialogPhase = 'confirm' | 'has_deps' | 'done';

@Component({
  selector: 'app-delete-location-dialog',
  templateUrl: './delete-location-dialog.component.html',
  styleUrls: ['./delete-location-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DeleteLocationDialogComponent implements OnChanges {
  /** The location the user wants to delete. Set to null to close. */
  @Input() location: LocationListItem | null = null;
  @Input() isOpen = false;

  /** Emitted after hard-delete succeeds. */
  @Output() deleted = new EventEmitter<string>();
  /** Emitted after soft-delete (mark inactive) succeeds. */
  @Output() markedInactive = new EventEmitter<string>();
  /** Emitted when the user cancels. */
  @Output() close = new EventEmitter<void>();

  // ── State ─────────────────────────────────────────────────────────────────
  phase: DialogPhase = 'confirm';
  inFlight = false;
  errorMsg = '';
  dependencies: LocationDependencies | null = null;

  /** Total blocking dependency count for quick conditional in template. */
  get totalDeps(): number {
    if (!this.dependencies) return 0;
    return (
      this.dependencies.work_orders +
      this.dependencies.inventory_items +
      this.dependencies.users +
      this.dependencies.vehicles
    );
  }

  /** True only while in the 'done' phase after a hard delete (so we know which copy to show). */
  wasHardDeleted = false;

  constructor(private api: ApiService, private cdr: ChangeDetectorRef) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.phase = 'confirm';
      this.inFlight = false;
      this.errorMsg = '';
      this.dependencies = null;
      this.wasHardDeleted = false;
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Phase 1 → attempt hard delete.
   * - 200 OK         → hard-deleted; move to 'done', emit deleted()
   * - 409 Conflict   → pivot to 'has_deps' with dependency counts
   * - 404            → already gone; treat as success
   * - Other errors   → surface error message within confirm phase
   */
  async onConfirmDelete(): Promise<void> {
    if (!this.location) return;
    this.inFlight = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    try {
      await this.api.deleteLocation(this.location.id).toPromise();
      // 200 → hard-deleted
      this.wasHardDeleted = true;
      this.phase = 'done';
      this.deleted.emit(this.location.id);
    } catch (err: any) {
      const status: number = err?.status ?? 0;

      if (status === 409) {
        // Has dependencies — pivot to the soft-delete offer
        this.dependencies = err?.error?.dependencies ?? null;
        this.phase = 'has_deps';
      } else if (status === 404) {
        // Already gone — treat as success
        this.wasHardDeleted = true;
        this.phase = 'done';
        this.deleted.emit(this.location.id);
      } else {
        this.errorMsg = err?.error?.message || 'Failed to delete location. Please try again.';
      }
    } finally {
      this.inFlight = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Phase 2 → mark the location inactive (soft delete).
   * Calls PATCH /:id with { active: false }.
   */
  async onMarkInactive(): Promise<void> {
    if (!this.location) return;
    this.inFlight = true;
    this.errorMsg = '';
    this.cdr.markForCheck();

    try {
      await this.api.updateLocation(this.location.id, { active: false }).toPromise();
      this.wasHardDeleted = false;
      this.phase = 'done';
      this.markedInactive.emit(this.location.id);
    } catch (err: any) {
      this.errorMsg = err?.error?.message || 'Failed to mark location as inactive.';
    } finally {
      this.inFlight = false;
      this.cdr.markForCheck();
    }
  }

  onClose(): void {
    this.close.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('dld-backdrop')) {
      this.onClose();
    }
  }

  // ── Dependency table config ───────────────────────────────────────────────

  readonly depKeys: (keyof LocationDependencies)[] = [
    'work_orders', 'inventory_items', 'users', 'vehicles'
  ];

  readonly depNames: Record<keyof LocationDependencies, string> = {
    work_orders:     'Work Orders',
    inventory_items: 'Inventory Items',
    users:           'Assigned Users',
    vehicles:        'Vehicles',
  };

  readonly depIcons: Record<keyof LocationDependencies, string> = {
    work_orders:     'build',
    inventory_items: 'inventory_2',
    users:           'group',
    vehicles:        'local_shipping',
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Returns true if a dependency counter is > 0. */
  hasDep(key: keyof LocationDependencies): boolean {
    return (this.dependencies?.[key] ?? 0) > 0;
  }

  /** Format city + state into a single display string. */
  cityState(location: LocationListItem): string {
    return [location.city, location.state].filter(Boolean).join(', ');
  }
}
