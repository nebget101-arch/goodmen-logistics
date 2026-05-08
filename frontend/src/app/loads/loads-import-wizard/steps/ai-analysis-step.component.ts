// Step 2: AI analysis (mapping suggestions + multi-stop pattern).
// Renders Claude attribution while loading and lets the user accept the AI
// mapping or skip to manual.

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ImportPreviewResponse, LoadsImportFieldDef, MultiStopPattern } from '../loads-import.model';

interface AiMappingRow {
  field: string;
  fieldKey: string;
  sourceHeader: string | null;
  confidence: number;
}

@Component({
  selector: 'app-loads-import-ai-analysis-step',
  templateUrl: './ai-analysis-step.component.html',
})
export class LoadsImportAiAnalysisStepComponent {
  @Input() loading = false;
  @Input() error = '';
  @Input() data: ImportPreviewResponse | null = null;
  @Input() fields: LoadsImportFieldDef[] = [];

  @Output() back = new EventEmitter<void>();
  @Output() acceptMapping = new EventEmitter<void>();
  @Output() skipMapping = new EventEmitter<void>();

  get aiMappingRows(): AiMappingRow[] {
    if (!this.data?.columnMapping) return [];
    return this.fields.map((f) => {
      const m = this.data!.columnMapping![f.key];
      return {
        field: f.label,
        fieldKey: f.key,
        sourceHeader: m?.sourceHeader ?? null,
        confidence: m?.confidence ?? 0,
      };
    });
  }

  get overallConfidenceClass(): string {
    return this.confidenceClass(this.data?.overallConfidence ?? 0);
  }

  confidenceClass(c: number): string {
    if (c <= 0) return 'confidence-none';
    if (c >= 0.8) return 'confidence-high';
    if (c >= 0.5) return 'confidence-medium';
    return 'confidence-low';
  }

  confidenceLabel(c: number): string {
    if (c <= 0) return '—';
    return `${Math.round(c * 100)}%`;
  }

  multiStopLabel(p?: MultiStopPattern | null): string {
    switch (p) {
      case 'multi_row':
      case 'extra_columns':
        return 'Multi-stop (one row per stop or extra stop columns)';
      case 'free_text':
        return 'Free-text stops (will need review)';
      case 'single':
      default:
        return 'Single (one row per load)';
    }
  }
}
