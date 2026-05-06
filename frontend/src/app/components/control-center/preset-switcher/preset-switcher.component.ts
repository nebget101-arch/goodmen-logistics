import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

import {
  DashboardLayout,
  DashboardLayoutService,
} from '../../../services/dashboard-layout.service';
import {
  DashboardLayoutPreset,
  WidgetId,
} from '../role-layouts';

/**
 * FN-1343 — Control Center preset switcher.
 *
 * Lives in the Control Center settings header next to "Reset to default".
 * Renders a dropdown panel listing the named layout presets (Owner /
 * Dispatcher / Compliance), each with a thumbnail preview of the widget
 * order. Selecting a preset previews it; the user must confirm before the
 * frontend persists via `PUT /api/users/me/dashboard-layout`.
 *
 * Drag-reorder is unaffected — applying a preset just rewrites the saved
 * widget order; the user can keep dragging cards as before.
 */
@Component({
  selector: 'app-preset-switcher',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './preset-switcher.component.html',
  styleUrls: ['./preset-switcher.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresetSwitcherComponent implements OnInit, OnDestroy {
  /** Disable the trigger button (e.g. while parent is loading/saving). */
  @Input() disabled = false;

  /**
   * Currently active preset key, used to mark the matching preset row in
   * the panel. Optional — when omitted, no row is marked active.
   */
  @Input() activePresetKey: string | null = null;

  /** Fired after a preset is successfully applied. Parent reloads layout. */
  @Output() presetApplied = new EventEmitter<DashboardLayout>();

  /** Fired when an apply request fails so the parent can show a banner. */
  @Output() presetApplyFailed = new EventEmitter<string>();

  presets: DashboardLayoutPreset[] = [];
  open = false;
  selectedKey: string | null = null;
  applying = false;
  loadingPresets = true;
  loadError: string | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly layoutService: DashboardLayoutService,
    private readonly cdr: ChangeDetectorRef,
    private readonly hostRef: ElementRef<HTMLElement>,
  ) {}

  ngOnInit(): void {
    this.layoutService
      .getPresets()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (presets) => {
          this.presets = presets;
          this.loadingPresets = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loadError = 'Could not load presets.';
          this.loadingPresets = false;
          this.cdr.markForCheck();
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggle(): void {
    if (this.disabled) return;
    this.open = !this.open;
    if (this.open) {
      this.selectedKey = this.activePresetKey;
    }
    this.cdr.markForCheck();
  }

  close(): void {
    this.open = false;
    this.selectedKey = null;
    this.cdr.markForCheck();
  }

  select(presetKey: string): void {
    this.selectedKey = presetKey;
    this.cdr.markForCheck();
  }

  apply(): void {
    if (!this.selectedKey || this.applying) return;
    this.applying = true;
    this.cdr.markForCheck();

    this.layoutService
      .applyPreset(this.selectedKey)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.applying = false;
          this.open = false;
          this.selectedKey = null;
          this.presetApplied.emit(result);
          this.cdr.markForCheck();
        },
        error: () => {
          this.applying = false;
          this.presetApplyFailed.emit('Could not apply preset. Try again.');
          this.cdr.markForCheck();
        },
      });
  }

  trackByPresetKey = (_: number, preset: DashboardLayoutPreset): string =>
    preset.presetKey;

  trackByWidget = (_: number, widget: WidgetId): WidgetId => widget;

  widgetLabel(widget: WidgetId): string {
    switch (widget) {
      case 'daily-briefing':
        return 'Daily briefing';
      case 'action-queue':
        return 'Action queue';
      case 'predictive-insights':
        return 'Predictive insights';
      case 'quick-actions':
        return 'Quick actions';
      default:
        return widget;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open) return;
    const target = event.target as Node | null;
    if (target && this.hostRef.nativeElement.contains(target)) return;
    this.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.close();
  }
}
