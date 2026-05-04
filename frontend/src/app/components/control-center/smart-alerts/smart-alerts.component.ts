import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import {
  SmartAlert,
  SmartAlertActionLink,
  SmartAlertSeverityBucket,
  SmartAlertsService,
  defaultActionFor,
  detailFor,
  severityBucket,
} from '../../../services/smart-alerts.service';
import {
  QuickActionDef,
  QuickActionsComponent,
} from '../quick-actions/quick-actions.component';

const SEVERITY_LABEL: Record<SmartAlertSeverityBucket, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * Map a smart alert to its row-level context (loadId / driverId / vehicleId)
 * — the QuickActions component merges this into each action's queryParams
 * so deep-link routes are pre-filled (FN-1129 AC).
 */
function contextFor(alert: SmartAlert): Record<string, string | number | boolean> {
  if (!alert.subjectId) return {};
  switch (alert.subjectKind) {
    case 'driver':
      return { driverId: alert.subjectId };
    case 'vehicle':
      return { vehicleId: alert.subjectId };
    case 'load':
      return { loadId: alert.subjectId };
    default:
      return {};
  }
}

/**
 * Build the per-alert quick action set. Up to 3 contextual actions; the
 * QuickActions component additionally hides any the user lacks permission
 * for. Action id is what downstream consumers receive on (action) emit.
 */
function quickActionsFor(alert: SmartAlert): QuickActionDef[] {
  switch (alert.type) {
    case 'late_load_risk':
      return [
        {
          id: 'reassign-load',
          label: 'Reassign load',
          icon: '↻',
          routerLink: ['/loads'],
          queryParams: { action: 'reassign' },
          requiredPermission: 'loads.edit',
          variant: 'primary',
        },
        {
          id: 'notify-driver',
          label: 'Notify driver',
          icon: '✉',
          requiredPermission: ['drivers.edit', 'drivers.manage'],
        },
      ];
    case 'hos_imminent':
    case 'fatigue':
      return [
        {
          id: 'notify-driver',
          label: 'Notify driver',
          icon: '✉',
          requiredPermission: ['drivers.edit', 'drivers.manage'],
          variant: 'primary',
        },
        {
          id: 'reassign-load',
          label: 'Reassign load',
          icon: '↻',
          routerLink: ['/loads'],
          queryParams: { action: 'reassign' },
          requiredPermission: 'loads.edit',
        },
      ];
    case 'inspection_overdue':
      return [
        {
          id: 'schedule-maintenance',
          label: 'Schedule maintenance',
          icon: '⚙',
          routerLink: ['/work-orders', 'new'],
          requiredPermission: 'work_orders.create',
          variant: 'primary',
        },
      ];
    default:
      return [];
  }
}

interface SmartAlertView {
  id: string;
  title: string;
  detail: string;
  severity: number;
  bucket: SmartAlertSeverityBucket;
  bucketLabel: string;
  action: SmartAlertActionLink | null;
  quickActions: QuickActionDef[];
  context: Record<string, string | number | boolean>;
  raw: SmartAlert;
}

@Component({
  selector: 'app-smart-alerts',
  standalone: true,
  imports: [CommonModule, RouterModule, QuickActionsComponent],
  templateUrl: './smart-alerts.component.html',
  styleUrls: ['./smart-alerts.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SmartAlertsComponent implements OnInit, OnDestroy {
  /** Pre-computed view models for the top 5 alerts. */
  topAlerts: SmartAlertView[] = [];
  loading = true;
  errorMessage: string | null = null;
  /** IDs currently being dismissed (used to disable the button + show pending). */
  dismissing = new Set<string>();

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly smartAlerts: SmartAlertsService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.smartAlerts.startLiveUpdates();
    this.smartAlerts.alerts$
      .pipe(takeUntil(this.destroy$))
      .subscribe((all) => {
        this.topAlerts = all.slice(0, 5).map((a) => this.toView(a));
        this.cdr.markForCheck();
      });
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  retry(): void {
    this.fetch();
  }

  dismiss(alertId: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (this.dismissing.has(alertId)) return;
    this.dismissing.add(alertId);
    this.cdr.markForCheck();

    this.smartAlerts
      .dismiss(alertId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.dismissing.delete(alertId);
          this.cdr.markForCheck();
        },
        error: () => {
          // Optimistic removal already happened in the service. If the POST
          // failed, surface a soft error and let the WS feed reconcile state
          // on the next snapshot push (or the next manual retry).
          this.dismissing.delete(alertId);
          this.errorMessage = 'Dismissal could not be saved. The alert may reappear.';
          this.cdr.markForCheck();
        },
      });
  }

  trackById(_index: number, alert: SmartAlertView): string {
    return alert.id;
  }

  // Bound to <app-quick-actions> (action). Router navigation already happens
  // via routerLink; this hook exists for non-routing actions and future
  // telemetry without changing the component's public surface.
  onQuickAction(_event: { action: QuickActionDef; queryParams: Record<string, string | number | boolean> }): void {
    // no-op for now
  }

  private toView(alert: SmartAlert): SmartAlertView {
    const bucket = severityBucket(alert.severity);
    return {
      id: alert.id,
      title: alert.title,
      detail: detailFor(alert),
      severity: Math.round(Number(alert.severity) || 0),
      bucket,
      bucketLabel: SEVERITY_LABEL[bucket],
      action: defaultActionFor(alert),
      quickActions: quickActionsFor(alert),
      context: contextFor(alert),
      raw: alert,
    };
  }

  private fetch(): void {
    this.loading = true;
    this.errorMessage = null;
    this.cdr.markForCheck();

    this.smartAlerts
      .fetch()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.errorMessage =
            'Smart Alerts unavailable right now. Try refreshing in a moment.';
          this.cdr.markForCheck();
        },
      });
  }
}
