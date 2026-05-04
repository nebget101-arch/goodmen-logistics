import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

import {
  InsightsService,
  TrendPoint,
  TrendSeries,
  TrendSeriesId,
  TrendsResponse,
} from '../../../services/insights.service';

type TrendDirection = 'up' | 'down' | 'flat';

interface CardView {
  id: TrendSeriesId;
  label: string;
  description: string;
  icon: 'volume' | 'wrench' | 'clock' | 'fuel';
  unit: '%' | '$' | 'loads' | '';
}

interface CardStats {
  current: number | null;
  previous: number | null;
  delta: number | null;
  direction: TrendDirection | null;
}

interface SparklinePath {
  predicted: string;
  actual: string;
  hasPoints: boolean;
}

@Component({
  selector: 'app-predictive-insights',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './predictive-insights.component.html',
  styleUrls: ['./predictive-insights.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PredictiveInsightsComponent implements OnInit, OnDestroy {
  response: TrendsResponse | null = null;
  loading = true;
  refreshing = false;
  errorMessage: string | null = null;

  readonly cards: CardView[] = [
    {
      id: 'loadVolume',
      label: 'Load volume forecast',
      description: '7-day projected load count',
      icon: 'volume',
      unit: 'loads',
    },
    {
      id: 'maintenance',
      label: 'Maintenance windows',
      description: 'Predicted PM events next 7 days',
      icon: 'wrench',
      unit: '',
    },
    {
      id: 'onTimePct',
      label: 'Projected on-time %',
      description: 'Expected on-time delivery rate',
      icon: 'clock',
      unit: '%',
    },
    {
      id: 'fuelCost',
      label: 'Fuel cost trend',
      description: 'Projected fuel spend (7-day)',
      icon: 'fuel',
      unit: '$',
    },
  ];

  readonly sparklineWidth = 120;
  readonly sparklineHeight = 36;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly insightsService: InsightsService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.fetch(false);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refresh(): void {
    if (this.refreshing) return;
    this.fetch(true);
  }

  trackByCard(_index: number, card: CardView): string {
    return card.id;
  }

  getSeries(id: TrendSeriesId): TrendSeries | null {
    return this.response ? this.response.series[id] : null;
  }

  hasUpstreamError(id: TrendSeriesId): boolean {
    return !!this.response?.upstreamErrors?.some((e) => e.source === id);
  }

  hasData(series: TrendSeries | null): boolean {
    if (!series) return false;
    return (
      series.actual.some((p) => p.value !== null) ||
      series.predicted.some((p) => p.value !== null)
    );
  }

  computeStats(series: TrendSeries | null): CardStats {
    const empty: CardStats = { current: null, previous: null, delta: null, direction: null };
    if (!series) return empty;

    const actuals = series.actual.filter((p): p is TrendPoint & { value: number } => p.value !== null);
    if (actuals.length === 0) return empty;

    const current = actuals[actuals.length - 1].value;
    if (actuals.length === 1) {
      return { current, previous: null, delta: null, direction: null };
    }
    const previous = actuals[0].value;
    const delta = current - previous;
    const direction: TrendDirection = delta > 0.0001 ? 'up' : delta < -0.0001 ? 'down' : 'flat';
    return { current, previous, delta, direction };
  }

  formatValue(stats: CardStats, unit: CardView['unit']): string {
    if (stats.current === null) return '—';
    const v = stats.current;
    if (unit === '%') return `${this.round(v, 1)}%`;
    if (unit === '$') return `$${this.round(v, 2)}`;
    if (unit === 'loads') return `${this.round(v, 0)} loads`;
    return `${this.round(v, 0)}`;
  }

  formatDelta(stats: CardStats, unit: CardView['unit']): string {
    if (stats.delta === null) return '—';
    const sign = stats.delta > 0 ? '+' : '';
    if (unit === '%') return `${sign}${this.round(stats.delta, 1)}pp`;
    if (unit === '$') return `${sign}$${this.round(stats.delta, 2)}`;
    return `${sign}${this.round(stats.delta, 1)}`;
  }

  directionClass(direction: TrendDirection | null, id: TrendSeriesId): string {
    if (!direction || direction === 'flat') return 'is-flat';
    const upIsGood = id === 'loadVolume' || id === 'onTimePct';
    if (direction === 'up') return upIsGood ? 'is-positive' : 'is-negative';
    return upIsGood ? 'is-negative' : 'is-positive';
  }

  directionGlyph(direction: TrendDirection | null): string {
    if (direction === 'up') return '▲';
    if (direction === 'down') return '▼';
    return '■';
  }

  buildSparkline(series: TrendSeries | null): SparklinePath {
    const empty: SparklinePath = { predicted: '', actual: '', hasPoints: false };
    if (!series) return empty;

    const all = [...series.actual, ...series.predicted].map((p) => p.value);
    const numeric = all.filter((v): v is number => v !== null);
    if (numeric.length < 2) return empty;

    const min = Math.min(...numeric);
    const max = Math.max(...numeric);
    const range = max - min || 1;
    const total = all.length;
    const stepX = total > 1 ? this.sparklineWidth / (total - 1) : 0;

    const project = (v: number, i: number): [number, number] => {
      const x = i * stepX;
      const y = this.sparklineHeight - ((v - min) / range) * this.sparklineHeight;
      return [x, y];
    };

    return {
      actual: this.pointsToPath(series.actual.map((p) => p.value), project, 0),
      predicted: this.pointsToPath(series.predicted.map((p) => p.value), project, series.actual.length),
      hasPoints: true,
    };
  }

  private pointsToPath(
    values: Array<number | null>,
    project: (v: number, i: number) => [number, number],
    offset: number,
  ): string {
    let d = '';
    let started = false;
    values.forEach((v, idx) => {
      if (v === null) {
        started = false;
        return;
      }
      const [x, y] = project(v, idx + offset);
      d += `${started ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
      started = true;
    });
    return d.trim();
  }

  private round(value: number, digits: number): string {
    const factor = Math.pow(10, digits);
    return (Math.round(value * factor) / factor).toFixed(digits);
  }

  private fetch(isRefresh: boolean): void {
    this.errorMessage = null;
    if (isRefresh) {
      this.refreshing = true;
    } else {
      this.loading = true;
    }
    this.cdr.markForCheck();

    this.insightsService
      .getTrends({ range: '7d', refresh: isRefresh })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.response = data;
          this.loading = false;
          this.refreshing = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.errorMessage =
            'Trends unavailable right now. Try refreshing in a moment.';
          this.loading = false;
          this.refreshing = false;
          this.cdr.markForCheck();
        },
      });
  }
}
