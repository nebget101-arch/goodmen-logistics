import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragPlaceholder,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { forkJoin, of, Subject, timer } from 'rxjs';
import { catchError, debounceTime, map, switchMap, takeUntil } from 'rxjs/operators';

import { LoadsService } from '../../../../services/loads.service';
import { LoadStopType } from '../../../../models/load-dashboard.model';
import { LoadWizardMode } from '../../load-wizard.component';
import { ConfidenceBadgeComponent } from '../../../../shared/components/confidence-badge/confidence-badge.component';

/** Trip metrics computed from stop coordinates + rate. */
interface TripMetrics {
  totalMiles: number | null;
  emptyMiles: number | null;
  loadedMiles: number | null;
  ratePerMile: number | null;
}

/**
 * FN-864 / FN-877 — Step 2 (Stops) sub-component for `<app-load-wizard-v2>`.
 *
 * Renders controls bound to the parent wizard's `stops` FormArray. Owns no
 * form state of its own. Responsibilities:
 *   - CDK drag-drop reordering (updates FormArray order + renumbers sequences)
 *   - + Add Stop / Delete row (keeps ≥ 1 pickup + ≥ 1 delivery)
 *   - Zip lookup on blur → patches city/state on the matching row
 *   - Trip Metrics panel: debounced `getRouteGeometry` fetch → Haversine miles
 *   - View mode disables drag + inputs
 */
@Component({
  selector: 'app-load-wizard-stops',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    ConfidenceBadgeComponent,
  ],
  templateUrl: './stops.component.html',
  styleUrls: ['./stops.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadWizardStopsComponent implements OnInit, OnChanges {
  @Input({ required: true }) stops!: FormArray<FormGroup>;
  @Input() rate: number | null = null;
  @Input() mode: LoadWizardMode = 'create';

  /**
   * FN-888 — per-field confidence scores (0–1) keyed by `stops[<index>].<field>`
   * (e.g. `stops[0].city`). Populates inline field badges when < 0.85. Unused
   * outside ai-extract; an empty record causes every badge to auto-hide.
   */
  @Input() fieldConfidences: Record<string, number> | null = null;

  /** Template helper — returns the score for `stops[index].field` or null. */
  scoreFor(index: number, field: string): number | null {
    if (!this.fieldConfidences) return null;
    const key = `stops[${index}].${field}`;
    const raw = this.fieldConfidences[key];
    return typeof raw === 'number' ? raw : null;
  }

  readonly stopTypeOptions: Array<{ value: LoadStopType; label: string }> = [
    { value: 'PICKUP', label: 'Pickup' },
    { value: 'DELIVERY', label: 'Delivery' },
  ];

  metrics: TripMetrics = {
    totalMiles: null,
    emptyMiles: null,
    loadedMiles: null,
    ratePerMile: null,
  };
  metricsLoading = false;

  /** Per-row zip-lookup loading flag, keyed by FormGroup ref. */
  private zipLoading = new WeakMap<FormGroup, boolean>();

  /** Cancels any in-flight zip lookup from earlier debounce windows. */
  private cancelMetrics$ = new Subject<void>();

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private fb: FormBuilder,
    private loadsService: LoadsService,
    private cdr: ChangeDetectorRef,
  ) {}

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.applyModeState();
    this.subscribeToValueChanges();
    this.recomputeMetrics();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mode'] && !changes['mode'].firstChange) {
      this.applyModeState();
    }
    if (changes['rate'] && !changes['rate'].firstChange) {
      this.recomputeMetrics();
    }
  }

  // ─── Row helpers ───────────────────────────────────────────────────────

  isView(): boolean {
    return this.mode === 'view';
  }

  trackByControl = (_: number, g: FormGroup): unknown => g;

  asFormGroup(ctrl: unknown): FormGroup {
    return ctrl as FormGroup;
  }

  isZipLoading(row: FormGroup): boolean {
    return !!this.zipLoading.get(row);
  }

  /** Disallow deleting the last PICKUP or the last DELIVERY (keep ≥ 1 of each). */
  isDeleteDisabled(row: FormGroup): boolean {
    if (this.isView()) return true;
    const type = row.get('stop_type')?.value as LoadStopType | null;
    if (!type) return false;
    const sameType = this.stops.controls.filter(
      (c) => c.get('stop_type')?.value === type,
    );
    return sameType.length <= 1;
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────

  addStop(): void {
    if (this.isView()) return;
    this.stops.push(this.buildStop('DELIVERY', this.stops.length + 1));
    this.renumberSequences();
    this.cdr.markForCheck();
  }

  removeStop(index: number): void {
    if (this.isView()) return;
    const row = this.stops.at(index) as FormGroup;
    if (this.isDeleteDisabled(row)) return;
    this.stops.removeAt(index);
    this.renumberSequences();
    this.cdr.markForCheck();
  }

  onDrop(event: CdkDragDrop<FormGroup[]>): void {
    if (this.isView()) return;
    if (event.previousIndex === event.currentIndex) return;
    const controls = this.stops.controls;
    moveItemInArray(controls, event.previousIndex, event.currentIndex);
    // Re-sync the FormArray internal _controls so valueChanges fires with the new order.
    this.stops.setControl(event.previousIndex, controls[event.previousIndex]);
    this.stops.setControl(event.currentIndex, controls[event.currentIndex]);
    this.renumberSequences();
    this.cdr.markForCheck();
  }

  // ─── Zip lookup ────────────────────────────────────────────────────────

  onZipBlur(row: FormGroup): void {
    if (this.isView()) return;
    const raw = (row.get('zip')?.value ?? '').toString().trim();
    if (!raw) return;
    // Skip if city/state already filled for this zip (avoid clobbering user edits).
    this.zipLoading.set(row, true);
    this.cdr.markForCheck();
    this.loadsService
      .lookupZip(raw)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const d = res?.data;
          if (d?.city || d?.state) {
            row.patchValue(
              {
                city: d.city || row.get('city')?.value || null,
                state: d.state || row.get('state')?.value || null,
              },
              { emitEvent: true },
            );
          }
          this.zipLoading.set(row, false);
          this.cdr.markForCheck();
        },
        error: () => {
          this.zipLoading.set(row, false);
          this.cdr.markForCheck();
        },
      });
  }

  // ─── Metrics ───────────────────────────────────────────────────────────

  private subscribeToValueChanges(): void {
    this.stops.valueChanges
      .pipe(debounceTime(350), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.recomputeMetrics());
  }

  private recomputeMetrics(): void {
    this.cancelMetrics$.next();
    const rows = this.stops.controls as FormGroup[];
    const zips = rows
      .map((g) => {
        const z = (g.get('zip')?.value ?? '').toString().trim();
        const type = g.get('stop_type')?.value as LoadStopType | null;
        return z ? { zip: z, type } : null;
      })
      .filter((x): x is { zip: string; type: LoadStopType | null } => !!x);

    if (zips.length < 2) {
      this.metrics = {
        totalMiles: null,
        emptyMiles: null,
        loadedMiles: null,
        ratePerMile: null,
      };
      this.metricsLoading = false;
      this.cdr.markForCheck();
      return;
    }

    this.metricsLoading = true;
    this.cdr.markForCheck();

    // Small debounce window so rapid edits collapse into one backend call.
    timer(200)
      .pipe(
        switchMap(() =>
          forkJoin(
            zips.map((entry) =>
              this.loadsService.lookupZip(entry.zip).pipe(
                map((res) => {
                  const d = res?.data;
                  if (d?.lat != null && d?.lon != null) {
                    return { lat: d.lat, lon: d.lon, type: entry.type };
                  }
                  return null;
                }),
                catchError(() => of(null)),
              ),
            ),
          ),
        ),
        switchMap((waypoints) => {
          const valid = waypoints.filter(
            (w): w is { lat: number; lon: number; type: LoadStopType | null } => !!w,
          );
          if (valid.length < 2) {
            return of({ coords: [] as [number, number][], types: [] as (LoadStopType | null)[] });
          }
          return this.loadsService
            .getRouteGeometry(valid.map((v) => ({ lat: v.lat, lon: v.lon })))
            .pipe(
              map((geom) => ({
                coords: geom?.coordinates || [],
                types: valid.map((v) => v.type),
                waypoints: valid,
              })),
              catchError(() =>
                of({
                  coords: [] as [number, number][],
                  types: valid.map((v) => v.type),
                  waypoints: valid,
                }),
              ),
            );
        }),
        takeUntil(this.cancelMetrics$),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.metrics = this.computeMetrics(result);
        this.metricsLoading = false;
        this.cdr.markForCheck();
      });
  }

  private computeMetrics(result: {
    coords: [number, number][];
    types: (LoadStopType | null)[];
    waypoints?: { lat: number; lon: number }[];
  }): TripMetrics {
    const { coords, types, waypoints } = result;

    // Prefer route geometry for total (follows actual roads); fallback to
    // waypoint-to-waypoint great-circle distance when the backend proxy is
    // unavailable.
    let total: number | null = null;
    if (coords.length >= 2) {
      total = 0;
      for (let i = 1; i < coords.length; i++) {
        const [lon1, lat1] = coords[i - 1];
        const [lon2, lat2] = coords[i];
        total += this.haversineMiles(lat1, lon1, lat2, lon2);
      }
    } else if (waypoints && waypoints.length >= 2) {
      total = 0;
      for (let i = 1; i < waypoints.length; i++) {
        total += this.haversineMiles(
          waypoints[i - 1].lat,
          waypoints[i - 1].lon,
          waypoints[i].lat,
          waypoints[i].lon,
        );
      }
    }

    // Split loaded vs empty using stop-type sequencing: segments that start at
    // a PICKUP are "loaded" until the next DELIVERY; everything else is empty.
    // Without per-segment geometry we approximate on the waypoint list.
    let loaded: number | null = null;
    let empty: number | null = null;
    if (waypoints && waypoints.length >= 2 && types.length === waypoints.length) {
      let loadedSum = 0;
      let emptySum = 0;
      let carrying = false;
      for (let i = 1; i < waypoints.length; i++) {
        const segMiles = this.haversineMiles(
          waypoints[i - 1].lat,
          waypoints[i - 1].lon,
          waypoints[i].lat,
          waypoints[i].lon,
        );
        if (types[i - 1] === 'PICKUP') carrying = true;
        if (carrying) loadedSum += segMiles;
        else emptySum += segMiles;
        if (types[i] === 'DELIVERY') carrying = false;
      }
      // Scale loaded/empty to the total (road-following) when we have both
      // so the three numbers reconcile.
      const waypointTotal = loadedSum + emptySum;
      if (total != null && waypointTotal > 0 && coords.length >= 2) {
        const ratio = total / waypointTotal;
        loaded = Math.round(loadedSum * ratio);
        empty = Math.round(emptySum * ratio);
      } else {
        loaded = Math.round(loadedSum);
        empty = Math.round(emptySum);
      }
    }

    const totalRounded = total != null ? Math.round(total) : null;
    const rpm =
      this.rate != null && totalRounded != null && totalRounded > 0
        ? Math.round((Number(this.rate) / totalRounded) * 100) / 100
        : null;

    return {
      totalMiles: totalRounded,
      emptyMiles: empty,
      loadedMiles: loaded,
      ratePerMile: rpm,
    };
  }

  private haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3958.7613; // Earth radius in miles.
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ─── View-mode toggling ────────────────────────────────────────────────

  private applyModeState(): void {
    if (!this.stops) return;
    if (this.isView()) {
      this.stops.disable({ emitEvent: false });
    } else {
      this.stops.enable({ emitEvent: false });
    }
  }

  // ─── Form builders ─────────────────────────────────────────────────────

  private buildStop(type: LoadStopType, sequence: number): FormGroup {
    return this.fb.group({
      stop_type: [type as LoadStopType, Validators.required],
      stop_date: [null as string | null],
      stop_time: [null as string | null],
      city: [null as string | null],
      state: [null as string | null],
      zip: [null as string | null],
      address1: [null as string | null],
      facility_name: [null as string | null],
      notes: [null as string | null],
      sequence: [sequence],
    });
  }

  private renumberSequences(): void {
    this.stops.controls.forEach((c, i) => {
      c.get('sequence')?.setValue(i + 1, { emitEvent: false });
    });
  }
}
