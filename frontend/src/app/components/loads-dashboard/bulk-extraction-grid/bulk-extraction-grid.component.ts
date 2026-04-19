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
 * Tracks each PDF through extract -> (auto-approve | draft) -> done/failed.
 */
export type FileExtractionStatus = 'QUEUED' | 'EXTRACTING' | 'CREATING' | 'SUCCESS' | 'FAILED';

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

  private destroyed = false;

  constructor(
    private loadsService: LoadsService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.rows = this.files.map((file) => ({
      file,
      status: 'QUEUED' as FileExtractionStatus,
      autoApproved: false,
      load: null,
      extraction: null,
      errorMessage: ''
    }));
    this.startProcessing();
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

  get successCount(): number {
    return this.rows.filter((r) => r.status === 'SUCCESS').length;
  }

  get totalCount(): number {
    return this.rows.length;
  }

  get processedCount(): number {
    return this.rows.filter((r) => r.status === 'SUCCESS' || r.status === 'FAILED').length;
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
              row.status = 'SUCCESS';
              row.autoApproved = shouldAutoApprove;
              row.load = createRes?.data || null;
              this.cdr.markForCheck();
              resolve();
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
    if (!row || row.status !== 'FAILED') return;

    row.status = 'QUEUED';
    row.errorMessage = '';
    row.extraction = null;
    row.load = null;
    row.autoApproved = false;
    this.cdr.markForCheck();

    await this.processFile(row);

    // Recheck completion state
    const allDone = this.rows.every((r) => r.status === 'SUCCESS' || r.status === 'FAILED');
    if (allDone && !this.processing) {
      this.completed = true;
    }
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
