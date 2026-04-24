import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import {
  WizardShellComponent,
  WizardStepDef,
  WizardMode,
} from '../shared/wizard/wizard-shell.component';
import { LoadWizardBasicsComponent } from './steps/basics/basics.component';
import { LoadWizardDriverEquipmentComponent } from './steps/driver-equipment/driver-equipment.component';
import { LoadWizardAttachmentsComponent } from './steps/attachments/attachments.component';
import { LoadsService } from '../../services/loads.service';
import { AccessControlService } from '../../services/access-control.service';
import { PERMISSIONS } from '../../models/access-control.model';
import {
  LoadAiEndpointExtraction,
  LoadAttachment,
  LoadAttachmentType,
  LoadDetail,
  LoadStop,
  LoadStopType,
} from '../../models/load-dashboard.model';
import { LoadWizardStopsComponent } from './steps/stops/stops.component';

export type LoadWizardMode = 'create' | 'edit' | 'view' | 'ai-extract';

type LoadWizardStepId = 'basics' | 'stops' | 'driver' | 'attachments';

/**
 * LoadWizardComponent (FN-862 / S2) — 4-step load wizard built on `app-wizard-shell`.
 *
 * Edit-mode wiring (FN-867 / S7): when `mode='edit'` with a `loadId`, the
 * wizard fetches the LoadDetail via `LoadsService.getLoad` (or accepts a
 * pre-fetched `loadDetail`), prefills all four step FormGroups, exposes the
 * source rate-confirmation PDF on Step 4, and submits via `updateLoad`.
 *
 * View-mode wiring (FN-868 / S8): same prefill pipeline runs for `mode='view'`;
 * the form is eagerly disabled so unmounted steps stay read-only, and a
 * permission-gated header Edit button flips into edit mode in place while
 * preserving the current step.
 *
 * Co-exists with the legacy `<app-load-wizard>` modal (S10 removes it).
 */
@Component({
  selector: 'app-load-wizard-v2',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    WizardShellComponent,
    LoadWizardBasicsComponent,
    LoadWizardStopsComponent,
    LoadWizardDriverEquipmentComponent,
    LoadWizardAttachmentsComponent,
  ],
  templateUrl: './load-wizard.component.html',
  styleUrls: ['./load-wizard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadWizardComponent implements OnInit, OnDestroy {
  @Input() mode: LoadWizardMode = 'create';
  @Input() loadId: string | null = null;
  /**
   * FN-881: existing attachments rendered in the Attachments step for
   * edit / view / ai-extract flows. Sourced from `LoadDetail.attachments` by
   * the caller; also populated automatically when edit-mode prefill runs.
   */
  @Input() existingAttachments: LoadAttachment[] = [];
  /**
   * FN-867: optional pre-fetched LoadDetail for edit/view mode. When provided,
   * the wizard skips its own `getLoad` call and prefills immediately. Useful
   * for callers that already have the detail (e.g. dashboard row drawer).
   */
  @Input() loadDetail: LoadDetail | null = null;

  @Output() created = new EventEmitter<LoadDetail>();
  @Output() updated = new EventEmitter<LoadDetail>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('pdfFrame') pdfFrame?: ElementRef<HTMLIFrameElement>;

  readonly steps: WizardStepDef[] = [
    { id: 'basics',      label: 'Basics',             icon: 'assignment' },
    { id: 'stops',       label: 'Stops',              icon: 'place' },
    { id: 'driver',      label: 'Driver & Equipment', icon: 'local_shipping' },
    { id: 'attachments', label: 'Attachments',        icon: 'attach_file' },
  ];

  currentStepId: LoadWizardStepId = 'basics';
  submitting = false;
  loading = false;
  errorMessage = '';
  sourcePdfUrl: SafeResourceUrl | null = null;

  form!: FormGroup;

  // ─── FN-888 AI-Extract flow state ──────────────────────────────────────
  /** Source rate-confirmation PDF selected in Step 0. Preserved across retries. */
  sourcePdfFile: File | null = null;
  /** True while an `aiExtractFromPdf` request is in flight. */
  extracting = false;
  /** True once extraction has succeeded and Steps 1–2 have been pre-filled. */
  extractionComplete = false;
  /** Inline error message shown under the dropzone when extraction fails. */
  extractionError = '';
  /** Per-field confidence scores (0–1) passed to Basics + Stops for field badges. */
  fieldConfidences: Record<string, number> = {};
  /** Broker display name parsed from the PDF — seeds the Basics combo search input. */
  aiBrokerNameHint: string | null = null;
  /** Progressive UI labels shown while extraction is running. */
  readonly extractionStepLabels: string[] = [
    'Extracting text from PDF',
    'Identifying broker & references',
    'Parsing stops & addresses',
    'Calculating rate & confidence',
  ];
  /** Index of the step currently animating; -1 = idle. */
  extractionStepIndex = -1;
  private extractionStepTimer: number | null = null;

  constructor(
    private fb: FormBuilder,
    private loadsService: LoadsService,
    private sanitizer: DomSanitizer,
    private access: AccessControlService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      basics: this.fb.group({
        loadNumber:    [''],
        status:        ['DRAFT',   Validators.required],
        billingStatus: ['PENDING', Validators.required],
        brokerId:      [null as string | null],
        poNumber:      [''],
        rate:          [0, Validators.required],
        dispatcherId:  [null as string | null],
        notes:         [''],
      }),
      stops: this.fb.array<FormGroup>([
        this.buildStop('PICKUP', 1),
        this.buildStop('DELIVERY', 2),
      ]),
      driverEquipment: this.fb.group({
        driverId:       [null as string | null],
        truckId:        [null as string | null],
        trailerId:      [null as string | null],
        showAllTrucks:  [false],
      }),
      attachments: this.fb.group({
        queued: this.fb.array<FormGroup>([]),
      }),
    });

    // Re-run CD whenever validity changes so canProceed flips in the shell footer.
    this.form.statusChanges.subscribe(() => this.cdr.markForCheck());

    // FN-868: eagerly disable every step in view mode so inputs on not-yet-mounted
    // steps are already read-only if the user navigates to them before the
    // server prefill resolves.
    this.applyViewDisableState();

    // FN-867: edit/view prefill — use pre-supplied detail if present, else fetch.
    if ((this.mode === 'edit' || this.mode === 'view') && this.loadId) {
      if (this.loadDetail && this.loadDetail.id === this.loadId) {
        this.applyLoadDetail(this.loadDetail);
      } else {
        this.fetchLoadForPrefill(this.loadId);
      }
    }
  }

  /** Disable (view) / enable (non-view) every sub-FormGroup from the parent. */
  private applyViewDisableState(): void {
    if (!this.form) return;
    if (this.mode === 'view') {
      this.form.disable({ emitEvent: false });
    } else {
      this.form.enable({ emitEvent: false });
    }
  }

  ngOnDestroy(): void {
    this.stopExtractionTimer();
  }

  // ─── Public accessors ───────────────────────────────────────────────────

  get basics(): FormGroup {
    return this.form.get('basics') as FormGroup;
  }

  get stops(): FormArray<FormGroup> {
    return this.form.get('stops') as FormArray<FormGroup>;
  }

  get driverEquipment(): FormGroup {
    return this.form.get('driverEquipment') as FormGroup;
  }

  get attachmentsGroup(): FormGroup {
    return this.form.get('attachments') as FormGroup;
  }

  get queuedAttachments(): FormArray<FormGroup> {
    return this.attachmentsGroup.get('queued') as FormArray<FormGroup>;
  }

  /** Numeric rate value passed into the Stops step for trip-metrics calc. */
  get ratePerMileInput(): number | null {
    const raw = this.basics.get('rate')?.value;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  get shellMode(): WizardMode {
    // The shell understands create/edit/view; ai-extract acts like create.
    return this.mode === 'view' ? 'view' : this.mode === 'edit' ? 'edit' : 'create';
  }

  /** True when the current step is 4 and a source PDF is available to render. */
  get showSourcePdf(): boolean {
    return this.currentStepId === 'attachments' && !!this.sourcePdfUrl;
  }

  /**
   * FN-888 — Step 0 PDF dropzone gate. Renders ahead of the wizard shell while
   * in `ai-extract` mode and the extraction hasn't completed yet. Once
   * extraction succeeds, `extractionComplete` flips and the normal 4-step shell
   * takes over with Steps 1–2 pre-filled.
   */
  get showExtractStep(): boolean {
    return this.mode === 'ai-extract' && !this.extractionComplete;
  }

  /**
   * Per-step gating. Final step's value also drives whether Submit is enabled.
   * Only `basics` has required fields at this stage — later stories tighten
   * the rules on stops / driver / attachments.
   */
  get canProceed(): boolean {
    switch (this.currentStepId) {
      case 'basics':
        return this.basics.valid;
      case 'stops':
        return this.stops.length >= 2 && this.stops.valid;
      case 'driver':
        return this.driverEquipment.valid;
      case 'attachments':
        return this.attachmentsGroup.valid && !this.submitting;
      default:
        return false;
    }
  }

  // ─── Step navigation ────────────────────────────────────────────────────

  onStepChange(stepId: string): void {
    if (this.isValidStepId(stepId)) {
      this.currentStepId = stepId;
    }
  }

  onBack(): void {
    const idx = this.steps.findIndex(s => s.id === this.currentStepId);
    if (idx > 0) this.currentStepId = this.steps[idx - 1].id as LoadWizardStepId;
  }

  onNext(): void {
    if (!this.canProceed) return;
    const idx = this.steps.findIndex(s => s.id === this.currentStepId);
    if (idx < this.steps.length - 1) {
      this.currentStepId = this.steps[idx + 1].id as LoadWizardStepId;
    }
  }

  onClose(): void {
    this.closed.emit();
  }

  // ─── View → Edit toggle (FN-868 / FN-885) ───────────────────────────────

  /** True when the current user can flip a view-mode wizard into edit mode. */
  get canEdit(): boolean {
    return this.access.hasPermission(PERMISSIONS.LOADS_EDIT);
  }

  /** Header Edit button: flip to edit mode in place, preserving the current step. */
  onEditClick(): void {
    if (this.mode !== 'view' || !this.canEdit) return;
    this.mode = 'edit';
    this.applyViewDisableState();
    this.cdr.markForCheck();
  }

  // ─── FN-888 AI-Extract flow ─────────────────────────────────────────────

  /** File input / drag-drop handler for the Step 0 dropzone. */
  onPdfSelected(file: File | null | undefined): void {
    if (!file) return;
    if (!this.isPdfFile(file)) {
      this.extractionError = 'Only PDF files are supported.';
      this.cdr.markForCheck();
      return;
    }
    this.sourcePdfFile = file;
    this.extractionError = '';
    this.runExtraction();
  }

  onPdfDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0] ?? null;
    this.onPdfSelected(file);
  }

  onPdfDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  /** Re-run extraction for the already-selected PDF, preserving any form edits. */
  onExtractionRetry(): void {
    if (!this.sourcePdfFile || this.extracting) return;
    this.extractionError = '';
    this.runExtraction();
  }

  /** Clear the selected PDF so the user can pick a different file. */
  onPdfClear(): void {
    if (this.extracting) return;
    this.sourcePdfFile = null;
    this.extractionError = '';
    this.extractionStepIndex = -1;
    this.cdr.markForCheck();
  }

  private runExtraction(): void {
    if (!this.sourcePdfFile) return;
    this.extracting = true;
    this.extractionError = '';
    this.extractionStepIndex = 0;
    this.cdr.markForCheck();

    // Animate the progress-step list so the user sees motion while the single
    // backend request is in flight.
    this.stopExtractionTimer();
    this.extractionStepTimer = window.setInterval(() => {
      if (this.extractionStepIndex < this.extractionStepLabels.length - 2) {
        this.extractionStepIndex += 1;
        this.cdr.markForCheck();
      }
    }, 700);

    this.loadsService.aiExtractFromPdf(this.sourcePdfFile).subscribe({
      next: (res) => {
        this.stopExtractionTimer();
        this.extractionStepIndex = this.extractionStepLabels.length - 1;
        const data = res?.data;
        if (!data) {
          this.extracting = false;
          this.extractionError = 'Extraction returned no data. Please try again.';
          this.cdr.markForCheck();
          return;
        }
        this.applyExtraction(data);
        this.extracting = false;
        this.extractionComplete = true;
        // AC: "wizard focuses Step 1" after extraction.
        this.currentStepId = 'basics';
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.stopExtractionTimer();
        this.extracting = false;
        const serverMsg =
          err?.error?.warning || err?.error?.message || err?.message;
        this.extractionError =
          serverMsg || 'Extraction failed. Please try again.';
        this.cdr.markForCheck();
      },
    });
  }

  private stopExtractionTimer(): void {
    if (this.extractionStepTimer != null) {
      clearInterval(this.extractionStepTimer);
      this.extractionStepTimer = null;
    }
  }

  /**
   * Map an `LoadAiEndpointExtraction` payload into the wizard's FormGroups.
   * Broker is surfaced as a search-input hint (basics has no `brokerName`
   * control — the user still picks/creates a broker record to link `brokerId`).
   */
  private applyExtraction(data: LoadAiEndpointExtraction): void {
    const loadNumber =
      data.loadId ??
      data.orderId ??
      data.proNumber ??
      '';
    this.basics.patchValue({
      loadNumber: loadNumber || this.basics.get('loadNumber')?.value || '',
      poNumber: data.poNumber || '',
      rate: data.rate != null ? data.rate : (this.basics.get('rate')?.value ?? 0),
      notes: this.basics.get('notes')?.value || data.notes || '',
    });
    this.aiBrokerNameHint = data.brokerName && data.brokerName.trim()
      ? data.brokerName.trim()
      : null;

    this.applyExtractionStops(data);

    this.fieldConfidences = data.fieldConfidences
      ? { ...data.fieldConfidences }
      : {};
  }

  private applyExtractionStops(data: LoadAiEndpointExtraction): void {
    const extractedStops: Array<Partial<{
      type: LoadStopType;
      date: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      address1: string | null;
    }>> = [];

    if (Array.isArray(data.stops) && data.stops.length > 0) {
      const sorted = [...data.stops].sort(
        (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
      );
      for (const s of sorted) {
        extractedStops.push({
          type: (s.type ?? 'PICKUP') as LoadStopType,
          date: s.date ?? null,
          city: s.city ?? null,
          state: s.state ?? null,
          zip: s.zip ?? null,
          address1: s.address1 ?? null,
        });
      }
    } else {
      const pickup = data.pickup;
      const delivery = data.delivery;
      if (pickup) {
        extractedStops.push({
          type: 'PICKUP',
          date: pickup.date,
          city: pickup.city,
          state: pickup.state,
          zip: pickup.zip,
          address1: pickup.address1,
        });
      }
      if (delivery) {
        extractedStops.push({
          type: 'DELIVERY',
          date: delivery.date,
          city: delivery.city,
          state: delivery.state,
          zip: delivery.zip,
          address1: delivery.address1,
        });
      }
    }

    if (extractedStops.length < 2) return;

    // Rebuild the stops FormArray in place so we can pre-fill N stops without
    // leaving stale rows (default form has exactly 2 rows).
    while (this.stops.length > 0) this.stops.removeAt(0);
    extractedStops.forEach((s, i) => {
      const row = this.buildStop((s.type ?? 'PICKUP') as LoadStopType, i + 1);
      row.patchValue({
        stop_date: s.date ?? null,
        city: s.city ?? null,
        state: s.state ?? null,
        zip: s.zip ?? null,
        address1: s.address1 ?? null,
      });
      this.stops.push(row);
    });
  }

  private isPdfFile(file: File): boolean {
    if (file.type === 'application/pdf') return true;
    // Some browsers (or drag-drop from the OS) report an empty MIME; fall back
    // to the extension so we don't reject a valid PDF.
    return /\.pdf$/i.test(file.name);
  }

  // ─── Attachment queue helpers ───────────────────────────────────────────

  /**
   * Append a file to the upload queue. Child step component (FN-866) will call
   * this once built; exposed publicly for external prefill (e.g. AI-extract
   * flow handing us the source PDF).
   */
  queueAttachment(file: File, type: LoadAttachmentType = 'OTHER', notes = ''): void {
    this.queuedAttachments.push(this.buildAttachment(file, type, notes));
    this.cdr.markForCheck();
  }

  removeQueuedAttachment(index: number): void {
    if (index >= 0 && index < this.queuedAttachments.length) {
      this.queuedAttachments.removeAt(index);
      this.cdr.markForCheck();
    }
  }

  // ─── Attachment step callbacks (FN-881) ────────────────────────────────

  /** Mirror an immediate-mode upload success back into the LoadDetail cache. */
  onAttachmentUploaded(att: LoadAttachment): void {
    this.existingAttachments = [att, ...this.existingAttachments];
    this.refreshSourcePdfUrl();
    this.cdr.markForCheck();
  }

  /** Mirror a delete of an existing attachment back into the LoadDetail cache. */
  onExistingDeleted(attachmentId: string): void {
    this.existingAttachments = this.existingAttachments.filter((a) => a.id !== attachmentId);
    this.refreshSourcePdfUrl();
    this.cdr.markForCheck();
  }

  // ─── Timeline summary (FN-867 / S7) ────────────────────────────────────

  /** Click from the Step 2 timeline — scroll the target row into view. */
  onTimelineStopClick(index: number): void {
    if (index < 0 || index >= this.stops.length) return;
    const row = document.querySelector<HTMLElement>(
      `[data-wizard-stop-row="${index}"]`,
    );
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('stop-row--focus-flash');
      setTimeout(() => row.classList.remove('stop-row--focus-flash'), 1200);
    }
  }

  // ─── Submit ─────────────────────────────────────────────────────────────

  onSubmit(): void {
    if (this.submitting || !this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.mode === 'create' || this.mode === 'ai-extract') {
      this.submitCreate();
    } else if (this.mode === 'edit' && this.loadId) {
      this.submitUpdate();
    }
    // view mode is read-only — Submit is disabled by the shell.
  }

  private submitCreate(): void {
    this.submitting = true;
    this.errorMessage = '';

    // FN-888: in ai-extract mode, automatically attach the source rate-con
    // PDF that drove the extraction. Skip if the user already queued a copy
    // (same file reference) so we don't upload it twice.
    if (
      this.mode === 'ai-extract' &&
      this.sourcePdfFile &&
      !this.queuedAttachments.controls.some(
        (g) => g.get('file')?.value === this.sourcePdfFile,
      )
    ) {
      this.queueAttachment(this.sourcePdfFile, 'RATE_CONFIRMATION');
    }

    const payload = this.buildCreatePayload();

    this.loadsService.createLoad(payload).subscribe({
      next: (res) => {
        const load = res?.data;
        if (!load?.id) {
          this.submitting = false;
          this.errorMessage = 'Failed to create load.';
          this.cdr.markForCheck();
          return;
        }
        this.uploadQueuedAttachments(load);
      },
      error: (err) => {
        this.submitting = false;
        const serverMsg = err?.error?.error || err?.error?.message;
        this.errorMessage = serverMsg || 'Failed to create load.';
        this.cdr.markForCheck();
      },
    });
  }

  private submitUpdate(): void {
    if (!this.loadId) return;
    this.submitting = true;
    this.errorMessage = '';

    const payload = this.buildUpdatePayload();

    this.loadsService.updateLoad(this.loadId, payload).subscribe({
      next: (res) => {
        const load = res?.data;
        this.submitting = false;
        if (!load?.id) {
          this.errorMessage = 'Failed to update load.';
          this.cdr.markForCheck();
          return;
        }
        this.loadDetail = load;
        this.updated.emit(load);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.submitting = false;
        const serverMsg = err?.error?.error || err?.error?.message;
        this.errorMessage = serverMsg || 'Failed to update load.';
        this.cdr.markForCheck();
      },
    });
  }

  private uploadQueuedAttachments(load: LoadDetail): void {
    const queued = this.queuedAttachments.controls;
    if (queued.length === 0) {
      this.finishCreate(load);
      return;
    }

    const uploads$ = queued.map((g) => {
      const file = g.get('file')!.value as File;
      const type = g.get('type')!.value as LoadAttachmentType;
      const notes = (g.get('notes')!.value as string) || undefined;
      return this.loadsService
        .uploadAttachment(load.id, file, type, notes)
        .pipe(catchError(() => of(null)));
    });

    forkJoin(uploads$)
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe((results) => {
        const failed = results.filter((r) => r === null).length;
        if (failed > 0) {
          this.errorMessage = `Load created, but ${failed} attachment upload(s) failed.`;
        }
        this.finishCreate(load);
      });
  }

  private finishCreate(load: LoadDetail): void {
    this.submitting = false;
    this.created.emit(load);
    this.cdr.markForCheck();
  }

  private buildCreatePayload(): Record<string, unknown> {
    const basics = this.basics.value;
    const driver = this.driverEquipment.value;
    const stops = this.stops.controls.map((g, i) => {
      const v = g.value;
      return {
        stop_type:     v.stop_type,
        stop_date:     v.stop_date || null,
        stop_time:     v.stop_time || null,
        city:          v.city || null,
        state:         v.state || null,
        zip:           v.zip || null,
        address1:      v.address1 || null,
        facility_name: v.facility_name || null,
        notes:         v.notes || null,
        sequence:      i + 1,
      };
    });

    return {
      status:           basics.status,
      billingStatus:    basics.billingStatus,
      dispatcherUserId: basics.dispatcherId || null,
      driverId:         driver.driverId || null,
      truckId:          driver.truckId || null,
      trailerId:        driver.trailerId || null,
      brokerId:         basics.brokerId || null,
      loadNumber:       basics.loadNumber || null,
      poNumber:         basics.poNumber || null,
      rate:             basics.rate != null && basics.rate !== '' ? Number(basics.rate) : 0,
      notes:            basics.notes || null,
      stops,
    };
  }

  /**
   * FN-867: update payload preserves the server-side `id` on each stop so the
   * backend can match existing rows (update in place) vs. new rows (insert)
   * vs. removed rows (delete — any stop id in the original detail that isn't
   * present here). Matches the legacy dashboard `updateLoad` payload shape.
   */
  private buildUpdatePayload(): Record<string, unknown> {
    const basics = this.basics.value;
    const driver = this.driverEquipment.value;
    const stops = this.stops.controls.map((g, i) => {
      const v = g.value as Record<string, unknown>;
      const row: Record<string, unknown> = {
        stop_type:     v['stop_type'],
        stop_date:     v['stop_date'] || null,
        stop_time:     v['stop_time'] || null,
        city:          v['city'] || null,
        state:         v['state'] || null,
        zip:           v['zip'] || null,
        address1:      v['address1'] || null,
        facility_name: v['facility_name'] || null,
        notes:         v['notes'] || null,
        sequence:      i + 1,
      };
      if (v['id']) row['id'] = v['id'];
      return row;
    });

    return {
      status:           basics.status,
      billingStatus:    basics.billingStatus,
      dispatcherUserId: basics.dispatcherId || null,
      driverId:         driver.driverId || null,
      truckId:          driver.truckId || null,
      trailerId:        driver.trailerId || null,
      brokerId:         basics.brokerId || null,
      loadNumber:       basics.loadNumber || null,
      poNumber:         basics.poNumber || null,
      rate:             basics.rate != null && basics.rate !== '' ? Number(basics.rate) : 0,
      notes:            basics.notes || null,
      stops,
    };
  }

  // ─── Edit-mode prefill (FN-867 / S7) ───────────────────────────────────

  private fetchLoadForPrefill(id: string): void {
    this.loading = true;
    this.cdr.markForCheck();
    this.loadsService.getLoad(id).subscribe({
      next: (res) => {
        const detail = res?.data;
        this.loading = false;
        if (!detail) {
          this.errorMessage = 'Failed to load details.';
          this.cdr.markForCheck();
          return;
        }
        this.loadDetail = detail;
        this.applyLoadDetail(detail);
      },
      error: (err) => {
        this.loading = false;
        const serverMsg = err?.error?.error || err?.error?.message;
        this.errorMessage = serverMsg || 'Failed to load details.';
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Map a LoadDetail from the server onto each step's FormGroup/Array and the
   * attachments cache. Rebuilds the stops FormArray from scratch so drag-drop
   * indices and sequences match the server row ordering.
   */
  private applyLoadDetail(detail: LoadDetail): void {
    // Basics
    this.basics.patchValue({
      loadNumber:    detail.load_number ?? '',
      status:        detail.status,
      billingStatus: detail.billing_status,
      brokerId:      detail.broker_id ?? null,
      poNumber:      detail.po_number ?? '',
      rate:          detail.rate ?? 0,
      dispatcherId:  detail.dispatcher_user_id ?? null,
      notes:         detail.notes ?? '',
    });

    // Stops — rebuild from server list, preserving ids for diff on submit.
    while (this.stops.length > 0) {
      this.stops.removeAt(0, { emitEvent: false });
    }
    const sortedStops = [...(detail.stops || [])].sort(
      (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
    );
    sortedStops.forEach((stop, i) => {
      this.stops.push(this.buildStopFromServer(stop, i + 1), { emitEvent: false });
    });
    // Guarantee minimum 2 stops (wizard invariant).
    if (this.stops.length < 2) {
      while (this.stops.length < 2) {
        const type: LoadStopType = this.stops.length === 0 ? 'PICKUP' : 'DELIVERY';
        this.stops.push(this.buildStop(type, this.stops.length + 1), { emitEvent: false });
      }
    }
    this.stops.updateValueAndValidity();

    // Driver / Equipment — show all trucks so a pre-selected truck that's not
    // on the driver's assignment is still visible in the dropdown.
    this.driverEquipment.patchValue({
      driverId:      detail.driver_id ?? null,
      truckId:       detail.truck_id ?? null,
      trailerId:     detail.trailer_id ?? null,
      showAllTrucks: true,
    });

    // Attachments (existing list + source PDF viewer URL).
    this.existingAttachments = [...(detail.attachments || [])];
    this.refreshSourcePdfUrl();

    // FN-868: re-apply view-disable after rebuilding the stops FormArray so
    // newly pushed rows inherit the disabled state in view mode.
    this.applyViewDisableState();

    this.cdr.markForCheck();
  }

  private refreshSourcePdfUrl(): void {
    const rateCon = this.existingAttachments.find(
      (a) => a.type === 'RATE_CONFIRMATION' && !!a.file_url,
    );
    if (!rateCon || !rateCon.file_url) {
      this.sourcePdfUrl = null;
      return;
    }
    const abs = this.resolveAttachmentUrl(rateCon.file_url);
    this.sourcePdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(abs);
  }

  private resolveAttachmentUrl(fileUrl: string): string {
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) return fileUrl;
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return base + (fileUrl.startsWith('/') ? fileUrl : '/' + fileUrl);
  }

  // ─── Form builders ──────────────────────────────────────────────────────

  private buildStop(type: LoadStopType, sequence: number): FormGroup {
    return this.fb.group({
      stop_type:     [type as LoadStopType, Validators.required],
      stop_date:     [null as string | null],
      stop_time:     [null as string | null],
      city:          [null as string | null],
      state:         [null as string | null],
      zip:           [null as string | null],
      address1:      [null as string | null],
      facility_name: [null as string | null],
      notes:         [null as string | null],
      sequence:      [sequence],
      id:            [null as string | null],
    });
  }

  /** Build a stop FormGroup from an existing server row (preserves `id`). */
  private buildStopFromServer(stop: LoadStop, sequence: number): FormGroup {
    return this.fb.group({
      stop_type:     [stop.stop_type as LoadStopType, Validators.required],
      stop_date:     [stop.stop_date ?? null],
      stop_time:     [stop.stop_time ?? null],
      city:          [stop.city ?? null],
      state:         [stop.state ?? null],
      zip:           [stop.zip ?? null],
      address1:      [stop.address1 ?? null],
      facility_name: [stop.facility_name ?? null],
      notes:         [stop.notes ?? null],
      sequence:      [sequence],
      id:            [stop.id ?? null],
    });
  }

  private buildAttachment(file: File, type: LoadAttachmentType, notes: string): FormGroup {
    return this.fb.group({
      file:      [file, Validators.required],
      type:      [type as LoadAttachmentType, Validators.required],
      notes:     [notes],
      uploading: [false],
      uploaded:  [false],
      error:     [null as string | null],
      // FN-881: progress (0–100) during immediate-mode upload; null when idle.
      progress:  [null as number | null],
      // Stable id for trackBy so FormArray re-renders don't thrash DOM on progress ticks.
      uid:       [`att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
    });
  }

  private isValidStepId(id: string): id is LoadWizardStepId {
    return id === 'basics' || id === 'stops' || id === 'driver' || id === 'attachments';
  }
}
