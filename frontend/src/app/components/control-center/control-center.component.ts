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

import { DailyBriefingComponent, BriefingVisibility } from './daily-briefing/daily-briefing.component';
import { ActionQueueComponent } from '../dashboard/action-queue/action-queue.component';
import {
  PredictiveInsightsComponent,
  InsightsVisibility,
} from './predictive-insights/predictive-insights.component';
import {
  QuickActionDef,
  QuickActionsComponent,
} from './quick-actions/quick-actions.component';
import { KpiStripComponent } from './kpi-strip/kpi-strip.component';
import { WindowSelectorComponent } from './window-selector/window-selector.component';
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
    KpiStripComponent,
    WindowSelectorComponent,
    PresetSwitcherComponent,
  ],
  templateUrl: './control-center.component.html',
  styleUrls: ['./control-center.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ControlCenterComponent implements OnInit, OnDestroy {
  widgets: WidgetId[] = [];
  hidden: WidgetId[] = [];
  showHidden = false;
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

  /**
   * Cards rendered in the grid: persisted order minus dismissed widgets,
   * unless the user has flipped "Show hidden cards" to override.
   */
  get visibleWidgets(): WidgetId[] {
    if (this.showHidden) return [...this.widgets];
    const hidden = new Set(this.hidden);
    return this.widgets.filter((id) => !hidden.has(id));
  }

  get hiddenCount(): number {
    return this.hidden.length;
  }

  onDrop(event: CdkDragDrop<WidgetId[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    // The drop event indexes apply to the rendered list, which may be filtered
    // by `visibleWidgets`. Translate back to the full `widgets` order before
    // moving + persisting so hidden cards keep their relative position.
    const visible = this.visibleWidgets;
    const moving = visible[event.previousIndex];
    const target = visible[event.currentIndex];
    if (!moving || !target) return;

    const next = [...this.widgets];
    const fromIdx = next.indexOf(moving);
    const toIdx = next.indexOf(target);
    if (fromIdx < 0 || toIdx < 0) return;

    moveItemInArray(next, fromIdx, toIdx);
    this.widgets = next;
    this.persistLayout();
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
          this.showHidden = false;
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

  /**
   * "Show hidden cards" affordance (FN-1337). Toggling on surfaces dismissed
   * cards alongside the visible ones until the user reloads or resets.
   */
  toggleShowHidden(): void {
    this.showHidden = !this.showHidden;
    this.cdr.markForCheck();
  }

  /**
   * Bridge from the briefing card's data fetch. When the AI service reports
   * "no baseline yet" we collapse the card from the layout and persist the
   * decision so the page doesn't flash on reload.
   */
  onBriefingVisibility(event: BriefingVisibility): void {
    this.applyVisibility('daily-briefing', event.hasBaseline);
  }

  onInsightsVisibility(event: InsightsVisibility): void {
    this.applyVisibility('predictive-insights', event.hasBaseline);
  }

  trackById = (_: number, id: WidgetId): WidgetId => id;

  onPresetApplied(result: DashboardLayout): void {
    this.applyLayout(result);
  }

  onPresetApplyFailed(message: string): void {
    this.errorMessage = message;
    this.cdr.markForCheck();
  }

  private applyVisibility(id: WidgetId, hasBaseline: boolean): void {
    const isHidden = this.hidden.includes(id);
    if (!hasBaseline && !isHidden) {
      this.hidden = [...this.hidden, id];
      this.persistLayout();
    } else if (hasBaseline && isHidden) {
      this.hidden = this.hidden.filter((h) => h !== id);
      this.persistLayout();
    }
  }

  private applyLayout(result: DashboardLayout): void {
    this.role = normalizeRole(result.role);
    this.quickActions = quickActionsForRole(this.role);
    this.widgets = result.widgets.length
      ? result.widgets
      : defaultLayoutForRole(this.role);
    this.hidden = result.hidden;
    this.activePresetKey = matchPresetKey(this.widgets);
    this.loading = false;
    this.errorMessage = null;
    this.cdr.markForCheck();
  }

  private fallbackToClientDefault(): void {
    this.quickActions = quickActionsForRole(this.role);
    this.widgets = defaultLayoutForRole(this.role);
    this.hidden = [];
    this.activePresetKey = matchPresetKey(this.widgets);
    this.loading = false;
    this.errorMessage = 'Could not load saved layout. Showing role default.';
    this.cdr.markForCheck();
  }

  private persistLayout(): void {
    this.saving = true;
    this.errorMessage = null;
    this.activePresetKey = matchPresetKey(widgets);
    this.cdr.markForCheck();

    this.layoutService
      .saveLayout(this.widgets, this.hidden)
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
