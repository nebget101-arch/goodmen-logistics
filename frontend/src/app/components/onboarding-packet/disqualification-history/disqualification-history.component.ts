import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';

export interface DisqualificationEntry {
  type: string;
  state: string;
  date: string;
  reason: string;
  reinstated: boolean | null;
}

export interface DisqualificationData {
  hasDisqualifications: boolean | null;
  entries: DisqualificationEntry[];
}

function createEntry(): DisqualificationEntry {
  return {
    type: '',
    state: '',
    date: '',
    reason: '',
    reinstated: null
  };
}

@Component({
  selector: 'app-disqualification-history',
  templateUrl: './disqualification-history.component.html',
  styleUrls: ['./disqualification-history.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DisqualificationHistoryComponent {
  @Input()
  set data(value: DisqualificationData | null) {
    if (value) {
      this.hasDisqualifications = value.hasDisqualifications;
      this.entries = value.entries?.length
        ? value.entries.map((e) => ({ ...e }))
        : [createEntry()];
    }
  }

  @Output() dataChange = new EventEmitter<DisqualificationData>();

  hasDisqualifications: boolean | null = null;
  entries: DisqualificationEntry[] = [createEntry()];

  disqualificationTypes: string[] = [
    'License Denied',
    'License Suspended',
    'License Revoked',
    'Disqualified from Operating CMV',
    'Other'
  ];

  onToggleChange(): void {
    if (this.hasDisqualifications === false) {
      this.entries = [createEntry()];
    }
    this.emitChange();
  }

  addEntry(): void {
    this.entries = [...this.entries, createEntry()];
    this.emitChange();
  }

  removeEntry(index: number): void {
    if (this.entries.length <= 1) return;
    this.entries = this.entries.filter((_, i) => i !== index);
    this.emitChange();
  }

  trackByIndex(index: number): number {
    return index;
  }

  emitChange(): void {
    this.dataChange.emit({
      hasDisqualifications: this.hasDisqualifications,
      entries: this.entries
    });
  }
}
