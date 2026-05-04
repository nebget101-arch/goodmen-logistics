import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ReportAnomaly, ReportAnomalySeverity } from '../../reports.models';

const SEVERITY_ICON: Record<ReportAnomalySeverity, string> = {
  info: 'info',
  warning: 'warning',
  critical: 'priority_high'
};

@Component({
  selector: 'app-report-anomalies',
  templateUrl: './report-anomalies.component.html',
  styleUrls: ['./report-anomalies.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReportAnomaliesComponent {
  @Input() anomalies: ReportAnomaly[] | null | undefined = [];

  private readonly dismissed = new Set<string>();

  get visibleAnomalies(): ReportAnomaly[] {
    const list = Array.isArray(this.anomalies) ? this.anomalies : [];
    return list.filter((a) => !this.dismissed.has(this.keyFor(a)));
  }

  trackByKey = (_: number, anomaly: ReportAnomaly): string => this.keyFor(anomaly);

  iconFor(severity: ReportAnomalySeverity): string {
    return SEVERITY_ICON[severity] ?? 'info';
  }

  ariaLabelFor(anomaly: ReportAnomaly): string {
    const parts: string[] = [`${anomaly.severity} alert for ${anomaly.metric}`];
    if (typeof anomaly.deltaPct === 'number' && Number.isFinite(anomaly.deltaPct)) {
      const pct = (anomaly.deltaPct * 100).toFixed(1);
      const direction = anomaly.deltaPct >= 0 ? 'up' : 'down';
      parts.push(`${direction} ${Math.abs(Number(pct))}%`);
    }
    if (anomaly.context) parts.push(anomaly.context);
    return parts.join(', ');
  }

  formatDelta(deltaPct: number | undefined | null): string {
    if (typeof deltaPct !== 'number' || !Number.isFinite(deltaPct)) return '';
    const pct = (deltaPct * 100).toFixed(1);
    const sign = deltaPct >= 0 ? '+' : '';
    return `${sign}${pct}%`;
  }

  dismiss(anomaly: ReportAnomaly): void {
    this.dismissed.add(this.keyFor(anomaly));
  }

  private keyFor(anomaly: ReportAnomaly): string {
    return `${anomaly.severity}|${anomaly.metric}|${anomaly.value}|${anomaly.deltaPct}`;
  }
}
