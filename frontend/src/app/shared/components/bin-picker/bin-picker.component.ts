import {
  Component, Input, Output, EventEmitter,
  OnInit, OnChanges, SimpleChanges,
  ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { ApiService } from '../../../services/api.service';
import { LocationBin, BinType, BinFormValue } from '../../../models/location.model';

/** Sentinel option value used to trigger inline bin creation. */
const CREATE_SENTINEL = '__create__';

/** Minimal form for the inline create dialog. */
interface BinCreateForm {
  bin_code: string;
  bin_name: string;
  bin_type: BinType | '';
  zone: string;
}

/**
 * FN-704 — Reusable bin picker for any location.
 *
 * Usage:
 *   <app-bin-picker
 *     [locationId]="item.location_id"
 *     [(value)]="item.bin_id"
 *     [allowCreate]="true"
 *     [fallbackToText]="true"
 *     (create)="onBinCreated($event)"
 *   ></app-bin-picker>
 */
@Component({
  selector: 'app-bin-picker',
  templateUrl: './bin-picker.component.html',
  styleUrls: ['./bin-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BinPickerComponent implements OnInit, OnChanges {

  // ── Inputs ────────────────────────────────────────────────────────────────

  /** The location whose bins should be fetched. */
  @Input() locationId = '';

  /** Currently selected bin_id. Supports two-way binding via [(value)]. */
  @Input() value: string | null = null;

  /** When true, a "+ Create new bin" option appears at the top of the list. */
  @Input() allowCreate = false;

  /**
   * When true (default), a plain text input is shown if the location has no
   * bins configured, with a note pointing to Admin → Locations.
   * When false, the empty dropdown is still rendered.
   */
  @Input() fallbackToText = true;

  /** Placeholder text shown when no bin is selected. */
  @Input() placeholder = 'Select a bin…';

  /** Label shown above the control. Leave blank to omit. */
  @Input() label = '';

  /** Disables the picker. */
  @Input() disabled = false;

  // ── Outputs ───────────────────────────────────────────────────────────────

  /** Emits the selected bin_id (or null when cleared). Two-way binding partner for [(value)]. */
  @Output() valueChange = new EventEmitter<string | null>();

  /**
   * Emits the newly created LocationBin after the inline create dialog
   * succeeds. The picker also auto-selects the new bin.
   */
  @Output() create = new EventEmitter<LocationBin>();

  // ── Component state ───────────────────────────────────────────────────────

  bins: LocationBin[] = [];
  loading = false;
  loadError = '';

  /** The value held by the native <select> — may be the sentinel for create. */
  selectValue = '';

  /** Text input value used in fallback mode. */
  textValue = '';

  /** Whether the inline create dialog is open. */
  showCreateDialog = false;
  createForm: BinCreateForm = this.emptyCreateForm();
  creating = false;
  createError = '';

  readonly binTypeOptions: Array<{ value: BinType; label: string }> = [
    { value: 'SHELF',   label: 'Shelf' },
    { value: 'RACK',    label: 'Rack' },
    { value: 'FLOOR',   label: 'Floor' },
    { value: 'CABINET', label: 'Cabinet' },
    { value: 'FREEZER', label: 'Freezer' },
    { value: 'OUTDOOR', label: 'Outdoor' }
  ];

  constructor(
    private api: ApiService,
    private cdr: ChangeDetectorRef
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit(): void {
    if (this.locationId) {
      this.loadBins();
    }
    this.syncSelectValue();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['locationId'] && !changes['locationId'].firstChange) {
      this.bins = [];
      this.loadError = '';
      if (this.locationId) {
        this.loadBins();
      }
    }
    if (changes['value']) {
      this.syncSelectValue();
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  /** True once loading finishes and there are no bins for this location. */
  get hasNoBins(): boolean {
    return !this.loading && this.bins.length === 0 && !this.loadError;
  }

  /** True when the component should render a plain text input instead of a picker. */
  get showFallback(): boolean {
    return this.fallbackToText && this.hasNoBins;
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  private loadBins(): void {
    this.loading = true;
    this.loadError = '';
    this.cdr.markForCheck();

    this.api.getLocationBins(this.locationId).subscribe({
      next: (data: LocationBin[] | { data?: LocationBin[] }) => {
        // Handle both array response and wrapped { data: [] } response shapes
        this.bins = Array.isArray(data) ? data : ((data as { data?: LocationBin[] }).data ?? []);
        this.loading = false;
        this.syncSelectValue();
        this.cdr.markForCheck();
      },
      error: (err: { error?: { error?: string } }) => {
        this.loadError = err?.error?.error ?? 'Failed to load bins.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ── Formatting ────────────────────────────────────────────────────────────

  /**
   * Returns a human-readable label for a bin.
   * Format: "A-1 (Shelf A, Row 1)" when bin_name is set;
   * "A-1 (Zone B › Aisle 3)" when only structural fields are set;
   * "A-1" when no additional info is available.
   */
  formatBin(bin: LocationBin): string {
    const details: string[] = [];

    if (bin.bin_name) {
      details.push(bin.bin_name);
    } else {
      if (bin.zone)     details.push(bin.zone);
      if (bin.aisle)    details.push(bin.aisle);
      if (bin.shelf)    details.push(bin.shelf);
      if (bin.position) details.push(bin.position);
    }

    return details.length > 0
      ? `${bin.bin_code} (${details.join(', ')})`
      : bin.bin_code;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  /** Called by the native <select> (change) binding. */
  onSelectChange(event: Event): void {
    const selected = (event.target as HTMLSelectElement).value;

    if (selected === CREATE_SENTINEL) {
      // Reset the visual selection back to the current value so the
      // dropdown doesn't stay on the sentinel after dialog is closed.
      this.syncSelectValue();
      this.openCreateDialog();
      return;
    }

    const newValue = selected || null;
    this.value = newValue;
    this.valueChange.emit(newValue);
    this.cdr.markForCheck();
  }

  /** Called by the text <input> (input) binding in fallback mode. */
  onTextInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.textValue = text;
    // In fallback mode we emit the raw text as a pseudo-value so the parent
    // can store it without a real bin_id.
    this.valueChange.emit(text || null);
    this.cdr.markForCheck();
  }

  /** Keeps the native select's visual state in sync with the [value] input. */
  private syncSelectValue(): void {
    this.selectValue = this.value ?? '';
    this.textValue   = this.value ?? '';
  }

  // ── Inline create ─────────────────────────────────────────────────────────

  openCreateDialog(): void {
    this.createForm  = this.emptyCreateForm();
    this.createError = '';
    this.showCreateDialog = true;
    this.cdr.markForCheck();
  }

  closeCreateDialog(): void {
    this.showCreateDialog = false;
    this.cdr.markForCheck();
  }

  saveNewBin(): void {
    if (!this.createForm.bin_code.trim()) { return; }
    if (!this.locationId) {
      this.createError = 'Save the location first before adding bins.';
      return;
    }

    this.creating    = true;
    this.createError = '';
    this.cdr.markForCheck();

    const payload: BinFormValue = {
      bin_code: this.createForm.bin_code.trim(),
      bin_name: this.createForm.bin_name.trim() || null,
      bin_type: (this.createForm.bin_type as BinType) || null,
      zone:     this.createForm.zone.trim() || null,
    };

    this.api.createLocationBin(this.locationId, payload as unknown as Record<string, unknown>).subscribe({
      next: (newBin: LocationBin) => {
        this.creating = false;
        this.showCreateDialog = false;
        this.bins = [...this.bins, newBin];
        // Auto-select the new bin
        this.value = newBin.id;
        this.syncSelectValue();
        this.valueChange.emit(newBin.id);
        this.create.emit(newBin);
        this.cdr.markForCheck();
      },
      error: (err: { error?: { error?: string } }) => {
        this.createError = err?.error?.error ?? 'Failed to create bin.';
        this.creating    = false;
        this.cdr.markForCheck();
      }
    });
  }

  onDialogBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('bp-backdrop')) {
      this.closeCreateDialog();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private emptyCreateForm(): BinCreateForm {
    return { bin_code: '', bin_name: '', bin_type: '', zone: '' };
  }
}
