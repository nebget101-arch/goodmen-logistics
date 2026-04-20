import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';

/** The 4 periods driven by the pill selector. */
export type IntelligencePeriod = 'today' | 'week' | 'month' | 'all';

/**
 * A single metric with its current-period value and (when known) the prior
 * period's value so a trend % delta can be rendered. `previous` is `null`
 * while we don't yet have prior-period data — the card hides its arrow in
 * that case rather than rendering a misleading 0%.
 */
export interface IntelligenceCardMetric {
  current: number;
  previous: number | null;
}

export interface IntelligenceMetrics {
  /** Total gross $ across matching loads. */
  gross: IntelligenceCardMetric;
  /** Count of DELIVERED (or COMPLETED) loads. */
  delivered: IntelligenceCardMetric;
  /** Count of loads currently moving (IN_TRANSIT / EN_ROUTE / PICKED_UP / DISPATCHED). */
  inTransit: IntelligenceCardMetric;
  /** Count of loads needing dispatcher attention (drafts + overdue + missing docs). */
  needsAttention: IntelligenceCardMetric;
}

export interface Trend {
  percent: number;
  direction: 'up' | 'down' | 'flat';
}

/**
 * IntelligencePanelComponent (FN-794)
 *
 * AI-themed summary panel above the loads list. Hosts:
 *  - A pill-shaped period selector (Today / Week / Month / All)
 *  - 4 metric cards — Gross, Delivered, In Transit, Needs Attention
 *
 * The component is a dumb/presentational container: metrics are computed by
 * the parent (loads-dashboard) from the current + previous period query
 * results and passed in via [metrics].
 *
 * Events:
 *  - (periodChange) — user clicked a different pill; parent should re-fetch
 *  - (needsAttentionClick) — user clicked the Needs Attention card; parent
 *    should toggle the matching composite filter (drafts + overdue + missing docs)
 */
@Component({
  selector: 'app-intelligence-panel',
  templateUrl: './intelligence-panel.component.html',
  styleUrls: ['./intelligence-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligencePanelComponent {

  @Input() period: IntelligencePeriod = 'all';
  @Input() metrics: IntelligenceMetrics | null = null;
  @Input() loading = false;
  /** True while the Needs Attention filter is active (card gets a highlight). */
  @Input() needsAttentionActive = false;

  @Output() periodChange = new EventEmitter<IntelligencePeriod>();
  @Output() needsAttentionClick = new EventEmitter<void>();

  readonly periods: Array<{ value: IntelligencePeriod; label: string }> = [
    { value: 'today', label: 'Today' },
    { value: 'week',  label: 'Week'  },
    { value: 'month', label: 'Month' },
    { value: 'all',   label: 'All'   },
  ];

  setPeriod(value: IntelligencePeriod): void {
    if (value === this.period) { return; }
    this.periodChange.emit(value);
  }

  onNeedsAttention(): void {
    this.needsAttentionClick.emit();
  }

  /** Compute a trend (% delta vs previous period) or null when previous is unknown. */
  trend(metric: IntelligenceCardMetric | undefined | null): Trend | null {
    if (!metric || metric.previous == null) { return null; }
    const prev = metric.previous;
    const curr = metric.current || 0;
    if (prev === 0) {
      if (curr === 0) { return { percent: 0, direction: 'flat' }; }
      return { percent: 100, direction: 'up' };
    }
    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    const direction: Trend['direction'] = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
    return { percent: pct, direction };
  }
}
