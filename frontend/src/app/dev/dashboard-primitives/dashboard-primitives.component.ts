import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AiSegment } from '../../shared/ai-segmented-control/ai-segmented-control.component';
import { HeroItem } from '../../shared/ai-hero-strip/ai-hero-strip.component';

/**
 * FN-1636 — dev-only showcase for the dashboard AI primitives. Registered on
 * `/dev/dashboard-primitives` (gated by `!environment.production` in the
 * router). Renders every variant called out in the story's acceptance
 * criteria so the primitives can be eyeballed and a11y-swept in isolation.
 */
@Component({
  selector: 'app-dashboard-primitives',
  templateUrl: './dashboard-primitives.component.html',
  styleUrls: ['./dashboard-primitives.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardPrimitivesComponent {
  readonly timeframeSegments: AiSegment[] = [
    { key: 'today', label: 'Today' },
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: 'custom', label: 'Custom' }
  ];
  selectedTimeframe = '7d';

  readonly heroEmpty: HeroItem[] = [];

  readonly heroSingle: HeroItem[] = [
    { severity: 'warning', count: 2, label: 'expiring docs', routerLink: '/drivers' }
  ];

  readonly heroThree: HeroItem[] = [
    { severity: 'info', count: 5, label: 'new loads', routerLink: '/loads' },
    { severity: 'warning', count: 2, label: 'expiring docs', routerLink: '/drivers' },
    { severity: 'critical', count: 1, label: 'HOS violation', routerLink: '/hos' }
  ];

  readonly heroCriticalDominant: HeroItem[] = [
    { severity: 'info', count: 3, label: 'reminders', routerLink: '/loads' },
    { severity: 'critical', count: 4, label: 'overdue invoices', routerLink: '/invoices' }
  ];

  lastAction = '';

  onAck(label: string): void {
    this.lastAction = `acknowledge: ${label}`;
    // eslint-disable-next-line no-console
    console.log('[dashboard-primitives] acknowledge', label);
  }

  onSnooze(label: string): void {
    this.lastAction = `snooze: ${label}`;
    // eslint-disable-next-line no-console
    console.log('[dashboard-primitives] snooze', label);
  }
}
