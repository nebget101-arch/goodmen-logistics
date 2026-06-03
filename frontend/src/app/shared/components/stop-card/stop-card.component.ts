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

  /**
   * FN-1075 — When true, parent is performing a ZIP→city/state lookup for this row.
   * Drives the inline "looking up…" indicator next to the ZIP input.
   */
  @Input() loadingZip = false;

  // ── Outputs ─────────────────────────────────────────────────────────────────

  /** Emits the updated stop whenever any field changes. */
  @Output() stopChange = new EventEmitter<LoadStop>();

  /** Requests the parent to duplicate this stop. */
  @Output() duplicate = new EventEmitter<void>();

  /** Requests the parent to delete this stop. */
  @Output() deleteStop = new EventEmitter<void>();

  /** Requests the parent to toggle expand/collapse on this card. */
  @Output() toggle = new EventEmitter<void>();

  /** FN-1075 — Emits the trimmed ZIP value when the ZIP input blurs. */
  @Output() zipBlur = new EventEmitter<string>();

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

  private static readonly STATE_NAME_TO_CODE: Readonly<Record<string, string>> = {
    ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
    COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
    HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
    KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
    MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS',
    MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
    'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
    'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK',
    OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
    VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI',
    WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC'
  };

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
    const stateCode = this.normalizeStateCode(this.stop.state);
    if (stateCode) parts.push(stateCode);
    else if (this.stop.state) parts.push(this.stop.state);
    return parts.length > 0 ? parts.join(', ') : 'No location';
  }

  /** Normalized 2-letter code for the dropdown binding; empty string when unrecognized. */
  get normalizedState(): string {
    return this.normalizeStateCode(this.stop.state);
  }

  /**
   * Normalize a free-form state input to a 2-letter uppercase code.
   * Accepts existing codes ("CA", "ca", "Ca."), full names ("California"), and
   * "District of Columbia". Returns '' when the input doesn't match a known state.
   */
  normalizeStateCode(input: string | null | undefined): string {
    if (input == null) return '';
    const cleaned = String(input)
      .trim()
      .replace(/[.,]+$/g, '')
      .replace(/\s+/g, ' ')
      .toUpperCase();
    if (!cleaned) return '';
    if (cleaned.length === 2 && this.stateList.includes(cleaned)) return cleaned;
    return StopCardComponent.STATE_NAME_TO_CODE[cleaned] ?? '';
  }

  get dateLabel(): string {
    const ymd = this.toYmd(this.stop.stop_date);
    return ymd || '--';
  }

  /**
   * FN-1052 — Normalize a stop_date value to a `YYYY-MM-DD` calendar string.
   *
   * The pg driver returns DATE columns as JS Date, which `JSON.stringify`
   * serializes to a UTC ISO timestamp ("2026-04-15T00:00:00.000Z"). Slicing
   * the first 10 chars preserves the calendar date the user entered without
   * any timezone offset math.
   */
  toYmd(value: Date | string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'string') {
      return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
    }
    if (value instanceof Date && !isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    return '';
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

  onStateChange(value: string): void {
    const normalized = this.normalizeStateCode(value);
    const updated: LoadStop = { ...this.stop, state: normalized || null };
    this.stopChange.emit(updated);
  }

  /**
   * FN-1075 — Emit the trimmed ZIP up to the parent so it can call
   * `LoadsService.lookupZip` and patch empty city/state. Mirrors
   * `load-wizard/steps/stops/stops.component.ts:onZipBlur` without importing it.
   */
  onZipBlur(): void {
    this.zipBlur.emit((this.stop.zip || '').trim());
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
