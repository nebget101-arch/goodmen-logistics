import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import {
  WizardShellComponent,
  WizardStepDef,
  WizardMode,
} from '../shared/wizard/wizard-shell.component';
import { LoadWizardBasicsComponent } from './steps/basics/basics.component';
import { LoadWizardDriverEquipmentComponent } from './steps/driver-equipment/driver-equipment.component';
import { LoadWizardAttachmentsComponent } from './steps/attachments/attachments.component';
import { LoadsService } from '../../services/loads.service';
import {
  LoadAiEndpointExtraction,
  LoadAttachment,
  LoadAttachmentType,
  LoadDetail,
  LoadStopType,
} from '../../models/load-dashboard.model';
import { LoadWizardStopsComponent } from './steps/stops/stops.component';

export type LoadWizardMode = 'create' | 'edit' | 'view' | 'ai-extract';

type LoadWizardStepId = 'basics' | 'stops' | 'driver' | 'attachments';

/**
 * LoadWizardComponent (FN-862 / S2) — 4-step load wizard built on `app-wizard-shell`.
 *
 * Step bodies are placeholders at this stage; stories S3–S6 (FN-863..FN-866) fill
 * them in. The shell owns all form state so later steps only need to render
 * controls bound to the nested FormGroup exposed here.
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
   * the caller once FN-867 / FN-868 wire up the load-detail prefill.
   */
  @Input() existingAttachments: LoadAttachment[] = [];

  @Output() created = new EventEmitter<LoadDetail>();
  @Output() updated = new EventEmitter<LoadDetail>();
  @Output() closed = new EventEmitter<void>();

  readonly steps: WizardStepDef[] = [
    { id: 'basics',      label: 'Basics',             icon: 'assignment' },
    { id: 'stops',       label: 'Stops',              icon: 'place' },
    { id: 'driver',      label: 'Driver & Equipment', icon: 'local_shipping' },
    { id: 'attachments', label: 'Attachments',        icon: 'attach_file' },
  ];

  currentStepId: LoadWizardStepId = 'basics';
  submitting = false;
  errorMessage = '';

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
    this.cdr.markForCheck();
  }

  /** Mirror a delete of an existing attachment back into the LoadDetail cache. */
  onExistingDeleted(attachmentId: string): void {
    this.existingAttachments = this.existingAttachments.filter((a) => a.id !== attachmentId);
    this.cdr.markForCheck();
  }

  // ─── Submit ─────────────────────────────────────────────────────────────

  onSubmit(): void {
    if (this.submitting || !this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.mode === 'create' || this.mode === 'ai-extract') {
      this.submitCreate();
    }
    // Edit / view submit paths land in FN-867 / FN-868.
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
