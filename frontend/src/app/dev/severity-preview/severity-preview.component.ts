import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SeverityBadgeComponent, Severity } from '../../shared/components/severity-badge/severity-badge.component';
import { GroupedAlertRowComponent } from '../../shared/components/grouped-alert-row/grouped-alert-row.component';

interface PreviewRow {
  severity: Severity;
  category: string;
  message: string;
  count: number;
  countUnit?: string;
  cta: string;
  expandedSample: string[];
}

/**
 * FN-1326 — visual sample for the severity ramp + grouped-alert row.
 * Reachable at `/dev/severity-preview` (dev-only via the route).
 */
@Component({
  selector: 'app-severity-preview',
  standalone: true,
  imports: [CommonModule, SeverityBadgeComponent, GroupedAlertRowComponent],
  templateUrl: './severity-preview.component.html',
  styleUrls: ['./severity-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SeverityPreviewComponent {
  readonly severities: Severity[] = ['critical', 'high', 'medium', 'low'];

  readonly groupedRows: PreviewRow[] = [
    {
      severity: 'critical',
      category: 'Maintenance',
      message: '12 vehicles overdue for preventive maintenance',
      count: 12,
      countUnit: 'vehicles',
      cta: 'View list',
      expandedSample: ['Truck #4421', 'Truck #4502', 'Truck #4519', '+ 9 more']
    },
    {
      severity: 'high',
      category: 'HOS',
      message: '4 drivers approaching the 70-hour limit in the next 24h',
      count: 4,
      countUnit: 'drivers',
      cta: 'Open dispatch',
      expandedSample: ['M. Reyes (3h left)', 'A. Patel (2.5h)', 'J. Cole (1.8h)', 'D. Kim (1.2h)']
    },
    {
      severity: 'medium',
      category: 'Compliance',
      message: '7 drivers missing recent DVIR submissions',
      count: 7,
      countUnit: 'drivers',
      cta: 'Review',
      expandedSample: ['Last DVIR > 24h ago', 'Last DVIR > 24h ago', '...']
    },
    {
      severity: 'low',
      category: 'Insights',
      message: 'Idle-time trending up 8% week-over-week',
      count: 1,
      cta: 'See trend',
      expandedSample: []
    }
  ];

  readonly ungroupedRow: PreviewRow = {
    severity: 'critical',
    category: 'Roadside',
    message: 'Truck #4421 reported breakdown on I-65 mile 142',
    count: 1,
    cta: 'Open call',
    expandedSample: []
  };

  expanded: Record<string, boolean> = {};

  toggle(key: string, value: boolean): void {
    this.expanded = { ...this.expanded, [key]: value };
  }

  onAction(label: string): void {
    // Preview only — surface a console hint so QA can verify wiring.
    // eslint-disable-next-line no-console
    console.log('[severity-preview] primary action:', label);
  }

  onDismiss(label: string): void {
    // eslint-disable-next-line no-console
    console.log('[severity-preview] dismiss:', label);
  }
}
