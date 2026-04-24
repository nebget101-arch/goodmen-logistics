import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
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
import { LoadsService } from '../../services/loads.service';
import {
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
  ],
  templateUrl: './load-wizard.component.html',
  styleUrls: ['./load-wizard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadWizardComponent implements OnInit {
  @Input() mode: LoadWizardMode = 'create';
  @Input() loadId: string | null = null;

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
    });
  }

  private isValidStepId(id: string): id is LoadWizardStepId {
    return id === 'basics' || id === 'stops' || id === 'driver' || id === 'attachments';
  }
}
