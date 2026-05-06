import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { Subject, Subscription, timer } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { LoadsService, AiInsight } from '../../../services/loads.service';
import { IntelligencePeriod } from './intelligence-panel.component';

/**
 * IntelligenceInsightsComponent (FN-795 / FN-1297)
 *
 * Rule-based / AI insight list that sits below the 4 metric cards in the
 * Intelligence Panel. Refreshes every 60 seconds and any time the Panel's
 * period changes. Backend contract: FN-793 `/api/loads/ai-insights`.
 */
@Component({
  selector: 'app-intelligence-insights',
  templateUrl: './intelligence-insights.component.html',
  styleUrls: ['./intelligence-insights.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceInsightsComponent implements OnInit, OnChanges, OnDestroy {

  @Input() period: IntelligencePeriod = 'all';

  /** Polling cadence — 60s per FN-784 AC. Exposed for tests. */
  @Input() refreshMs = 60_000;

  /**
   * FN-1353: clicking an insight no longer navigates directly. The parent
   * decides whether to apply a smart filter (mapped types) or fall back to
   * the legacy `insight.href` navigation (unmapped types).
   */
  @Output() insightApply = new EventEmitter<AiInsight>();

  insights: AiInsight[] = [];
  loading = false;
  /** True after the first fetch completes; gates the empty-state message. */
  hasFetched = false;

  private destroy$ = new Subject<void>();
  private pollSub: Subscription | null = null;

  constructor(
    private loadsService: LoadsService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this._startPolling();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // When the period pill changes, refetch immediately and reset the timer.
    if (changes['period'] && !changes['period'].firstChange) {
      this._restartPolling();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.pollSub) { this.pollSub.unsubscribe(); }
  }

  trackById(_i: number, insight: AiInsight): string { return insight.id; }

  /** FN-1353: emit the insight up to the parent so it can apply a filter
   *  (or, for unmapped types, fall back to navigation by href). */
  onInsightClick(insight: AiInsight, event?: Event): void {
    if (event) {
      event.preventDefault();
    }
    this.insightApply.emit(insight);
  }

  iconFor(insight: AiInsight): string {
    switch (insight.type) {
      case 'drafts_ready':      return 'rate_review';
      case 'overdue':           return 'schedule';
      case 'rate_anomaly':      return 'trending_down';
      case 'missing_documents': return 'description';
      case 'driver_idle':       return 'local_shipping';
      case 'high_margin':       return 'trending_up';
      case 'low_margin':        return 'trending_down';
      default:                  return 'auto_awesome';
    }
  }

  // ─── Polling ──────────────────────────────────────────────────────────────

  private _startPolling(): void {
    // Immediate fetch + poll every `refreshMs`. `timer(0, n)` fires at t=0 and
    // every n afterwards.
    this.pollSub = timer(0, this.refreshMs)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() => {
          this.loading = true;
          this.cdr.markForCheck();
          return this.loadsService.getAiInsights(this.period);
        }),
      )
      .subscribe({
        next: (res) => {
          this.insights = res?.data || [];
          this.loading = false;
          this.hasFetched = true;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.hasFetched = true;
          this.cdr.markForCheck();
        },
      });
  }

  private _restartPolling(): void {
    if (this.pollSub) { this.pollSub.unsubscribe(); }
    this._startPolling();
  }
}
