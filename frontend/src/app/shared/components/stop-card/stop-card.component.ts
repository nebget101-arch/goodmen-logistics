import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core';
import { LoadStop, LoadStopType } from '../../../models/load-dashboard.model';

/**
 * FN-734 -- Reusable stop card for the Load Wizard.
 *
 * Collapsed: sequence #, stop-type badge, city/state, date, expand arrow, drag handle.
 * Expanded:  inline edit form for all stop fields.
 *
 * Usage:
 *   <app-stop-card
 *     [stop]="stop"
 *     [index]="i"
 *     [expanded]="i === expandedIndex"
 *     (stopChange)="onStopChange($event, i)"
 *     (duplicate)="onDuplicate(i)"
 *     (delete)="onDelete(i)"
 *     (toggle)="onToggle(i)">
 *   </app-stop-card>
 */
@Component({
  selector: 'app-stop-card',
  templateUrl: './stop-card.component.html',
  styleUrls: ['./stop-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StopCardComponent {

  // ── Inputs ──────────────────────────────────────────────────────────────────

  /** The stop data object. */
  @Input() stop: LoadStop = { stop_type: 'PICKUP' };

  /** Zero-based index in the stop list (used for display as 1-based sequence). */
  @Input() index = 0;

  /** Whether this card is in expanded (edit) mode. */
  @Input() expanded = false;

  /** When true the delete button is hidden (minimum stop constraint). */
  @Input() disableDelete = false;

  // ── Outputs ─────────────────────────────────────────────────────────────────

  /** Emits the updated stop whenever any field changes. */
  @Output() stopChange = new EventEmitter<LoadStop>();

  /** Requests the parent to duplicate this stop. */
  @Output() duplicate = new EventEmitter<void>();

  /** Requests the parent to delete this stop. */
  @Output() deleteStop = new EventEmitter<void>();

  /** Requests the parent to toggle expand/collapse on this card. */
  @Output() toggle = new EventEmitter<void>();

  // ── Static options ──────────────────────────────────────────────────────────

  readonly stopTypeOptions: Array<{ value: LoadStopType; label: string }> = [
    { value: 'PICKUP', label: 'Pickup' },
    { value: 'DELIVERY', label: 'Delivery' }
  ];

  readonly stateList: string[] = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
    'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
    'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
    'WI','WY','DC'
  ];

  /** Confirm-delete flag. */
  showDeleteConfirm = false;

  constructor(private cdr: ChangeDetectorRef) {}

  // ── Display helpers ─────────────────────────────────────────────────────────

  get sequenceLabel(): number {
    return (this.stop.sequence ?? this.index) + 1;
  }

  get cityStateLabel(): string {
    const parts: string[] = [];
    if (this.stop.city) parts.push(this.stop.city);
    if (this.stop.state) parts.push(this.stop.state);
    return parts.length > 0 ? parts.join(', ') : 'No location';
  }

  get dateLabel(): string {
    if (!this.stop.stop_date) return '--';
    return this.stop.stop_date;
  }

  // ── Field change handlers ───────────────────────────────────────────────────

  onFieldChange(field: keyof LoadStop, value: string | number | null): void {
    const updated: LoadStop = { ...this.stop, [field]: value || null };
    this.stopChange.emit(updated);
  }

  onStopTypeChange(value: string): void {
    const updated: LoadStop = { ...this.stop, stop_type: value as LoadStopType };
    this.stopChange.emit(updated);
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  onToggle(): void {
    this.showDeleteConfirm = false;
    this.toggle.emit();
  }

  onDuplicate(): void {
    this.duplicate.emit();
  }

  onDeleteClick(): void {
    this.showDeleteConfirm = true;
    this.cdr.markForCheck();
  }

  onDeleteConfirm(): void {
    this.showDeleteConfirm = false;
    this.deleteStop.emit();
  }

  onDeleteCancel(): void {
    this.showDeleteConfirm = false;
    this.cdr.markForCheck();
  }
}
