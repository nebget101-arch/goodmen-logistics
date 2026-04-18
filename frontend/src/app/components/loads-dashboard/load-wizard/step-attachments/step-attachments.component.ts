import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnInit
} from '@angular/core';
import { LoadAttachmentType } from '../../../../models/load-dashboard.model';

/** Shape of a single pending attachment managed by this step. */
export interface WizardAttachment {
  file: File;
  type: LoadAttachmentType;
  notes: string;
  /** Upload progress 0–100; null means not started. */
  uploadProgress: number | null;
  /** Unique ID for trackBy. */
  uid: string;
}

/** Dropdown option for attachment type. */
interface AttachmentTypeOption {
  value: LoadAttachmentType;
  label: string;
}

/**
 * FN-736 -- Step 4 (Attachments) of the Load Wizard.
 *
 * Features:
 *  - HTML5 drag-and-drop multi-file upload zone
 *  - Per-file metadata: type dropdown, notes, remove
 *  - AI PDF auto-attach: when an AI-extracted PDF is provided,
 *    it is auto-attached as RATE_CONFIRMATION
 *  - Action buttons: Back, Save & Close, Save & Create Another
 */
@Component({
  selector: 'app-step-attachments',
  templateUrl: './step-attachments.component.html',
  styleUrls: ['./step-attachments.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StepAttachmentsComponent implements OnInit {

  // ── Inputs ──────────────────────────────────────────────────────────────────

  /** Current list of pending attachments. */
  @Input()
  set attachments(value: WizardAttachment[]) {
    this._attachments = value ? [...value] : [];
  }
  get attachments(): WizardAttachment[] { return this._attachments; }

  /** Optional AI-extracted PDF to auto-attach on init. */
  @Input() aiExtractedPdf: File | null = null;

  // ── Outputs ─────────────────────────────────────────────────────────────────

  /** Emits the updated attachments array on every change. */
  @Output() attachmentsChange = new EventEmitter<WizardAttachment[]>();

  /** Emits when Save & Close is clicked. */
  @Output() save = new EventEmitter<void>();

  /** Emits when Save & Create Another is clicked. */
  @Output() saveAndNew = new EventEmitter<void>();

  /** Emits when Back is clicked. */
  @Output() back = new EventEmitter<void>();

  // ── Internal state ──────────────────────────────────────────────────────────

  private _attachments: WizardAttachment[] = [];

  /** True while the user drags files over the drop zone. */
  isDragOver = false;

  /** Static list of type options — stored once, never recreated. */
  readonly typeOptions: AttachmentTypeOption[] = [
    { value: 'RATE_CONFIRMATION', label: 'Rate Confirmation' },
    { value: 'BOL', label: 'BOL' },
    { value: 'PROOF_OF_DELIVERY', label: 'POD' },
    { value: 'LUMPER', label: 'Lumper Receipt' },
    { value: 'ROADSIDE_MAINTENANCE_RECEIPT', label: 'Roadside Receipt' },
    { value: 'OTHER', label: 'Other' }
  ];

  /** Counter for unique IDs. */
  private uidCounter = 0;

  constructor(private cdr: ChangeDetectorRef) {}

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  ngOnInit(): void {
    if (this.aiExtractedPdf && !this.hasAiPdfAlready()) {
      this.addFiles([this.aiExtractedPdf], 'RATE_CONFIRMATION', 'Uploaded via Auto-Create');
    }
  }

  // ── Drag & Drop handlers ────────────────────────────────────────────────────

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.addFiles(Array.from(files));
    }
  }

  // ── File input handler ──────────────────────────────────────────────────────

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.addFiles(Array.from(input.files));
      // Reset the input so the same file can be re-selected
      input.value = '';
    }
  }

  // ── Per-file actions ────────────────────────────────────────────────────────

  onTypeChange(uid: string, newType: LoadAttachmentType): void {
    this._attachments = this._attachments.map(a =>
      a.uid === uid ? { ...a, type: newType } : a
    );
    this.emitAttachments();
  }

  onNotesChange(uid: string, newNotes: string): void {
    this._attachments = this._attachments.map(a =>
      a.uid === uid ? { ...a, notes: newNotes } : a
    );
    this.emitAttachments();
  }

  removeAttachment(uid: string): void {
    this._attachments = this._attachments.filter(a => a.uid !== uid);
    this.emitAttachments();
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  trackByUid(_index: number, item: WizardAttachment): string {
    return item.uid;
  }

  /** Human-readable file size. */
  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Return a Material icon name based on MIME type. */
  getFileIcon(file: File): string {
    const mime = file.type || '';
    if (mime.startsWith('image/')) return 'image';
    if (mime === 'application/pdf') return 'picture_as_pdf';
    if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return 'table_chart';
    if (mime.includes('word') || mime.includes('document')) return 'description';
    return 'insert_drive_file';
  }

  /** Label for the type dropdown display. */
  getTypeLabel(type: LoadAttachmentType): string {
    const found = this.typeOptions.find(o => o.value === type);
    return found ? found.label : type;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private addFiles(
    files: File[],
    defaultType: LoadAttachmentType = 'OTHER',
    defaultNotes: string = ''
  ): void {
    const newItems: WizardAttachment[] = files.map(file => ({
      file,
      type: this.inferType(file, defaultType),
      notes: defaultNotes,
      uploadProgress: null,
      uid: this.nextUid()
    }));
    this._attachments = [...this._attachments, ...newItems];
    this.emitAttachments();
  }

  /** Try to infer attachment type from file name. */
  private inferType(file: File, fallback: LoadAttachmentType): LoadAttachmentType {
    const name = (file.name || '').toLowerCase();
    if (name.includes('rate') || name.includes('confirmation') || name.includes('ratecon')) return 'RATE_CONFIRMATION';
    if (name.includes('bol') || name.includes('bill of lading')) return 'BOL';
    if (name.includes('pod') || name.includes('proof of delivery')) return 'PROOF_OF_DELIVERY';
    if (name.includes('lumper')) return 'LUMPER';
    return fallback;
  }

  private hasAiPdfAlready(): boolean {
    if (!this.aiExtractedPdf) return false;
    return this._attachments.some(
      a => a.file.name === this.aiExtractedPdf!.name && a.type === 'RATE_CONFIRMATION'
    );
  }

  private emitAttachments(): void {
    this.attachmentsChange.emit([...this._attachments]);
    this.cdr.markForCheck();
  }

  private nextUid(): string {
    return `att-${++this.uidCounter}-${Date.now()}`;
  }
}
