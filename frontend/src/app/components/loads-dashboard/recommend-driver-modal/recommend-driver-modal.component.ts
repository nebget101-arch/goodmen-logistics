import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import {
  LoadsService,
  RecommendDriverCandidate,
} from '../../../services/loads.service';
import { LoadDetail } from '../../../models/load-dashboard.model';

/**
 * FN-1439 — Suggest-Driver modal for the dispatch-board load drawer.
 *
 * Calls `POST /api/loads/:id/recommend-driver` (FN-1438 backend → FN-1437 AI),
 * shows top candidates with rationale, and on "Assign" patches the load with
 * the chosen driver + AI rationale via the existing `updateLoad` endpoint.
 */
@Component({
  selector: 'app-recommend-driver-modal',
  templateUrl: './recommend-driver-modal.component.html',
  styleUrls: ['./recommend-driver-modal.component.scss'],
})
export class RecommendDriverModalComponent implements OnChanges {
  @Input() open = false;
  @Input() loadId: string | null = null;

  /**
   * The currently-loaded LoadDetail. Required when assigning so we can build
   * the existing update payload (status, billing, stops, etc.) without
   * regressing other fields. The drawer owns the detail and passes it in.
   */
  @Input() loadDetail: LoadDetail | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() manualAssign = new EventEmitter<void>();
  /** Emits the refreshed LoadDetail returned by the assignment endpoint. */
  @Output() assigned = new EventEmitter<LoadDetail>();

  loading = false;
  errorMessage = '';
  candidates: RecommendDriverCandidate[] = [];
  reasoning = '';

  /** Driver id currently being assigned (used for per-row spinner + disabling). */
  assigningDriverId: string | null = null;

  constructor(private loadsService: LoadsService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['open'] || changes['loadId']) && this.open && this.loadId) {
      this.fetchCandidates(this.loadId);
    }
    if (changes['open'] && !this.open) {
      this.reset();
    }
  }

  private reset(): void {
    this.loading = false;
    this.errorMessage = '';
    this.candidates = [];
    this.reasoning = '';
    this.assigningDriverId = null;
  }

  private fetchCandidates(loadId: string): void {
    this.loading = true;
    this.errorMessage = '';
    this.candidates = [];
    this.reasoning = '';
    this.loadsService.recommendDriver(loadId).subscribe({
      next: (res) => {
        this.loading = false;
        this.candidates = Array.isArray(res?.candidates) ? res.candidates : [];
        this.reasoning = res?.reasoning || '';
      },
      error: () => {
        this.loading = false;
        // The AC explicitly maps an AI failure to the "no suggestions"
        // empty state with a manual-assign link, so we surface a soft
        // empty rather than a hard error banner.
        this.candidates = [];
        this.errorMessage = '';
      },
    });
  }

  scoreLabel(score: number): string {
    if (score == null || !Number.isFinite(score)) return '';
    const pct = Math.round(score * 100);
    return `${Math.max(0, Math.min(100, pct))}%`;
  }

  hosLabel(hours: number): string {
    if (hours == null || !Number.isFinite(hours)) return '—';
    return `${hours.toFixed(1)}h`;
  }

  distanceLabel(miles: number): string {
    if (miles == null || !Number.isFinite(miles)) return '—';
    return `${Math.round(miles)} mi`;
  }

  trackByDriverId(_i: number, c: RecommendDriverCandidate): string {
    return c.driverId;
  }

  onAssign(candidate: RecommendDriverCandidate): void {
    if (!this.loadId || !this.loadDetail || this.assigningDriverId) return;
    this.assigningDriverId = candidate.driverId;
    this.errorMessage = '';

    const detail = this.loadDetail;
    const stops = (detail.stops || []).map((s, i) => ({
      ...s,
      sequence: s.sequence ?? i + 1,
    }));
    const payload: Record<string, unknown> = {
      status: detail.status || 'DRAFT',
      billingStatus: detail.billing_status || 'PENDING',
      brokerId: detail.broker_id || null,
      brokerName: detail.broker_name || null,
      poNumber: detail.po_number || null,
      rate: detail.rate != null ? Number(detail.rate) : 0,
      notes: detail.notes || null,
      driverId: candidate.driverId,
      truckId: detail.truck_id || null,
      trailerId: detail.trailer_id || null,
      stops,
      // FN-1431 contract: assignment endpoint persists the AI rationale
      // (FN-1438 wires the field on the backend).
      assignmentSource: 'ai',
      assignmentRationale: candidate.rationale,
      assignmentScore: candidate.score,
    };

    this.loadsService.updateLoad(this.loadId, payload).subscribe({
      next: (res) => {
        this.assigningDriverId = null;
        const refreshed: LoadDetail = res?.data || detail;
        this.assigned.emit(refreshed);
      },
      error: (err: any) => {
        this.assigningDriverId = null;
        this.errorMessage =
          err?.error?.error || err?.error?.message || 'Assignment failed.';
      },
    });
  }

  onClose(): void {
    if (this.assigningDriverId) return;
    this.close.emit();
  }

  onManualAssign(): void {
    if (this.assigningDriverId) return;
    this.manualAssign.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.onClose();
  }
}
