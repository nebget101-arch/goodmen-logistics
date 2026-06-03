// Step 3: editable column mapping + multi-stop pattern toggle.
// Mutates a local copy of columnMap so back/forward navigation preserves the
// user's overrides. Emits the final mapping to the parent on Next.

import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import {
  AiColumnSuggestion,
  LoadsImportFieldDef,
  MultiStopPattern,
} from '../loads-import.model';
import { AiSelectOption } from '../../../shared/ai-select/ai-select.component';

@Component({
  selector: 'app-loads-import-mapping-step',
  templateUrl: './mapping-step.component.html',
})
export class LoadsImportMappingStepComponent implements OnChanges {
  @Input() fields: LoadsImportFieldDef[] = [];
  @Input() headerOptions: AiSelectOption[] = [];
  @Input() columnMap: Record<string, string | null> = {};
  @Input() multiStopPattern: MultiStopPattern = 'single';
  @Input() columnMapping: Record<string, AiColumnSuggestion> | null = null;

  @Output() mappingChange = new EventEmitter<{
    columnMap: Record<string, string | null>;
    multiStopPattern: MultiStopPattern;
  }>();
  @Output() back = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();

  /** Local mutable copy so user edits don't bleed into parent until Next. */
  localMap: Record<string, string | null> = {};
  localPattern: MultiStopPattern = 'single';

  /** Pre-grouped fields (load → pickup → delivery → meta) for stable rendering. */
  groupedFields: { title: string; group: string; items: LoadsImportFieldDef[] }[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['columnMap']) {
      this.localMap = { ...(this.columnMap || {}) };
    }
    if (changes['multiStopPattern']) {
      this.localPattern = this.multiStopPattern || 'single';
    }
    if (changes['fields']) {
      this.rebuildGroups();
    }
  }

  private rebuildGroups(): void {
    const groups: Array<{ key: string; title: string }> = [
      { key: 'load',     title: 'Load' },
      { key: 'pickup',   title: 'Pickup' },
      { key: 'delivery', title: 'Delivery' },
      { key: 'meta',     title: 'Other' },
    ];
    this.groupedFields = groups
      .map((g) => ({
        title: g.title,
        group: g.key,
        items: this.fields.filter((f) => f.group === g.key),
      }))
      .filter((g) => g.items.length > 0);
  }

  setPattern(p: MultiStopPattern): void {
    this.localPattern = p;
  }

  get requiredUnmapped(): string[] {
    return this.fields
      .filter((f) => f.required && !this.localMap[f.key])
      .map((f) => f.label);
  }

  get canProceed(): boolean {
    return this.requiredUnmapped.length === 0;
  }

  onNext(): void {
    if (!this.canProceed) return;
    this.mappingChange.emit({
      columnMap: { ...this.localMap },
      multiStopPattern: this.localPattern,
    });
    this.next.emit();
  }

  onBack(): void {
    // Persist any in-progress edits so they survive a round-trip back to AI step.
    this.mappingChange.emit({
      columnMap: { ...this.localMap },
      multiStopPattern: this.localPattern,
    });
    this.back.emit();
  }

  confidenceClass(key: string): string {
    const c = this.columnMapping?.[key]?.confidence ?? 0;
    if (c <= 0) return 'confidence-none';
    if (c >= 0.8) return 'confidence-high';
    if (c >= 0.5) return 'confidence-medium';
    return 'confidence-low';
  }

  confidenceLabel(key: string): string {
    const c = this.columnMapping?.[key]?.confidence ?? 0;
    if (c <= 0) return '—';
    return `${Math.round(c * 100)}%`;
  }
}
