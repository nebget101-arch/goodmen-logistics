// FN-1594 — Step 4: per-row outcomes (ok / needs_review / error). Drillable.

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { StageResponse, StageRow } from '../loads-import.model';

@Component({
  selector: 'app-loads-import-validate-step',
  templateUrl: './validate-step.component.html',
})
export class LoadsImportValidateStepComponent {
  @Input() loading = false;
  @Input() error = '';
  @Input() result: StageResponse | null = null;

  @Output() back = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();

  expanded = new Set<number>();

  toggleRow(row: StageRow): void {
    if (this.expanded.has(row.rowNumber)) this.expanded.delete(row.rowNumber);
    else this.expanded.add(row.rowNumber);
  }

  isExpanded(row: StageRow): boolean {
    return this.expanded.has(row.rowNumber);
  }

  /** Allow proceeding if at least one row is committable (ok or needs_review). */
  get canProceed(): boolean {
    if (!this.result) return false;
    return (this.result.okCount + this.result.needsReviewCount) > 0;
  }
}
