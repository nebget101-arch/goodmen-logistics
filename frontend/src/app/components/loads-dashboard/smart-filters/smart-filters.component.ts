import { Component, EventEmitter, Input, Output } from '@angular/core';
import { SmartFilterCounts, SMART_FILTER_KEYS, SmartFilterKey } from '../../../services/loads.service';

interface ChipDef {
  key: SmartFilterKey;
  label: string;
  icon: string;
  title: string;
}

const CHIPS: ChipDef[] = [
  { key: 'ai_drafts',    label: 'AI Drafts',    icon: 'auto_awesome',  title: 'Drafts flagged for dispatcher review' },
  { key: 'overdue',      label: 'Overdue',      icon: 'schedule',      title: 'Past their final delivery date and not yet completed' },
  { key: 'high_value',   label: 'High Value',   icon: 'trending_up',   title: 'Loads above the tenant high-value threshold' },
  { key: 'from_email',   label: 'From Email',   icon: 'alternate_email', title: 'Loads created from a forwarded email' },
  { key: 'missing_docs', label: 'Missing Docs', icon: 'folder_off',    title: 'Loads without required documents attached' },
  { key: 'my_drafts',    label: 'My Drafts',    icon: 'edit_note',     title: 'Drafts you created' }
];

@Component({
  selector: 'app-smart-filters',
  templateUrl: './smart-filters.component.html',
  styleUrls: ['./smart-filters.component.scss']
})
export class SmartFiltersComponent {
  @Input() counts: SmartFilterCounts | null = null;
  @Input() active: string[] = [];
  @Input() loading = false;

  @Output() toggle = new EventEmitter<SmartFilterKey>();
  @Output() clearAll = new EventEmitter<void>();

  readonly chips = CHIPS;

  isActive(key: string): boolean {
    return this.active.includes(key);
  }

  countFor(key: SmartFilterKey): number {
    return this.counts?.[key] ?? 0;
  }

  get hasActive(): boolean {
    return this.active.length > 0;
  }

  onToggle(key: SmartFilterKey): void {
    this.toggle.emit(key);
  }

  onClearAll(): void {
    this.clearAll.emit();
  }

  trackByKey(_: number, chip: ChipDef): string {
    return chip.key;
  }
}

export { SMART_FILTER_KEYS };
