import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';

/**
 * FN-1353 — Pipeline pill.
 *
 * Segmented progress indicator that visualizes a load's current pipeline stage.
 * Five fixed segments in this order:
 *
 *   Dispatched → In Transit → Delivered → Invoiced → Funded
 *
 * The "highest reached" segment is computed from the combined
 * (loadStatus, billingStatus) pair (see PIPELINE_STAGES). Reached segments are
 * filled with `--ai-accent-success`; the current (last reached) segment gets a
 * subtle glow; unreached segments are muted (`--ai-text-faint`).
 *
 * Cancelled state (load or billing CANCELLED): all segments are greyed and a
 * diagonal slash overlay is rendered.
 */

export type PipelineStageKey =
  | 'dispatched'
  | 'in_transit'
  | 'delivered'
  | 'invoiced'
  | 'funded';

export interface PipelineStage {
  key: PipelineStageKey;
  label: string;
}

export const PIPELINE_STAGES: ReadonlyArray<PipelineStage> = [
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'invoiced',   label: 'Invoiced' },
  { key: 'funded',     label: 'Funded' },
];

@Component({
  selector: 'app-pipeline-pill',
  templateUrl: './pipeline-pill.component.html',
  styleUrls: ['./pipeline-pill.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PipelinePillComponent implements OnChanges {
  @Input() loadStatus: string | null | undefined = null;
  @Input() billingStatus: string | null | undefined = null;

  readonly stages = PIPELINE_STAGES;

  /** Index of the highest-reached stage (-1 if none reached). */
  reachedIndex = -1;
  /** True when load or billing is cancelled — overrides reachedIndex visuals. */
  cancelled = false;
  /** Pre-computed aria-label string. */
  ariaLabel = '';

  ngOnChanges(_: SimpleChanges): void {
    this.recompute();
  }

  trackByKey(_i: number, stage: PipelineStage): string {
    return stage.key;
  }

  /** True when this segment index is at-or-below the highest reached stage. */
  isReached(idx: number): boolean {
    return !this.cancelled && idx <= this.reachedIndex;
  }

  /** True when this is the latest reached segment (gets glow + dot). */
  isCurrent(idx: number): boolean {
    return !this.cancelled && idx === this.reachedIndex;
  }

  private recompute(): void {
    const ls = (this.loadStatus || '').toUpperCase();
    const bs = (this.billingStatus || '').toUpperCase();

    // CANCELLED handling — accept both CANCELLED / CANCELED variants.
    const isCancelled =
      ls === 'CANCELLED' || ls === 'CANCELED' ||
      bs === 'CANCELLED' || bs === 'CANCELED';

    if (isCancelled) {
      this.cancelled = true;
      this.reachedIndex = -1;
      this.ariaLabel = 'Pipeline: Cancelled';
      return;
    }

    this.cancelled = false;

    let idx = -1;
    // Dispatched reached if loadStatus in {DISPATCHED, EN_ROUTE, PICKED_UP, IN_TRANSIT, DELIVERED}.
    if (
      ls === 'DISPATCHED' ||
      ls === 'EN_ROUTE'   ||
      ls === 'PICKED_UP'  ||
      ls === 'IN_TRANSIT' ||
      ls === 'DELIVERED'
    ) {
      idx = 0;
    }
    // In Transit reached if loadStatus in {EN_ROUTE, PICKED_UP, IN_TRANSIT, DELIVERED}.
    if (ls === 'EN_ROUTE' || ls === 'PICKED_UP' || ls === 'IN_TRANSIT' || ls === 'DELIVERED') {
      idx = 1;
    }
    // Delivered reached if loadStatus === DELIVERED.
    if (ls === 'DELIVERED') {
      idx = 2;
    }
    // Invoiced reached if billingStatus in {INVOICED, SENT_TO_FACTORING, FUNDED, PAID}.
    if (
      bs === 'INVOICED'           ||
      bs === 'SENT_TO_FACTORING'  ||
      bs === 'FUNDED'             ||
      bs === 'PAID'
    ) {
      idx = Math.max(idx, 3);
    }
    // Funded reached if billingStatus in {FUNDED, PAID}.
    if (bs === 'FUNDED' || bs === 'PAID') {
      idx = 4;
    }

    this.reachedIndex = idx;
    if (idx < 0) {
      this.ariaLabel = `Pipeline: not started (0 of ${this.stages.length})`;
    } else {
      this.ariaLabel = `Pipeline: ${this.stages[idx].label} (${idx + 1} of ${this.stages.length})`;
    }
  }
}
