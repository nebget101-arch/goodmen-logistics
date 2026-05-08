// FN-1594 — Loads Import Wizard (top-level state machine).
// Orchestrates 6 steps: upload → ai-analysis → mapping → validate → commit → result.
// Mirrors fuel-import-wizard but split into per-step components per the FN-1594
// component tree. Holds all session state; steps are presentational and emit
// navigation events.

import { Component, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import { LoadsImportService } from './loads-import.service';
import {
  CommitResponse,
  ImportPreviewResponse,
  LOADS_IMPORT_FIELDS,
  MultiStopPattern,
  StageResponse,
} from './loads-import.model';
import { AiSelectOption } from '../../shared/ai-select/ai-select.component';

export type LoadsImportStep = 'upload' | 'ai_analysis' | 'mapping' | 'validate' | 'commit' | 'result';

@Component({
  selector: 'app-loads-import-wizard',
  templateUrl: './loads-import-wizard.component.html',
  styleUrls: ['./loads-import-wizard.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class LoadsImportWizardComponent {
  readonly steps: LoadsImportStep[] = ['upload', 'ai_analysis', 'mapping', 'validate', 'commit', 'result'];
  readonly stepLabels: Record<LoadsImportStep, string> = {
    upload: '1. Upload',
    ai_analysis: '2. AI Analysis',
    mapping: '3. Mapping',
    validate: '4. Validate',
    commit: '5. Commit',
    result: '6. Result',
  };

  currentStep: LoadsImportStep = 'upload';

  // ── Step 1: Upload ────────────────────────────────────────────────────────
  selectedFile: File | null = null;
  uploadError = '';

  // ── Step 2: AI Analysis ───────────────────────────────────────────────────
  previewLoading = false;
  previewError = '';
  previewResult: ImportPreviewResponse | null = null;

  // ── Step 3: Mapping ───────────────────────────────────────────────────────
  fields = LOADS_IMPORT_FIELDS;
  columnMap: Record<string, string | null> = {};
  multiStopPattern: MultiStopPattern = 'single';
  /** Stable reference for app-ai-select [options] (FN-317 — never use getter). */
  headerOptions: AiSelectOption[] = [];

  // ── Step 4: Validate ──────────────────────────────────────────────────────
  stageLoading = false;
  stageError = '';
  stageResult: StageResponse | null = null;

  // ── Step 5: Commit ────────────────────────────────────────────────────────
  commitLoading = false;
  commitError = '';
  commitResult: CommitResponse | null = null;
  importNeedsReview = true;

  // ── Duplicate review modal ────────────────────────────────────────────────
  showDuplicateModal = false;

  constructor(
    private readonly importApi: LoadsImportService,
    private readonly router: Router,
  ) {}

  get stepIndex(): number {
    return this.steps.indexOf(this.currentStep);
  }

  goToStep(step: LoadsImportStep): void {
    const idx = this.steps.indexOf(step);
    if (idx > this.stepIndex) return; // can't skip forward by clicking the rail
    this.currentStep = step;
  }

  // ── Step 1 → 2 transition: file selected → /preview ──────────────────────
  onFileSelected(file: File): void {
    this.selectedFile = file;
    this.uploadError = '';
    this.previewResult = null;
    this.previewError = '';
    this.columnMap = {};
    this.multiStopPattern = 'single';
    this.headerOptions = [];
  }

  onUploadError(message: string): void {
    this.uploadError = message;
  }

  startPreview(): void {
    if (!this.selectedFile) return;
    this.previewLoading = true;
    this.previewError = '';
    this.currentStep = 'ai_analysis';
    this.importApi.preview(this.selectedFile).subscribe({
      next: (res) => {
        this.previewResult = res;
        this.headerOptions = (res.headers || []).map((h) => ({ value: h, label: h }));
        const aiMap = res.aiMapping || {};
        this.columnMap = this.fields.reduce<Record<string, string | null>>((acc, f) => {
          acc[f.key] = aiMap[f.key]?.rawHeader ?? null;
          return acc;
        }, {});
        this.multiStopPattern = res.multiStopPattern || 'single';
        this.previewLoading = false;
      },
      error: (err) => {
        this.previewError = err?.error?.error || err?.message || 'Failed to analyze the file.';
        this.previewLoading = false;
      },
    });
  }

  // ── Step 2 actions ────────────────────────────────────────────────────────
  acceptAiMapping(): void {
    // columnMap already pre-populated from AI suggestions.
    this.currentStep = 'mapping';
  }

  skipAiMapping(): void {
    // Clear AI defaults and let the user map manually.
    this.columnMap = this.fields.reduce<Record<string, string | null>>((acc, f) => {
      acc[f.key] = null;
      return acc;
    }, {});
    this.currentStep = 'mapping';
  }

  // ── Step 3 → 4: Mapping → Validate ────────────────────────────────────────
  onMappingChange(payload: { columnMap: Record<string, string | null>; multiStopPattern: MultiStopPattern }): void {
    this.columnMap = { ...payload.columnMap };
    this.multiStopPattern = payload.multiStopPattern;
  }

  startStage(): void {
    if (!this.selectedFile) return;
    this.stageLoading = true;
    this.stageError = '';
    this.stageResult = null;
    this.currentStep = 'validate';
    this.importApi.stage(this.selectedFile, this.columnMap, this.multiStopPattern).subscribe({
      next: (res) => {
        this.stageResult = res;
        this.stageLoading = false;
      },
      error: (err) => {
        this.stageError = err?.error?.error || err?.message || 'Validation failed.';
        this.stageLoading = false;
      },
    });
  }

  // ── Step 4 → 5: Validate → Commit ─────────────────────────────────────────
  proceedToCommit(): void {
    this.currentStep = 'commit';
  }

  startCommit(): void {
    if (!this.stageResult) return;
    this.commitLoading = true;
    this.commitError = '';
    this.commitResult = null;
    this.importApi.commit(this.stageResult.batchId, this.importNeedsReview).subscribe({
      next: (res) => {
        this.commitResult = res;
        this.commitLoading = false;
        this.currentStep = 'result';
        if ((res.duplicates?.length || 0) > 0) {
          this.showDuplicateModal = true;
        }
      },
      error: (err) => {
        this.commitError = err?.error?.error || err?.message || 'Commit failed.';
        this.commitLoading = false;
      },
    });
  }

  // ── Step 6: Result actions ────────────────────────────────────────────────
  goToLoads(): void {
    this.router.navigate(['/loads']);
  }

  goToNeedsReview(): void {
    this.router.navigate(['/loads'], { queryParams: { needsReview: 'true' } });
  }

  startOver(): void {
    this.selectedFile = null;
    this.uploadError = '';
    this.previewResult = null;
    this.previewError = '';
    this.columnMap = {};
    this.multiStopPattern = 'single';
    this.headerOptions = [];
    this.stageResult = null;
    this.stageError = '';
    this.commitResult = null;
    this.commitError = '';
    this.showDuplicateModal = false;
    this.currentStep = 'upload';
  }

  closeDuplicateModal(): void {
    this.showDuplicateModal = false;
  }

  reopenDuplicateModal(): void {
    if ((this.commitResult?.duplicates?.length || 0) > 0) {
      this.showDuplicateModal = true;
    }
  }
}
