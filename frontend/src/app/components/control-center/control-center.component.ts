import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { Subject, takeUntil } from 'rxjs';

import { DailyBriefingComponent } from './daily-briefing/daily-briefing.component';
import { ActionQueueComponent } from '../dashboard/action-queue/action-queue.component';
import { PredictiveInsightsComponent } from './predictive-insights/predictive-insights.component';
import {
  QuickActionDef,
  QuickActionsComponent,
} from './quick-actions/quick-actions.component';
import {
  defaultLayoutForRole,
  LAYOUT_PRESETS,
  normalizeRole,
  quickActionsForRole,
  RoleKey,
  WidgetId,
} from './role-layouts';
import {
  DashboardLayout,
  DashboardLayoutService,
} from '../../services/dashboard-layout.service';
import { PresetSwitcherComponent } from './preset-switcher/preset-switcher.component';

@Component({
  selector: 'app-control-center',
  standalone: true,
  imports: [
    CommonModule,
    DragDropModule,
    DailyBriefingComponent,
    ActionQueueComponent,
    PredictiveInsightsComponent,
    QuickActionsComponent,
    PresetSwitcherComponent,
  ],
  templateUrl: './control-center.component.html',
  styleUrls: ['./control-center.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ControlCenterComponent implements OnInit, OnDestroy {
  widgets: WidgetId[] = [];
  role: RoleKey = 'dispatcher';
  quickActions: QuickActionDef[] = [];
  loading = true;
  saving = false;
  errorMessage: string | null = null;
  activePresetKey: string | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly layoutService: DashboardLayoutService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.layoutService
      .getLayout()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => this.applyLayout(result),
        error: () => this.fallbackToClientDefault(),
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onDrop(event: CdkDragDrop<WidgetId[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const next = [...this.widgets];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.widgets = next;
    this.persistLayout(next);
  }

  resetToDefault(): void {
    this.saving = true;
    this.errorMessage = null;
    this.cdr.markForCheck();

    this.layoutService
      .resetLayout()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.applyLayout(result);
          this.saving = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.errorMessage = 'Could not reset layout. Try again.';
          this.saving = false;
          this.cdr.markForCheck();
        },
      });
  }

  trackById = (_: number, id: WidgetId): WidgetId => id;

  onPresetApplied(result: DashboardLayout): void {
    this.applyLayout(result);
  }

  onPresetApplyFailed(message: string): void {
    this.errorMessage = message;
    this.cdr.markForCheck();
  }

  private applyLayout(result: DashboardLayout): void {
    this.role = normalizeRole(result.role);
    this.quickActions = quickActionsForRole(this.role);
    this.widgets = result.widgets.length
      ? result.widgets
      : defaultLayoutForRole(this.role);
    this.activePresetKey = matchPresetKey(this.widgets);
    this.loading = false;
    this.errorMessage = null;
    this.cdr.markForCheck();
  }

  private fallbackToClientDefault(): void {
    this.quickActions = quickActionsForRole(this.role);
    this.widgets = defaultLayoutForRole(this.role);
    this.activePresetKey = matchPresetKey(this.widgets);
    this.loading = false;
    this.errorMessage = 'Could not load saved layout. Showing role default.';
    this.cdr.markForCheck();
  }

  private persistLayout(widgets: WidgetId[]): void {
    this.saving = true;
    this.errorMessage = null;
    this.activePresetKey = matchPresetKey(widgets);
    this.cdr.markForCheck();

    this.layoutService
      .saveLayout(widgets)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.saving = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.errorMessage = 'Could not save layout. Try again.';
          this.saving = false;
          this.cdr.markForCheck();
        },
      });
  }
}

function matchPresetKey(widgets: readonly WidgetId[]): string | null {
  if (!widgets.length) return null;
  const match = LAYOUT_PRESETS.find(
    (p) =>
      p.widgets.length === widgets.length &&
      p.widgets.every((w, i) => w === widgets[i]),
  );
  return match ? match.presetKey : null;
}
