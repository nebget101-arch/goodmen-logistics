import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';

/**
 * FN-1353 — View toggle.
 *
 * Segmented [Table | Cards | Kanban] tablist that lets the user switch
 * the loads list rendering. Persistence is the parent's responsibility.
 */
export type LoadsViewMode = 'table' | 'cards' | 'kanban';

interface TabDef {
  value: LoadsViewMode;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { value: 'table',  label: 'Table',  icon: 'table_rows' },
  { value: 'cards',  label: 'Cards',  icon: 'view_agenda' },
  { value: 'kanban', label: 'Kanban', icon: 'view_kanban' },
];

@Component({
  selector: 'app-view-toggle',
  templateUrl: './view-toggle.component.html',
  styleUrls: ['./view-toggle.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewToggleComponent {
  @Input() value: LoadsViewMode = 'cards';
  @Output() valueChange = new EventEmitter<LoadsViewMode>();

  readonly tabs = TABS;

  isActive(mode: LoadsViewMode): boolean {
    return this.value === mode;
  }

  setValue(mode: LoadsViewMode, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (this.value === mode) {
      return;
    }
    this.value = mode;
    this.valueChange.emit(mode);
  }

  trackByValue(_: number, tab: TabDef): string {
    return tab.value;
  }
}
