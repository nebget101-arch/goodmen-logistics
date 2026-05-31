import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** Status drives the accent strip, hover glow tint, and value emphasis. */
export type KpiStatus = 'good' | 'info' | 'warning' | 'critical';

/** Optional trend chip shown under the value. */
export interface KpiTrend {
  direction: 'up' | 'down' | 'flat';
  /** Human-readable delta, e.g. "+12% vs 7d" or "3 fewer". */
  deltaText: string;
}

/**
 * FN-1636 — dashboard KPI primitive. Used by every KPI cluster
 * (fleet health, loads progress, billing).
 *
 * When `routerLink` is set the whole card renders as an `<a>` and is
 * keyboard-focusable; otherwise it is a non-interactive `<div>`.
 *
 * Visuals: 3px left accent strip in the status color; on hover the card
 * lifts -1px and gains an 8px outer glow tinted by `status`. All colors
 * come from the documented dark-theme palette — no new hex values.
 */
@Component({
  selector: 'app-kpi-card',
  templateUrl: './kpi-card.component.html',
  styleUrls: ['./kpi-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class KpiCardComponent {
  /** Short metric name, e.g. "Active Loads". */
  @Input() label = '';

  /** Primary value. Accepts string or number. */
  @Input() value: string | number = '';

  /** Optional secondary line under the value. */
  @Input() subline = '';

  /** Status tint for the accent strip and hover glow. */
  @Input() status: KpiStatus = 'info';

  /** Optional trend chip. */
  @Input() trend: KpiTrend | null = null;

  /** When set, the whole card becomes a router link. */
  @Input() routerLink: string | unknown[] | null = null;

  /** Composes the screen-reader label from the visible fields. */
  static composeAriaLabel(
    label: string,
    value: string | number,
    subline?: string,
    trend?: KpiTrend | null
  ): string {
    const parts: string[] = [`${label}: ${value}`];
    if (subline) {
      parts.push(subline);
    }
    if (trend) {
      const word =
        trend.direction === 'up' ? 'trending up' : trend.direction === 'down' ? 'trending down' : 'flat';
      parts.push(`${word}, ${trend.deltaText}`);
    }
    return parts.join(', ');
  }

  get ariaLabel(): string {
    return KpiCardComponent.composeAriaLabel(this.label, this.value, this.subline, this.trend);
  }

  /** Material symbol name for the trend arrow. */
  get trendIcon(): string {
    if (!this.trend) {
      return '';
    }
    return this.trend.direction === 'up'
      ? 'trending_up'
      : this.trend.direction === 'down'
      ? 'trending_down'
      : 'trending_flat';
  }
}
