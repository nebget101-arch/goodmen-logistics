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
import { Subject, Subscription, interval, timer } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { LoadsService, AiInsight } from '../../../services/loads.service';
import { IntelligencePeriod } from './intelligence-panel.component';

/**
 * IntelligenceInsightsComponent (FN-795)
 *
 * Rule-based / AI insight list that sits below the 4 metric cards in the
 * Intelligence Panel. Refreshes every 60 seconds and any time the Panel's
 * period changes.
 *
 * While FN-793 (backend `/api/loads/ai-insights`) is still being built, the
 * service returns `[]` on 404 so this component degrades to "no insights
 * right now" — no broken UI, no error spam.
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

  @Output() action = new EventEmitter<{ event: string; insight: AiInsight }>();

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

  iconFor(insight: AiInsight): string {
    if (insight.icon) { return insight.icon; }
    switch (insight.type) {
      case 'overdue':      return 'schedule';
      case 'missing_docs': return 'description';
      case 'high_risk':    return 'warning';
      case 'reminder':     return 'notifications';
      case 'billing':      return 'receipt_long';
      case 'driver':       return 'local_shipping';
      default:             return 'auto_awesome';
    }
  }

  onAction(insight: AiInsight): void {
    if (insight.action) {
      this.action.emit({ event: insight.action.event, insight });
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
