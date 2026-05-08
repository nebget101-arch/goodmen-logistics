import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  ApiService,
  InvoiceUploadEvent,
  InvoiceUploadResult
} from '../../services/api.service';

const ACCEPT_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf'
]);

const MAX_BYTES = 15 * 1024 * 1024; // 15MB — matches FN-1490 backend cap

/**
 * FN-1491 — InvoiceUploadCard
 *
 * Right-rail card on the warehouse-receiving page. Drag-and-drop, click,
 * or paste-from-clipboard a vendor invoice (image or PDF). Uploads to
 * `POST /api/receiving/:id/invoice` (FN-1490) and emits the AI extraction
 * result (FN-1489) to the host so it can open InvoiceReviewModal.
 *
 * The card itself only owns the upload — the modal owns the review/apply
 * flow. We keep this split so an upload error doesn't trap the user inside
 * a modal, and so the host can decide when to open/close the modal.
 */
@Component({
  selector: 'app-invoice-upload-card',
  templateUrl: './invoice-upload-card.component.html',
  styleUrls: ['./invoice-upload-card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InvoiceUploadCardComponent implements OnDestroy {
  @Input() ticketId: string | null = null;
  @Input() disabled = false;

  @Output() uploadStart = new EventEmitter<void>();
  @Output() extracted = new EventEmitter<InvoiceUploadResult>();
  @Output() uploadError = new EventEmitter<string>();

  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  dragActive = false;
  uploading = false;
  progress = 0;
  errorMsg = '';
  fileName = '';
  thumbUrl: string | null = null;
  hasResult = false;

  private currentUpload?: Subscription;

  constructor(private api: ApiService, private cdr: ChangeDetectorRef) {}

  ngOnDestroy(): void {
    this.currentUpload?.unsubscribe();
    this.releaseThumb();
  }

  get canInteract(): boolean {
    return !!this.ticketId && !this.disabled && !this.uploading;
  }

  triggerPicker(): void {
    if (!this.canInteract) return;
    this.fileInput?.nativeElement.click();
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.startUpload(file);
  }

  onDragOver(e: DragEvent): void {
    if (!this.canInteract) return;
    e.preventDefault();
    e.stopPropagation();
    this.dragActive = true;
    this.cdr.markForCheck();
  }

  onDragLeave(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.dragActive = false;
    this.cdr.markForCheck();
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.dragActive = false;
    if (!this.canInteract) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) this.startUpload(file);
  }

  onPaste(e: ClipboardEvent): void {
    if (!this.canInteract) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          this.startUpload(file);
          return;
        }
      }
    }
  }

  retry(): void {
    this.errorMsg = '';
    this.cdr.markForCheck();
    this.triggerPicker();
  }

  reupload(): void {
    this.hasResult = false;
    this.errorMsg = '';
    this.releaseThumb();
    this.fileName = '';
    this.cdr.markForCheck();
    this.triggerPicker();
  }

  private startUpload(file: File): void {
    if (!this.ticketId) {
      this.errorMsg = 'No active receiving ticket.';
      this.cdr.markForCheck();
      return;
    }
    const validation = this.validate(file);
    if (validation) {
      this.errorMsg = validation;
      this.uploadError.emit(validation);
      this.cdr.markForCheck();
      return;
    }

    this.errorMsg = '';
    this.uploading = true;
    this.hasResult = false;
    this.progress = 0;
    this.fileName = file.name;
    this.releaseThumb();
    this.thumbUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    this.uploadStart.emit();
    this.cdr.markForCheck();

    this.currentUpload?.unsubscribe();
    this.currentUpload = this.api
      .uploadReceivingInvoice(this.ticketId, file)
      .subscribe({
        next: (event: InvoiceUploadEvent) => {
          if (event.kind === 'progress') {
            this.progress = event.progress;
            this.cdr.markForCheck();
            return;
          }
          this.uploading = false;
          this.progress = 100;
          this.hasResult = true;
          this.extracted.emit(event.result);
          this.cdr.markForCheck();
        },
        error: (err: any) => {
          this.uploading = false;
          this.progress = 0;
          this.errorMsg =
            err?.error?.error || err?.message || 'Upload failed. Please try again.';
          this.uploadError.emit(this.errorMsg);
          this.cdr.markForCheck();
        }
      });
  }

  private validate(file: File): string {
    if (file.size > MAX_BYTES) {
      const mb = Math.round(file.size / 1024 / 1024);
      return `File too large (${mb}MB). Max 15MB.`;
    }
    // Some browsers/clipboards report empty type for HEIC; accept by extension fallback.
    if (file.type && !ACCEPT_MIME.has(file.type)) {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const allowedExt = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'pdf'];
      if (!allowedExt.includes(ext)) {
        return `Unsupported file type (${file.type}). Use JPG, PNG, HEIC, WEBP, or PDF.`;
      }
    }
    return '';
  }

  private releaseThumb(): void {
    if (this.thumbUrl) {
      URL.revokeObjectURL(this.thumbUrl);
      this.thumbUrl = null;
    }
  }
}
