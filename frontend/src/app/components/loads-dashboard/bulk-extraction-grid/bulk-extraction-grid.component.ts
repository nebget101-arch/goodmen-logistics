import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  OnDestroy
} from '@angular/core';
import { LoadsService } from '../../../services/loads.service';
import { LoadAiEndpointExtraction, LoadDetail } from '../../../models/load-dashboard.model';

/**
 * Per-file extraction status used by the grid rows.
 * Tracks each PDF through extract -> (auto-approve | draft) -> done/partial/failed.
 *
 * PARTIAL_SUCCESS (FN-1085): load was created but the source PDF failed to
 * upload as a RATE_CONFIRMATION attachment. The load link is still surfaced so
 * the user can open it and attach the PDF manually.
 */
export type FileExtractionStatus =
  | 'QUEUED'
  | 'EXTRACTING'
  | 'CREATING'
  | 'ATTACHING'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'FAILED';

export interface FileExtractionRow {
  file: File;
  status: FileExtractionStatus;
  /** Whether the extraction was auto-approved (created as NEW) or saved as DRAFT. */
  autoApproved: boolean;
  /** Resulting load (set after successful creation). */
  load: LoadDetail | null;
  /** Extraction data returned by the AI endpoint. */
  extraction: LoadAiEndpointExtraction | null;
  /** Human-readable error message on failure. */
  errorMessage: string;
  /** Attachment-upload error (set when load created but PDF upload failed). */
  attachmentError: string;
}

/**
 * BulkExtractionGridComponent (FN-745)
 *
 * Accepts 2-10 PDFs, processes them sequentially through the AI extraction
 * endpoint, auto-approves high-confidence results, and shows a summary
 * screen when all files are processed.
 *
 * Usage:
 *   <app-bulk-extraction-grid
 *     [files]="pdfFiles"
 *     (close)="onClose()"
 *     (reviewNow)="onReviewNow()">
 *   </app-bulk-extraction-grid>
 */
@Component({
  selector: 'app-bulk-extraction-grid',
  templateUrl: './bulk-extraction-grid.component.html',
  styleUrls: ['./bulk-extraction-grid.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BulkExtractionGridComponent implements OnInit, OnDestroy {
  @Input() files: File[] = [];
  @Output() close = new EventEmitter<void>();
  @Output() reviewNow = new EventEmitter<void>();

  rows: FileExtractionRow[] = [];
  /** True while files are being processed sequentially. */
  processing = false;
  /** True when all files have been processed (success or failure). */
  completed = false;
  /** Index of the file currently being processed (for the progress indicator). */
  currentIndex = 0;
  /** Inline notice shown in the review panel (e.g. file added, max reached). */
  reviewNotice = '';

  private destroyed = false;

  /** Maximum files allowed in a single bulk extraction batch. */
  static readonly MAX_FILES = 10;

  constructor(
    private loadsService: LoadsService,
    private cdr: ChangeDetectorRef
  ) {}

  // FN-1083: review phase — `processing`/`completed` both false while the user
  // is reviewing the queued files. Derived so existing template guards still work.
  get inReview(): boolean {
    return !this.processing && !this.completed;
  }

  ngOnInit(): void {
    this.rows = this.files.map((file) => this.buildRow(file));
    // FN-1083: do NOT auto-start. The user must click "Start extraction" in
    // the review panel — this prevents AI calls from firing on an accidental
    // drop and gives them a chance to remove or add files first.
  }

  private buildRow(file: File): FileExtractionRow {
    return {
      file,
      status: 'QUEUED',
      autoApproved: false,
      load: null,
      extraction: null,
      errorMessage: '',
      attachmentError: ''
    };
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }

  // ── Computed summary values ──────────────────────────────────────────────

  get autoApprovedCount(): number {
    return this.rows.filter((r) => r.status === 'SUCCESS' && r.autoApproved).length;
  }

  get needsReviewCount(): number {
    return this.rows.filter((r) => r.status === 'SUCCESS' && !r.autoApproved).length;
  }

  get failedCount(): number {
    return this.rows.filter((r) => r.status === 'FAILED').length;
  }

  /**
   * FN-1085: rows where the load was created but the source PDF failed to
   * upload as a RATE_CONFIRMATION attachment. Surfaced separately from full
   * SUCCESS so the user knows to attach manually.
   */
  get partialSuccessCount(): number {
    return this.rows.filter((r) => r.status === 'PARTIAL_SUCCESS').length;
  }

  get successCount(): number {
    return this.rows.filter((r) => r.status === 'SUCCESS').length;
  }

  get totalCount(): number {
    return this.rows.length;
  }

  get processedCount(): number {
    return this.rows.filter(
      (r) => r.status === 'SUCCESS' || r.status === 'PARTIAL_SUCCESS' || r.status === 'FAILED'
    ).length;
  }

  get progressPercent(): number {
    return this.totalCount > 0 ? Math.round((this.processedCount / this.totalCount) * 100) : 0;
  }

  // ── Processing pipeline ─────────────────────────────────────────────────

  /**
   * Process files sequentially. Each file goes through:
   * 1. AI extraction (POST /api/loads/ai-extract)
   * 2. If confident enough to auto-approve -> create load with status NEW
   * 3. Otherwise -> create as DRAFT with needs_review flag
   */
  async startProcessing(): Promise<void> {
    this.processing = true;
    this.completed = false;
    this.cdr.markForCheck();

    for (let i = 0; i < this.rows.length; i++) {
      if (this.destroyed) return;
      this.currentIndex = i;
      await this.processFile(this.rows[i]);
      this.cdr.markForCheck();
    }

    this.processing = false;
    this.completed = true;
    this.cdr.markForCheck();
  }

  private processFile(row: FileExtractionRow): Promise<void> {
    return new Promise<void>((resolve) => {
      row.status = 'EXTRACTING';
      this.cdr.markForCheck();

      this.loadsService.aiExtractFromPdf(row.file).subscribe({
        next: (res) => {
          const data = res?.data;
          if (!data) {
            row.status = 'FAILED';
            row.errorMessage = 'Extraction returned no data.';
            this.cdr.markForCheck();
            resolve();
            return;
          }

          row.extraction = data;

          // Determine auto-approve eligibility based on confidence scores
          const shouldAutoApprove = this.canAutoApprove(data);
          row.status = 'CREATING';
          this.cdr.markForCheck();

          // Build load payload from extraction
          const payload = this.buildLoadPayload(data, shouldAutoApprove);

          this.loadsService.createLoad(payload).subscribe({
            next: (createRes) => {
              const createdLoad = createRes?.data || null;
              row.autoApproved = shouldAutoApprove;
              row.load = createdLoad;

              // FN-1085: upload the source PDF as a RATE_CONFIRMATION
              // attachment. Mirrors LoadWizardComponent.submitCreate's
              // ai-extract path so bulk-created loads also have the rate
              // confirmation attached for downstream review.
              if (!createdLoad?.id) {
                row.status = 'FAILED';
                row.errorMessage = 'Load created but no ID returned.';
                this.cdr.markForCheck();
                resolve();
                return;
              }

              row.status = 'ATTACHING';
              this.cdr.markForCheck();

              this.loadsService
                .uploadAttachment(createdLoad.id, row.file, 'RATE_CONFIRMATION')
                .subscribe({
                  next: () => {
                    row.status = 'SUCCESS';
                    this.cdr.markForCheck();
                    resolve();
                  },
                  error: (uploadErr) => {
                    // Load created — surface as PARTIAL_SUCCESS so the row
                    // stays visible with its load link, but distinct from
                    // green SUCCESS so the user knows to attach the PDF
                    // manually.
                    row.status = 'PARTIAL_SUCCESS';
                    row.attachmentError =
                      uploadErr?.error?.message ||
                      uploadErr?.message ||
                      'Load created but PDF upload failed — attach manually.';
                    this.cdr.markForCheck();
                    resolve();
                  }
                });
            },
            error: (err) => {
              row.status = 'FAILED';
              row.errorMessage = err?.error?.message || err?.message || 'Failed to create load.';
              this.cdr.markForCheck();
              resolve();
            }
          });
        },
        error: (err) => {
          row.status = 'FAILED';
          row.errorMessage = err?.error?.message || err?.message || 'AI extraction failed.';
          this.cdr.markForCheck();
          resolve();
        }
      });
    });
  }

  /**
   * Determine if the extraction result has high enough confidence
   * to auto-approve (create as NEW instead of DRAFT).
   * Uses confidence scores from the AI endpoint when available.
   */
  private canAutoApprove(data: LoadAiEndpointExtraction): boolean {
    // If there is no confidence object, default to manual review
    if (!data.confidence) return false;

    const conf = data.confidence;
    const threshold = 0.8;

    // Require high confidence on key fields
    const brokerOk = (conf.brokerName ?? 0) >= threshold;
    const rateOk = (conf.rate ?? 0) >= threshold;
    const pickupOk = (conf.pickup ?? 0) >= threshold;
    const deliveryOk = (conf.delivery ?? 0) >= threshold;

    // Must have a rate and all locations confident
    return brokerOk && rateOk && pickupOk && deliveryOk && data.rate != null && data.rate > 0;
  }

  /**
   * Build the load creation payload from AI extraction data.
   */
  private buildLoadPayload(
    data: LoadAiEndpointExtraction,
    autoApprove: boolean
  ): Record<string, unknown> {
    const pickup = data.pickup || { date: null, city: null, state: null, zip: null, address1: null };
    const delivery = data.delivery || { date: null, city: null, state: null, zip: null, address1: null };

    const stops: Array<Record<string, unknown>> = [];

    // Use multi-stop data if available, otherwise fall back to pickup/delivery
    if (data.stops && data.stops.length > 0) {
      data.stops.forEach((s, i) => {
        stops.push({
          stop_type: s.type || (i === 0 ? 'PICKUP' : 'DELIVERY'),
          sequence: s.sequence ?? i + 1,
          stop_date: s.date || null,
          city: s.city || null,
          state: s.state || null,
          zip: s.zip || null,
          address1: s.address1 || null
        });
      });
    } else {
      stops.push({
        stop_type: 'PICKUP',
        sequence: 1,
        stop_date: pickup.date || null,
        city: pickup.city || null,
        state: pickup.state || null,
        zip: pickup.zip || null,
        address1: pickup.address1 || null
      });
      stops.push({
        stop_type: 'DELIVERY',
        sequence: 2,
        stop_date: delivery.date || null,
        city: delivery.city || null,
        state: delivery.state || null,
        zip: delivery.zip || null,
        address1: delivery.address1 || null
      });
    }

    return {
      status: autoApprove ? 'NEW' : 'DRAFT',
      needs_review: !autoApprove,
      broker_name: data.brokerName || null,
      po_number: data.poNumber || data.loadId || data.orderId || data.proNumber || null,
      rate: data.rate != null ? Number(data.rate) : null,
      notes: data.notes || null,
      stops,
      source: 'bulk_ai_extraction'
    };
  }

  // ── Retry logic ─────────────────────────────────────────────────────────

  async retryFile(index: number): Promise<void> {
    const row = this.rows[index];
    // Only FAILED rows are retried. PARTIAL_SUCCESS rows already created a
    // load — retrying would create a duplicate load. The user must attach the
    // PDF manually from the load detail drawer instead.
    if (!row || row.status !== 'FAILED') return;

    row.status = 'QUEUED';
    row.errorMessage = '';
    row.attachmentError = '';
    row.extraction = null;
    row.load = null;
    row.autoApproved = false;
    this.cdr.markForCheck();

    await this.processFile(row);

    // Recheck completion state
    const allDone = this.rows.every(
      (r) => r.status === 'SUCCESS' || r.status === 'PARTIAL_SUCCESS' || r.status === 'FAILED'
    );
    if (allDone && !this.processing) {
      this.completed = true;
    }
    this.cdr.markForCheck();
  }

  // ── Review-phase actions (FN-1083) ──────────────────────────────────────

  /** Start extraction. No-op once processing has begun. */
  onStartExtraction(): void {
    if (!this.inReview || this.rows.length === 0) return;
    this.reviewNotice = '';
    this.startProcessing();
  }

  /** Remove a queued file from the review list. */
  onRemoveReviewFile(index: number): void {
    if (!this.inReview) return;
    if (index < 0 || index >= this.rows.length) return;
    this.rows = this.rows.filter((_, i) => i !== index);
    this.reviewNotice = '';
    if (this.rows.length === 0) {
      // No files left to extract — close the modal so the user can start over.
      this.close.emit();
      return;
    }
    this.cdr.markForCheck();
  }

  /** Drag-drop additional PDFs into the review panel before starting. */
  onReviewDrop(event: DragEvent): void {
    event.preventDefault();
    if (!this.inReview) return;
    const files = event.dataTransfer?.files;
    if (files?.length) this.addReviewFiles(files);
  }

  onReviewDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  /** Click-to-add file input handler in the review panel. */
  onReviewFileInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input?.files) return;
    this.addReviewFiles(input.files);
    input.value = '';
  }

  private addReviewFiles(files: FileList): void {
    const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf');
    if (pdfs.length === 0) {
      this.reviewNotice = 'PDFs only — non-PDF files were skipped.';
      this.cdr.markForCheck();
      return;
    }
    const remaining = Math.max(0, BulkExtractionGridComponent.MAX_FILES - this.rows.length);
    if (remaining === 0) {
      this.reviewNotice = `Maximum ${BulkExtractionGridComponent.MAX_FILES} files. Remove one to add more.`;
      this.cdr.markForCheck();
      return;
    }
    const toAdd = pdfs.slice(0, remaining);
    this.rows = [...this.rows, ...toAdd.map((f) => this.buildRow(f))];
    this.reviewNotice = pdfs.length > remaining
      ? `Added ${toAdd.length} file(s). Maximum ${BulkExtractionGridComponent.MAX_FILES}; ${pdfs.length - remaining} not added.`
      : `Added ${toAdd.length} file(s).`;
    this.cdr.markForCheck();
  }

  // ── UI actions ──────────────────────────────────────────────────────────

  onClose(): void {
    this.close.emit();
  }

  onReviewNow(): void {
    this.reviewNow.emit();
  }

  /** Prevent click events on the modal from propagating to the backdrop. */
  stopPropagation(event: Event): void {
    event.stopPropagation();
  }

  /** Truncate long filenames for display. */
  truncateFilename(name: string, maxLen: number = 35): string {
    if (name.length <= maxLen) return name;
    const ext = name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')) : '';
    const base = name.slice(0, maxLen - ext.length - 3);
    return base + '...' + ext;
  }
}
