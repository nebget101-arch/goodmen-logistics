import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  Inject,
  OnInit,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  GroupedAlertRowComponent,
  GroupedAlertAction
} from '../../../shared/components/grouped-alert-row/grouped-alert-row.component';
import {
  Severity,
  SeverityBadgeComponent
} from '../../../shared/components/severity-badge/severity-badge.component';
import { ApiService } from '../../../services/api.service';

type WindowFilter = 'today' | '7d' | '30d';
type SeverityFilter = 'all' | Severity;

interface ActionQueueTarget {
  id: string;
  label: string;
  route: string | null;
  raw_alert_id?: string;
}

interface ActionQueuePrimaryAction {
  label: string;
  action_id: string;
  payload?: any;
}

interface ActionQueueGroup {
  id: string;
  source: 'smart' | 'compliance';
  severity: Severity;
  category: string;
  message: string;
  count: number;
  latest_at: string;
  targets: ActionQueueTarget[];
  primary_action?: ActionQueuePrimaryAction | null;
}

interface ActionQueueResponse {
  groups: ActionQueueGroup[];
  total: number;
  window: string;
  severity: string;
  generatedAt: string;
  upstreamErrors?: { source: string; error: string }[];
}

interface ActionQueueRowState {
  group: ActionQueueGroup;
  expanded: boolean;
  selectedTargetIds: Set<string>;
  busy: boolean;
}

@Component({
  selector: 'app-action-queue',
  standalone: true,
  imports: [CommonModule, FormsModule, GroupedAlertRowComponent, SeverityBadgeComponent],
  templateUrl: './action-queue.component.html',
  styleUrls: ['./action-queue.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActionQueueComponent implements OnInit {
  loading = true;
  error: string | null = null;
  upstreamWarning = false;

  windowFilter: WindowFilter = '7d';
  severityFilter: SeverityFilter = 'all';

  rows: ActionQueueRowState[] = [];
  total = 0;
  generatedAt: string | null = null;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly api: ApiService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.fetch();
  }

  fetch(): void {
    this.loading = true;
    this.error = null;
    this.upstreamWarning = false;

    this.api
      .getActionQueue({ window: this.windowFilter, severity: this.severityFilter })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data: ActionQueueResponse) => {
          const previousState = new Map(this.rows.map((r) => [r.group.id, r]));
          const groups = Array.isArray(data?.groups) ? data.groups : [];
          this.rows = groups.map((g) => {
            const prior = previousState.get(g.id);
            return {
              group: g,
              expanded: prior?.expanded ?? false,
              selectedTargetIds: new Set<string>(),
              busy: false
            };
          });
          this.total = Number.isFinite(data?.total) ? data.total : groups.length;
          this.generatedAt = data?.generatedAt || null;
          this.upstreamWarning = !!(data?.upstreamErrors && data.upstreamErrors.length);
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[action-queue] load failed:', err);
          this.error = 'Could not load action queue. Try again in a moment.';
          this.loading = false;
          this.cdr.markForCheck();
        }
      });
  }

  onWindowChange(next: WindowFilter): void {
    if (next === this.windowFilter) return;
    this.windowFilter = next;
    this.fetch();
  }

  onSeverityChange(next: SeverityFilter): void {
    if (next === this.severityFilter) return;
    this.severityFilter = next;
    this.fetch();
  }

  refresh(): void {
    this.fetch();
  }

  trackByGroupId(_: number, row: ActionQueueRowState): string {
    return row.group.id;
  }

  buildPrimaryAction(group: ActionQueueGroup): GroupedAlertAction | null {
    if (!group.primary_action) return null;
    return { label: group.primary_action.label, ariaLabel: `${group.primary_action.label} — ${group.message}` };
  }

  onPrimaryAction(row: ActionQueueRowState): void {
    const action = row.group.primary_action;
    if (!action) return;

    if (action.action_id === 'open' && action.payload?.route) {
      this.router.navigateByUrl(action.payload.route);
      return;
    }

    if (action.action_id === 'view' && action.payload?.subjectKind && action.payload?.subjectId) {
      const route = this.routeForSubject(action.payload.subjectKind, action.payload.subjectId);
      if (route) {
        this.router.navigateByUrl(route);
        return;
      }
    }

    // Fallback: expand the group so the user can pick a target.
    row.expanded = true;
    this.cdr.markForCheck();
  }

  onExpandedChange(row: ActionQueueRowState, expanded: boolean): void {
    row.expanded = expanded;
    if (!expanded) row.selectedTargetIds = new Set<string>();
    this.cdr.markForCheck();
  }

  isTargetSelected(row: ActionQueueRowState, targetId: string): boolean {
    return row.selectedTargetIds.has(targetId);
  }

  toggleTarget(row: ActionQueueRowState, targetId: string, checked: boolean): void {
    if (checked) row.selectedTargetIds.add(targetId);
    else row.selectedTargetIds.delete(targetId);
    this.cdr.markForCheck();
  }

  isAllSelected(row: ActionQueueRowState): boolean {
    return row.group.targets.length > 0 && row.selectedTargetIds.size === row.group.targets.length;
  }

  toggleSelectAll(row: ActionQueueRowState, checked: boolean): void {
    row.selectedTargetIds = checked
      ? new Set(row.group.targets.map((t) => t.id))
      : new Set<string>();
    this.cdr.markForCheck();
  }

  openTarget(target: ActionQueueTarget): void {
    if (target.route) this.router.navigateByUrl(target.route);
  }

  dismissGroup(row: ActionQueueRowState): void {
    if (row.busy) return;
    row.busy = true;
    this.cdr.markForCheck();

    this.api
      .dismissActionQueueGroup({ groupId: row.group.id })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.removeRow(row.group.id);
        },
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[action-queue] dismiss group failed:', err);
          row.busy = false;
          this.error = 'Could not dismiss alert group. Try again in a moment.';
          this.cdr.markForCheck();
        }
      });
  }

  dismissSelected(row: ActionQueueRowState): void {
    if (row.busy || row.selectedTargetIds.size === 0) return;
    row.busy = true;
    this.cdr.markForCheck();

    const targetIds = Array.from(row.selectedTargetIds);
    const remaining = row.group.targets.filter((t) => !row.selectedTargetIds.has(t.id));

    this.api
      .dismissActionQueueGroup({ groupId: row.group.id, targetIds })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (remaining.length === 0) {
            this.removeRow(row.group.id);
            return;
          }
          row.group = {
            ...row.group,
            targets: remaining,
            count: remaining.length
          };
          row.selectedTargetIds = new Set<string>();
          row.busy = false;
          this.total = Math.max(0, this.total - targetIds.length);
          this.cdr.markForCheck();
        },
        error: (err) => {
          // eslint-disable-next-line no-console
          console.error('[action-queue] dismiss targets failed:', err);
          row.busy = false;
          this.error = 'Could not dismiss selected items. Try again in a moment.';
          this.cdr.markForCheck();
        }
      });
  }

  private removeRow(groupId: string): void {
    const removed = this.rows.find((r) => r.group.id === groupId);
    this.rows = this.rows.filter((r) => r.group.id !== groupId);
    if (removed) this.total = Math.max(0, this.total - removed.group.count);
    this.cdr.markForCheck();
  }

  private routeForSubject(kind: string, id: string): string | null {
    if (!id) return null;
    if (kind === 'driver') return `/drivers/${id}`;
    if (kind === 'vehicle') return `/vehicles/${id}`;
    if (kind === 'load') return `/loads/${id}`;
    return null;
  }
}
