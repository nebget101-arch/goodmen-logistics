import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface DuplicateCandidate {
  id: string;
  name: string;
  sku: string;
  manufacturer: string | null;
  similarity: number;
}

/**
 * FN-1111: Inline "Possible duplicates" warning for the Add Part form.
 *
 * Renders the up-to-5 candidates returned by `GET /api/parts/duplicate-check`
 * with a similarity %, an "Edit existing" link per row, and a single
 * session-level dismiss control ("Ignore — this is a new part").
 *
 * The component is purely presentational: the parent owns the debounced
 * fetch + dismissed-this-session state. When the parent passes an empty
 * `candidates` array, nothing is rendered — that satisfies the "auto-hides
 * when candidates become empty" acceptance criterion without extra logic
 * here.
 */
@Component({
  selector: 'app-duplicate-warning',
  templateUrl: './duplicate-warning.component.html',
  styleUrls: ['./duplicate-warning.component.css'],
})
export class DuplicateWarningComponent {
  @Input() candidates: DuplicateCandidate[] = [];

  @Output() editExisting = new EventEmitter<DuplicateCandidate>();
  @Output() dismissed = new EventEmitter<void>();

  onEditExisting(candidate: DuplicateCandidate): void {
    this.editExisting.emit(candidate);
  }

  onDismiss(): void {
    this.dismissed.emit();
  }

  similarityPercent(similarity: number): number {
    const pct = Math.round((Number(similarity) || 0) * 100);
    return Math.max(0, Math.min(100, pct));
  }
}
