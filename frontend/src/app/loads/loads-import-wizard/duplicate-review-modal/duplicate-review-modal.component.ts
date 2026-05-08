// FN-1594 — Duplicate review modal.
// Lists each duplicate with row #, attempted load_number, key fields, and a
// deep-link to the existing FN load. Includes a CSV export of the list.

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommitDuplicate } from '../loads-import.model';

@Component({
  selector: 'app-loads-import-duplicate-review-modal',
  templateUrl: './duplicate-review-modal.component.html',
})
export class LoadsImportDuplicateReviewModalComponent {
  @Input() duplicates: CommitDuplicate[] = [];
  @Output() close = new EventEmitter<void>();

  loadHref(d: CommitDuplicate): string | null {
    // Loads dashboard reads `loadId` query param and opens the detail modal.
    return d.existingLoadId ? `/loads?loadId=${encodeURIComponent(d.existingLoadId)}` : null;
  }

  exportCsv(): void {
    const headers = ['row_number', 'attempted_load_number', 'rate', 'broker', 'pickup_city', 'delivery_city', 'existing_load_id'];
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = this.duplicates.map((d) => [
      d.rowNumber,
      d.attemptedLoadNumber,
      d.rate ?? '',
      d.brokerName ?? '',
      d.pickupCity ?? '',
      d.deliveryCity ?? '',
      d.existingLoadId ?? '',
    ].map(escape).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `loads-import-duplicates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  onOverlayClick(): void {
    this.close.emit();
  }

  stopPropagation(ev: Event): void {
    ev.stopPropagation();
  }
}
