import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { AiSelectComponent } from './ai-select/ai-select.component';
import { AiDatePickerComponent } from './ai-date-picker/ai-date-picker.component';
import { CompanySwitcherComponent } from './company-switcher/company-switcher.component';
import { BinPickerComponent } from './components/bin-picker/bin-picker.component';
import { StopCardComponent } from './components/stop-card/stop-card.component';
import { KeyboardShortcutsHelpComponent } from './components/keyboard-shortcuts-help/keyboard-shortcuts-help.component';
import { CommandPaletteComponent } from './components/command-palette/command-palette.component';
import { HoverPopoverComponent } from './components/hover-popover/hover-popover.component';
import { AiSparkleComponent } from './components/ai-sparkle/ai-sparkle.component';
import { ConfidenceBadgeComponent } from './components/confidence-badge/confidence-badge.component';
import { SeverityBadgeComponent } from './components/severity-badge/severity-badge.component';
import { GroupedAlertRowComponent } from './components/grouped-alert-row/grouped-alert-row.component';
// FN-1636 — dashboard AI primitives
import { KpiCardComponent } from './kpi-card/kpi-card.component';
import { AiSegmentedControlComponent } from './ai-segmented-control/ai-segmented-control.component';
import { AiSkeletonComponent } from './ai-skeleton/ai-skeleton.component';
import { AiHeroStripComponent } from './ai-hero-strip/ai-hero-strip.component';
import { AiAlertRowComponent } from './ai-alert-row/ai-alert-row.component';
import { HasPermissionDirective, HasAnyPermissionDirective } from '../directives/has-permission.directive';
import { AiExplainableDirective } from '../directives/ai-explainable.directive';
import { FabSafeAreaDirective } from '../directives/fab-safe-area.directive';

@NgModule({
  declarations: [
    AiSelectComponent,
    AiDatePickerComponent,
    CompanySwitcherComponent,
    BinPickerComponent,
    StopCardComponent,
    KeyboardShortcutsHelpComponent,
    CommandPaletteComponent,
    HoverPopoverComponent,
    AiSparkleComponent,
    KpiCardComponent,
    AiSegmentedControlComponent,
    AiSkeletonComponent,
    AiHeroStripComponent,
    AiAlertRowComponent,
    HasPermissionDirective,
    HasAnyPermissionDirective
  ],
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    DragDropModule,
    ConfidenceBadgeComponent,
    SeverityBadgeComponent,
    GroupedAlertRowComponent,
    AiExplainableDirective,
    FabSafeAreaDirective
  ],
  exports: [
    AiSelectComponent,
    AiDatePickerComponent,
    CompanySwitcherComponent,
    BinPickerComponent,
    StopCardComponent,
    KeyboardShortcutsHelpComponent,
    CommandPaletteComponent,
    HoverPopoverComponent,
    AiSparkleComponent,
    ConfidenceBadgeComponent,
    SeverityBadgeComponent,
    GroupedAlertRowComponent,
    KpiCardComponent,
    AiSegmentedControlComponent,
    AiSkeletonComponent,
    AiHeroStripComponent,
    AiAlertRowComponent,
    HasPermissionDirective,
    HasAnyPermissionDirective,
    AiExplainableDirective,
    FabSafeAreaDirective
  ]
})
export class SharedModule {}
