import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { AiSelectComponent } from './ai-select/ai-select.component';
import { AiDatePickerComponent } from './ai-date-picker/ai-date-picker.component';
import { BinPickerComponent } from './components/bin-picker/bin-picker.component';
import { StopCardComponent } from './components/stop-card/stop-card.component';
import { KeyboardShortcutsHelpComponent } from './components/keyboard-shortcuts-help/keyboard-shortcuts-help.component';
import { CommandPaletteComponent } from './components/command-palette/command-palette.component';
import { HoverPopoverComponent } from './components/hover-popover/hover-popover.component';
import { AiSparkleComponent } from './components/ai-sparkle/ai-sparkle.component';
import { ConfidenceBadgeComponent } from './components/confidence-badge/confidence-badge.component';
import { HasPermissionDirective, HasAnyPermissionDirective } from '../directives/has-permission.directive';

@NgModule({
  declarations: [
    AiSelectComponent,
    AiDatePickerComponent,
    BinPickerComponent,
    StopCardComponent,
    KeyboardShortcutsHelpComponent,
    CommandPaletteComponent,
    HoverPopoverComponent,
    AiSparkleComponent,
    ConfidenceBadgeComponent,
    HasPermissionDirective,
    HasAnyPermissionDirective
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    DragDropModule
  ],
  exports: [
    AiSelectComponent,
    AiDatePickerComponent,
    BinPickerComponent,
    StopCardComponent,
    KeyboardShortcutsHelpComponent,
    CommandPaletteComponent,
    HoverPopoverComponent,
    AiSparkleComponent,
    ConfidenceBadgeComponent,
    HasPermissionDirective,
    HasAnyPermissionDirective
  ]
})
export class SharedModule {}
