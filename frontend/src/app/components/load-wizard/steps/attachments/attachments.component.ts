import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { LoadsService } from '../../../../services/loads.service';
import {
  LoadAttachment,
  LoadAttachmentType,
} from '../../../../models/load-dashboard.model';
import { LoadWizardMode } from '../../load-wizard.component';

interface AttachmentTypeOption {
  value: LoadAttachmentType;
  label: string;
}

/**
 * FN-866 / FN-881 — Step 4 (Attachments) sub-component for `<app-load-wizard-v2>`.
 *
 * Renders the drag-drop upload zone + file list bound to the parent wizard's
 * `attachments.queued` FormArray. Behaviour branches on `mode`:
 *
 *   - `create`: files are queued in memory; the parent wizard batch-uploads
 *     them after `createLoad` returns a `loadId`.
 *   - `edit` / `ai-extract` (with `loadId`): each file uploads immediately via
 *     `LoadsService.uploadAttachmentWithProgress`; on success the file moves to
 *     the existing-attachments list above the queue.
 *   - `view`: read-only list of existing attachments with download links.
 *
 * Per-file progress + retry is rendered inline; an individual failure does not
 * invalidate the queued FormArray (errors live in a sibling `error` control),
 * so it never blocks the wizard's Submit/Next gating.
 */
@Component({
  selector: 'app-load-wizard-attachments',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './attachments.component.html',
  styleUrls: ['./attachments.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadWizardAttachmentsComponent implements OnInit, OnChanges {
  @Input({ required: true }) attachmentsGroup!: FormGroup;
  @Input() mode: LoadWizardMode = 'create';
  @Input() loadId: string | null = null;
  @Input() existingAttachments: LoadAttachment[] = [];

  /** Emits when an existing attachment is deleted so the parent can update its LoadDetail cache. */
  @Output() existingDeleted = new EventEmitter<string>();
  /** Emits when immediate-mode upload succeeds so the parent can mirror it into LoadDetail.attachments. */
  @Output() attachmentUploaded = new EventEmitter<LoadAttachment>();

  isDragOver = false;

  /** Local copy of existing attachments so upload-success / delete can mutate without a parent round-trip. */
  existing: LoadAttachment[] = [];

  /** Inline confirm state keyed by existing attachment id. */
  confirmingDeleteId: string | null = null;
  deletingIds = new Set<string>();

  readonly typeOptions: AttachmentTypeOption[] = [
    { value: 'RATE_CONFIRMATION', label: 'Rate Confirmation' },
    { value: 'BOL', label: 'BOL' },
    { value: 'PROOF_OF_DELIVERY', label: 'POD' },
    { value: 'LUMPER', label: 'Lumper Receipt' },
    { value: 'CONFIRMATION', label: 'Confirmation' },
    { value: 'ROADSIDE_MAINTENANCE_RECEIPT', label: 'Roadside Receipt' },
    { value: 'OTHER', label: 'Other' },
  ];

  readonly acceptAttr = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
  private readonly acceptedMimes = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
  ]);
  private readonly acceptedExtensions = ['.pdf', '.png', '.jpg', '.jpeg'];

  constructor(
    private fb: FormBuilder,
    private loadsService: LoadsService,
    private cdr: ChangeDetectorRef,
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.existing = [...(this.existingAttachments || [])];
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['existingAttachments']) {
      this.existing = [...(this.existingAttachments || [])];
      this.cdr.markForCheck();
    }
  }

  // ─── Convenience accessors ──────────────────────────────────────────────

  get queued(): FormArray<FormGroup> {
    return this.attachmentsGroup.get('queued') as FormArray<FormGroup>;
  }

  get isView(): boolean {
    return this.mode === 'view';
  }

  get isCreate(): boolean {
    return this.mode === 'create';
  }

  /** Immediate-upload mode: edit / ai-extract and we already know the loadId. */
  get isImmediate(): boolean {
    return (this.mode === 'edit' || this.mode === 'ai-extract') && !!this.loadId;
  }

  get canUpload(): boolean {
    return !this.isView;
  }

  // ─── Drag & drop ────────────────────────────────────────────────────────

  onDragOver(event: DragEvent): void {
    if (!this.canUpload) return;
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    if (!this.canUpload) return;
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    if (!this.canUpload) return;
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.addFiles(Array.from(files));
    }
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.addFiles(Array.from(input.files));
      input.value = '';
    }
  }

  // ─── Queue management ───────────────────────────────────────────────────

  /** Append files to the parent FormArray, inferring type, optionally kicking off an immediate upload. */
  private addFiles(files: File[]): void {
    const accepted = files.filter((f) => this.isAcceptedFile(f));
    if (accepted.length === 0) return;

    for (const file of accepted) {
      const inferredType = this.inferType(file);
      const group = this.buildAttachmentGroup(file, inferredType);
      this.queued.push(group);
      if (this.isImmediate) {
        this.startUpload(group);
      }
    }
    this.cdr.markForCheck();
  }

  /**
   * Mirror of `LoadWizardComponent.buildAttachment` — kept local so the
   * sub-component can build queued FormGroups without depending on the parent.
   * Both producers MUST emit the same shape or `canProceed` gating breaks.
   */
  private buildAttachmentGroup(file: File, type: LoadAttachmentType): FormGroup {
    return this.fb.group({
      file:      [file, Validators.required],
      type:      [type as LoadAttachmentType, Validators.required],
      notes:     [''],
      uploading: [false],
      uploaded:  [false],
      error:     [null as string | null],
      progress:  [null as number | null],
      uid:       [`att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
    });
  }

  onTypeChange(index: number, newType: LoadAttachmentType): void {
    const g = this.queued.at(index);
    if (!g) return;
    g.get('type')!.setValue(newType);
    this.cdr.markForCheck();
  }

  onNotesChange(index: number, newNotes: string): void {
    const g = this.queued.at(index);
    if (!g) return;
    g.get('notes')!.setValue(newNotes);
    this.cdr.markForCheck();
  }

  removeQueued(index: number): void {
    this.queued.removeAt(index);
    this.cdr.markForCheck();
  }

  retryUpload(index: number): void {
    const g = this.queued.at(index);
    if (g) this.startUpload(g);
  }

  // ─── Immediate upload (edit / ai-extract) ───────────────────────────────

  private startUpload(group: FormGroup): void {
    if (!this.loadId) return;
    const file = group.get('file')!.value as File;
    const type = group.get('type')!.value as LoadAttachmentType;
    const notesRaw = group.get('notes')!.value as string | null | undefined;
    const notes = notesRaw ? notesRaw : undefined;

    group.patchValue({ uploading: true, uploaded: false, error: null, progress: 0 });
    this.cdr.markForCheck();

    this.loadsService
      .uploadAttachmentWithProgress(this.loadId, file, type, notes)
      .subscribe({
        next: (evt) => {
          if (evt.progress != null) {
            group.patchValue({ progress: evt.progress });
          }
          if (evt.result?.data) {
            const att = evt.result.data;
            group.patchValue({ uploading: false, uploaded: true, progress: 100 });
            this.existing = [att, ...this.existing];
            this.attachmentUploaded.emit(att);
            const idx = this.queued.controls.indexOf(group);
            if (idx >= 0) this.queued.removeAt(idx);
          }
          this.cdr.markForCheck();
        },
        error: (err) => {
          const serverMsg = err?.error?.error || err?.error?.message;
          group.patchValue({
            uploading: false,
            uploaded: false,
            progress: null,
            error: serverMsg || 'Upload failed.',
          });
          this.cdr.markForCheck();
        },
      });
  }

  // ─── Existing attachments ───────────────────────────────────────────────

  requestDelete(id: string): void {
    this.confirmingDeleteId = this.confirmingDeleteId === id ? null : id;
    this.cdr.markForCheck();
  }

  cancelDelete(): void {
    this.confirmingDeleteId = null;
    this.cdr.markForCheck();
  }

  confirmDelete(id: string): void {
    if (!this.loadId || this.deletingIds.has(id)) return;
    this.deletingIds.add(id);
    this.cdr.markForCheck();

    this.loadsService.deleteAttachment(this.loadId, id).subscribe({
      next: () => {
        this.existing = this.existing.filter((a) => a.id !== id);
        this.existingDeleted.emit(id);
        this.deletingIds.delete(id);
        this.confirmingDeleteId = null;
        this.cdr.markForCheck();
      },
      error: () => {
        this.deletingIds.delete(id);
        this.cdr.markForCheck();
      },
    });
  }

  // ─── Template helpers ───────────────────────────────────────────────────

  trackByQueuedUid(_i: number, ctrl: FormGroup): string {
    return (ctrl.get('uid')?.value as string) || String(_i);
  }

  trackByAttachmentId(_i: number, att: LoadAttachment): string {
    return att.id;
  }

  asGroup(ctrl: unknown): FormGroup {
    return ctrl as FormGroup;
  }

  getFileIcon(fileOrMime: File | string | null | undefined): string {
    const mime = typeof fileOrMime === 'string'
      ? fileOrMime
      : fileOrMime?.type || '';
    if (!mime) return 'insert_drive_file';
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'picture_as_pdf';
    return 'insert_drive_file';
  }

  formatSize(bytes: number | null | undefined): string {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  typeLabel(type: LoadAttachmentType | null | undefined): string {
    const found = this.typeOptions.find((o) => o.value === type);
    return found ? found.label : (type || '').toString();
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private isAcceptedFile(file: File): boolean {
    const mime = (file.type || '').toLowerCase();
    if (this.acceptedMimes.has(mime)) return true;
    const name = (file.name || '').toLowerCase();
    return this.acceptedExtensions.some((ext) => name.endsWith(ext));
  }

  private inferType(file: File): LoadAttachmentType {
    const name = (file.name || '').toLowerCase();
    if (name.includes('rate') || name.includes('ratecon') || name.includes('confirmation')) {
      return 'RATE_CONFIRMATION';
    }
    if (name.includes('bol') || name.includes('bill of lading')) return 'BOL';
    if (name.includes('pod') || name.includes('proof of delivery')) return 'PROOF_OF_DELIVERY';
    if (name.includes('lumper')) return 'LUMPER';
    return 'OTHER';
  }
}
