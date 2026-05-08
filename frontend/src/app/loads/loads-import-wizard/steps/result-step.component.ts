// FN-1594 — Step 6: result screen with 4 drillable cards.

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommitResponse } from '../loads-import.model';

@Component({
  selector: 'app-loads-import-result-step',
  templateUrl: './result-step.component.html',
})
export class LoadsImportResultStepComponent {
  @Input() result: CommitResponse | null = null;

  @Output() viewLoads = new EventEmitter<void>();
  @Output() viewNeedsReview = new EventEmitter<void>();
  @Output() showDuplicates = new EventEmitter<void>();
  @Output() startOver = new EventEmitter<void>();

  get duplicatesCount(): number {
    return this.result?.duplicatesSkippedCount ?? this.result?.duplicates?.length ?? 0;
  }

  get errorsCount(): number {
    return this.result?.errorCount ?? this.result?.errors?.length ?? 0;
  }
}
