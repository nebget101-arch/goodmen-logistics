import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges
} from '@angular/core';
import {
  ApiService,
  InvoiceExtractedLine,
  InvoiceUploadResult
} from '../../services/api.service';

export type RowStatus = 'matched' | 'unmatched' | 'skipped';

export interface ReviewRow {
  id: string;
  sku: string;
  description: string;
  qty: number;
  unitCost: number;
  partId: string | null;
  partName: string | null;
  status: RowStatus;
  quickAddBusy: boolean;
  quickAddError: string;
  applyError: string;
}

export interface AppliedSummary {
  appliedCount: number;
  failedCount: number;
}

/**
 * FN-1491 — InvoiceReviewModal
 *
 * Renders the AI-extracted invoice lines (from FN-1489) for the user to
 * review/edit/skip before applying them to the open receiving ticket.
 *
 * Modal stays mounted while extraction is pending so the host can swap
 * `[extracting]` → `[result]` without remounting (preserves spinner +
 * elapsed counter).
 *
 * Per-row actions:
 *   - Edit SKU/description/qty/unitCost inline.
 *   - Quick Add Part — calls `POST /api/parts` with the row's SKU/desc;
 *     on success the row resolves to `matched` with the new partId.
 *   - Skip — drops the row from the apply set without losing other rows.
 *
 * "Apply N matched lines" issues `POST /api/receiving/:ticketId/lines`
 * for each matched row (sequentially-ish via parallel subscribers; we
 * count successes/failures and emit the summary so the host can refresh
 * the lines table and surface a banner).
 */
@Component({
  selector: 'app-invoice-review-modal',
  templateUrl: './invoice-review-modal.component.html',
  styleUrls: ['./invoice-review-modal.component.css']
})
export class InvoiceReviewModalComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  @Input() extracting = false;
  @Input() result: InvoiceUploadResult | null = null;
  @Input() ticketId: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() applied = new EventEmitter<AppliedSummary>();

  rows: ReviewRow[] = [];
  applying = false;
  errorMsg = '';
  elapsedSec = 0;

  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private api: ApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      if (this.open) {
        this.errorMsg = '';
        if (this.extracting) this.startTimer();
      } else {
        this.stopTimer();
        this.elapsedSec = 0;
      }
    }
    if (changes['extracting']) {
      if (this.extracting && this.open) this.startTimer();
      if (!this.extracting) this.stopTimer();
    }
    if (changes['result'] && this.result) {
      this.hydrate(this.result.extracted.lines);
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  // ── State helpers ──────────────────────────────────────────────────────

  get matchedCount(): number {
    return this.rows.filter((r) => r.status === 'matched' && r.partId).length;
  }

  get unmatchedCount(): number {
    return this.rows.filter((r) => r.status === 'unmatched').length;
  }

  get skippedCount(): number {
    return this.rows.filter((r) => r.status === 'skipped').length;
  }

  get canApply(): boolean {
    return !this.applying && !!this.ticketId && this.matchedCount > 0;
  }

  trackByRow(_i: number, row: ReviewRow): string {
    return row.id;
  }

  // ── Per-row editors ────────────────────────────────────────────────────

  onSkuInput(row: ReviewRow, event: Event): void {
    row.sku = (event.target as HTMLInputElement)?.value ?? '';
    // SKU edit invalidates the AI match — user must re-Quick-Add to resolve.
    if (row.partId) {
      row.partId = null;
      row.partName = null;
      row.status = 'unmatched';
    }
  }

  onDescriptionInput(row: ReviewRow, event: Event): void {
    row.description = (event.target as HTMLInputElement)?.value ?? '';
  }

  onQtyInput(row: ReviewRow, event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement)?.value ?? '');
    row.qty = Number.isFinite(val) ? val : 0;
  }

  onUnitCostInput(row: ReviewRow, event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement)?.value ?? '');
    row.unitCost = Number.isFinite(val) ? val : 0;
  }

  skipRow(row: ReviewRow): void {
    row.status = 'skipped';
    row.applyError = '';
  }

  unskipRow(row: ReviewRow): void {
    row.status = row.partId ? 'matched' : 'unmatched';
  }

  quickAddPart(row: ReviewRow): void {
    const sku = (row.sku || '').trim();
    const description = (row.description || '').trim();
    if (!sku) {
      row.quickAddError = 'SKU is required.';
      return;
    }
    row.quickAddBusy = true;
    row.quickAddError = '';
    this.api
      .createPart({
        sku,
        name: description || sku,
        description,
        is_active: true
      })
      .subscribe({
        next: (res: any) => {
          const part = res?.data ?? res ?? {};
          row.quickAddBusy = false;
          row.partId = part.id ?? null;
          row.partName = part.name ?? description ?? sku;
          row.status = row.partId ? 'matched' : 'unmatched';
          if (!row.partId) {
            row.quickAddError = 'Part created but no id returned.';
          }
        },
        error: (err: any) => {
          row.quickAddBusy = false;
          row.quickAddError =
            err?.error?.error || err?.message || 'Failed to add part.';
        }
      });
  }

  // ── Apply matched lines ────────────────────────────────────────────────

  apply(): void {
    if (!this.canApply || !this.ticketId) return;
    const ticketId = this.ticketId;
    const matched = this.rows.filter((r) => r.status === 'matched' && r.partId);
    if (matched.length === 0) return;

    this.applying = true;
    this.errorMsg = '';
    matched.forEach((r) => (r.applyError = ''));

    let appliedCount = 0;
    let failedCount = 0;
    let settled = 0;

    matched.forEach((row) => {
      const qty = Number(row.qty) > 0 ? Number(row.qty) : 1;
      const unitCost = Number(row.unitCost) >= 0 ? Number(row.unitCost) : undefined;
      this.api.addReceivingLine(ticketId, row.partId!, qty, unitCost).subscribe({
        next: () => {
          appliedCount++;
          settled++;
          if (settled === matched.length) this.finishApply(appliedCount, failedCount);
        },
        error: (err: any) => {
          failedCount++;
          settled++;
          row.applyError =
            err?.error?.error || err?.message || 'Failed to add line.';
          if (settled === matched.length) this.finishApply(appliedCount, failedCount);
        }
      });
    });
  }

  private finishApply(appliedCount: number, failedCount: number): void {
    this.applying = false;
    if (failedCount > 0) {
      this.errorMsg = `${failedCount} line${
        failedCount === 1 ? '' : 's'
      } failed to apply. Edit and retry.`;
    }
    this.applied.emit({ appliedCount, failedCount });
    if (failedCount === 0) {
      this.close();
    }
  }

  close(): void {
    if (this.applying) return;
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  statusLabel(row: ReviewRow): string {
    if (row.status === 'matched') return 'Matched';
    if (row.status === 'skipped') return 'Skipped';
    return 'Unmatched';
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private hydrate(lines: InvoiceExtractedLine[]): void {
    this.rows = (lines || []).map((l, i) => {
      const matchedPartId = l.match?.partId ?? null;
      const sku = l.sku ?? l.match?.sku ?? '';
      return {
        id: `r${i}`,
        sku,
        description: l.description ?? '',
        qty: Number(l.qty) || 0,
        unitCost: Number(l.unitCost) || 0,
        partId: matchedPartId,
        partName: l.match?.name ?? null,
        status: matchedPartId ? 'matched' : 'unmatched',
        quickAddBusy: false,
        quickAddError: '',
        applyError: ''
      };
    });
  }

  private startTimer(): void {
    this.stopTimer();
    this.elapsedSec = 0;
    this.elapsedTimer = setInterval(() => {
      this.elapsedSec += 1;
    }, 1000);
  }

  private stopTimer(): void {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }
}
