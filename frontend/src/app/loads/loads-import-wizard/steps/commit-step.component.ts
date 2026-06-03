// FN-1594 — Step 5: review summary and commit the staged batch.

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { StageResponse } from '../loads-import.model';

@Component({
  selector: 'app-loads-import-commit-step',
  templateUrl: './commit-step.component.html',
})
export class LoadsImportCommitStepComponent {
  @Input() stageResult: StageResponse | null = null;
  @Input() loading = false;
  @Input() error = '';

  @Input() importNeedsReview = true;
  @Output() importNeedsReviewChange = new EventEmitter<boolean>();

  @Output() back = new EventEmitter<void>();
  @Output() commit = new EventEmitter<void>();

  toggleNeedsReview(value: boolean): void {
    this.importNeedsReview = value;
    this.importNeedsReviewChange.emit(value);
  }

  get totalCommittable(): number {
    if (!this.stageResult) return 0;
    return this.stageResult.ok + (this.importNeedsReview ? this.stageResult.needsReview : 0);
  }
}
