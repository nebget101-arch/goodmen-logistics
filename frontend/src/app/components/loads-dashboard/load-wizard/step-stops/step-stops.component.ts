import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { LoadStop, LoadStopType } from '../../../../models/load-dashboard.model';

/** Trip metrics computed from the stop list. */
export interface TripMetrics {
  totalMiles: number | null;
  emptyMiles: number | null;
  loadedMiles: number | null;
  ratePerMile: number | null;
}

/**
 * FN-734 -- Step 2 (Stops) of the Load Wizard.
 *
 * Manages an ordered list of LoadStop objects with drag-drop reordering,
 * add / duplicate / delete actions, and trip metrics computation.
 *
 * Usage:
 *   <app-step-stops
 *     [stops]="wizardStops"
 *     [rate]="wizardRate"
 *     [totalMiles]="wizardTotalMiles"
 *     [emptyMiles]="wizardEmptyMiles"
 *     [loadedMiles]="wizardLoadedMiles"
 *     (stopsChange)="onStopsChange($event)"
 *     (validChange)="onStopsValid($event)">
 *   </app-step-stops>
 */
@Component({
  selector: 'app-step-stops',
  templateUrl: './step-stops.component.html',
  styleUrls: ['./step-stops.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StepStopsComponent {

  // ── Inputs ──────────────────────────────────────────────────────────────────

  /** The list of stops managed by this step. */
  @Input()
  set stops(value: LoadStop[]) {
    this._stops = value && value.length > 0 ? [...value] : this.defaultStops();
    this.renumberSequences();
    this.recalcMetrics();
    this.emitValidity();
  }
  get stops(): LoadStop[] { return this._stops; }

  /** Rate for the load (used to compute rate/mile). */
  @Input() rate: number | null = null;

  /** Total miles (optionally provided externally). */
  @Input() totalMiles: number | null = null;

  /** Empty miles (optionally provided externally). */
  @Input() emptyMiles: number | null = null;

  /** Loaded miles (optionally provided externally). */
  @Input() loadedMiles: number | null = null;

  // ── Outputs ─────────────────────────────────────────────────────────────────

  /** Emits the updated stop list on every change. */
  @Output() stopsChange = new EventEmitter<LoadStop[]>();

  /** Emits true when the minimum stop constraint is satisfied. */
  @Output() validChange = new EventEmitter<boolean>();

  // ── Component state ─────────────────────────────────────────────────────────

  private _stops: LoadStop[] = [];
  expandedIndex: number | null = null;
  metrics: TripMetrics = { totalMiles: null, emptyMiles: null, loadedMiles: null, ratePerMile: null };
  validationMessage = '';

  constructor(private cdr: ChangeDetectorRef) {}

  // ── Validation ──────────────────────────────────────────────────────────────

  get isValid(): boolean {
    const hasPickup = this._stops.some(s => s.stop_type === 'PICKUP');
    const hasDelivery = this._stops.some(s => s.stop_type === 'DELIVERY');
    return hasPickup && hasDelivery;
  }

  /** Returns true if the given stop cannot be deleted (last of its type). */
  isDeleteDisabled(stop: LoadStop): boolean {
    const sameType = this._stops.filter(s => s.stop_type === stop.stop_type);
    return sameType.length <= 1;
  }

  // ── Drag & Drop ─────────────────────────────────────────────────────────────

  onDrop(event: CdkDragDrop<LoadStop[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this._stops, event.previousIndex, event.currentIndex);
    this.renumberSequences();
    this.emitStops();
    // Collapse any expanded card during reorder
    this.expandedIndex = null;
    this.cdr.markForCheck();
  }

  // ── Stop CRUD ───────────────────────────────────────────────────────────────

  addStop(): void {
    const newStop: LoadStop = {
      stop_type: 'DELIVERY',
      sequence: this._stops.length,
      city: null,
      state: null,
      zip: null,
      stop_date: null,
      stop_time: null,
      facility_name: null,
      notes: null
    };
    this._stops = [...this._stops, newStop];
    this.renumberSequences();
    this.expandedIndex = this._stops.length - 1;
    this.emitStops();
    this.cdr.markForCheck();
  }

  onStopChange(updated: LoadStop, index: number): void {
    this._stops = this._stops.map((s, i) => i === index ? { ...updated, sequence: i } : s);
    this.emitStops();
    this.cdr.markForCheck();
  }

  onDuplicate(index: number): void {
    const source = this._stops[index];
    const duplicate: LoadStop = {
      ...source,
      id: undefined,
      load_id: undefined,
      stop_date: null,
      stop_time: null,
      notes: null
    };
    // Insert duplicate right after the source
    const updated = [...this._stops];
    updated.splice(index + 1, 0, duplicate);
    this._stops = updated;
    this.renumberSequences();
    this.expandedIndex = index + 1;
    this.emitStops();
    this.cdr.markForCheck();
  }

  onDelete(index: number): void {
    const stop = this._stops[index];
    // Safety check: do not delete if it is the last of its type
    if (this.isDeleteDisabled(stop)) return;

    this._stops = this._stops.filter((_, i) => i !== index);
    this.renumberSequences();
    if (this.expandedIndex === index) {
      this.expandedIndex = null;
    } else if (this.expandedIndex !== null && this.expandedIndex > index) {
      this.expandedIndex--;
    }
    this.emitStops();
    this.cdr.markForCheck();
  }

  onToggle(index: number): void {
    this.expandedIndex = this.expandedIndex === index ? null : index;
    this.cdr.markForCheck();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  trackByIndex(index: number): number {
    return index;
  }

  private renumberSequences(): void {
    this._stops.forEach((s, i) => { s.sequence = i; });
  }

  private recalcMetrics(): void {
    const total = this.totalMiles;
    const empty = this.emptyMiles;
    const loaded = this.loadedMiles ?? (total != null && empty != null ? total - empty : null);
    const rpm = this.rate != null && total != null && total > 0
      ? Math.round((this.rate / total) * 100) / 100
      : null;

    this.metrics = {
      totalMiles: total,
      emptyMiles: empty,
      loadedMiles: loaded,
      ratePerMile: rpm
    };
  }

  private emitStops(): void {
    this.recalcMetrics();
    this.emitValidity();
    this.stopsChange.emit([...this._stops]);
  }

  private emitValidity(): void {
    const valid = this.isValid;
    this.validationMessage = valid ? '' : 'At least 1 pickup and 1 delivery stop are required.';
    this.validChange.emit(valid);
  }

  private defaultStops(): LoadStop[] {
    return [
      {
        stop_type: 'PICKUP' as LoadStopType,
        sequence: 0,
        city: null, state: null, zip: null,
        stop_date: null, stop_time: null,
        facility_name: null, notes: null
      },
      {
        stop_type: 'DELIVERY' as LoadStopType,
        sequence: 1,
        city: null, state: null, zip: null,
        stop_date: null, stop_time: null,
        facility_name: null, notes: null
      }
    ];
  }
}
