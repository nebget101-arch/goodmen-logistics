import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FuelService } from '../fuel.service';
import { FuelCardAccount, ImportPreviewResult, ProviderTemplate, FUEL_NORMALIZED_FIELDS, StageResult } from '../fuel.model';
import { AiSelectOption } from '../../shared/ai-select/ai-select.component';

export type WizardStep = 'provider' | 'upload' | 'preview' | 'map' | 'validate' | 'import' | 'result';

@Component({
  selector: 'app-fuel-import-wizard',
  templateUrl: './fuel-import-wizard.component.html',
  styleUrls: ['./fuel-import-wizard.component.css']
})
export class FuelImportWizardComponent implements OnInit {
  steps: WizardStep[] = ['provider', 'upload', 'preview', 'map', 'validate', 'import', 'result'];
  stepLabels: Record<WizardStep, string> = {
    provider: '1. Provider',
    upload: '2. Upload',
    preview: '3. Preview',
    map: '4. Map',
    validate: '5. Validate',
    import: '6. Import',
    result: '7. Result'
  };
  currentStep: WizardStep = 'provider';

  // Step 1 — Provider
  providerTemplates: ProviderTemplate[] = [];
  selectedProviderKey = 'generic';
  selectedProviderName = 'Generic';

  // Step 2 — Upload
  selectedFile: File | null = null;
  dragOver = false;

  // Step 3/4 — Preview + Map
  previewResult: ImportPreviewResult | null = null;
  previewLoading = false;
  previewError = '';
  normalizedFields = FUEL_NORMALIZED_FIELDS;
  columnMap: Record<string, string> = {}; // normalizedField -> rawHeader

  // Fuel cards for card association
  cards: FuelCardAccount[] = [];
  selectedCardId = '';

  get cardSelectOptions(): AiSelectOption[] {
    return this.cards.map(c => ({
      value: c.id,
      label: `${c.display_name} (${c.provider_name})`
    }));
  }

  get headerOptions(): AiSelectOption[] {
    return (this.previewResult?.headers || []).map(h => ({ value: h, label: h }));
  }

  // Step 5 — Validate (stage)
  stageResult: StageResult | null = null;
  stageLoading = false;
  stageError = '';
  importWarnings = false;

  // Step 6 — Import (commit)
  commitLoading = false;
  commitError = '';
  commitResult: any = null;

  constructor(private fuel: FuelService, private router: Router) {}

  ngOnInit(): void {
    this.fuel.getProviderTemplates().subscribe({
      next: (templates) => { this.providerTemplates = templates; },
      error: () => {}
    });
    this.fuel.getCards().subscribe({
      next: (cards) => { this.cards = cards.filter(c => c.status === 'active'); },
      error: () => {}
    });
  }

  // ── Navigation ──────────────────────────────────────────────────────────────
  get stepIndex(): number { return this.steps.indexOf(this.currentStep); }

  goToStep(step: WizardStep): void {
    const targetIdx = this.steps.indexOf(step);
    if (targetIdx > this.stepIndex) return; // can't skip forward manually
    this.currentStep = step;
  }

  // ── Step 1 — Provider ───────────────────────────────────────────────────────
  selectProvider(key: string, name: string): void {
    this.selectedProviderKey = key;
    this.selectedProviderName = name;
  }

  nextFromProvider(): void { this.currentStep = 'upload'; }

  // ── Step 2 — Upload ─────────────────────────────────────────────────────────
  onDragOver(ev: DragEvent): void { ev.preventDefault(); this.dragOver = true; }
  onDragLeave(): void { this.dragOver = false; }
  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver = false;
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.handleFile(file);
  }

  onFileChange(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (file) this.handleFile(file);
  }

  handleFile(file: File): void {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
      this.previewError = 'Only CSV or Excel (.xlsx/.xls) files are supported.';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.previewError = 'File is too large (max 10 MB).';
      return;
    }
    this.selectedFile = file;
    this.previewError = '';
    this.columnMap = {};
    this.previewResult = null;
  }

  nextFromUpload(): void {
    if (!this.selectedFile) return;
    this.previewLoading = true;
    this.previewError = '';
    this.fuel.previewImport(this.selectedFile, this.selectedProviderKey).subscribe({
      next: (res) => {
        this.previewResult = res;
        this.columnMap = { ...res.autoMapping } as Record<string, string>;
        this.previewLoading = false;
        this.currentStep = 'preview';
      },
      error: (err) => {
        this.previewError = err.error?.error || 'Preview failed. Check the file format and try again.';
        this.previewLoading = false;
      }
    });
  }

  // ── Step 3 — Preview (summary) ───────────────────────────────────────────────
  nextFromPreview(): void { this.currentStep = 'map'; }

  // ── Step 4 — Column Map ──────────────────────────────────────────────────────
  getFieldDef(key: string) { return this.normalizedFields.find(f => f.key === key); }

  get requiredUnmapped(): string[] {
    return this.normalizedFields
      .filter(f => f.required && !this.columnMap[f.key])
      .map(f => f.label);
  }

  get canProceedFromMap(): boolean { return this.requiredUnmapped.length === 0; }

  nextFromMap(): void {
    if (!this.canProceedFromMap) return;
    this.stageResult = null;
    this.stageError = '';
    this.stageLoading = true;
    this.currentStep = 'validate';
    const payload = { file: this.selectedFile!, providerName: this.selectedProviderName, columnMap: this.columnMap, cardId: this.selectedCardId };
    this.fuel.stageImport(payload.file, payload.providerName, payload.columnMap, payload.cardId || undefined).subscribe({
      next: (res) => { this.stageResult = res; this.stageLoading = false; },
      error: (err) => { this.stageError = err.error?.error || 'Staging failed. Please check the file.'; this.stageLoading = false; }
    });
  }

  // ── Step 5 — Validate ────────────────────────────────────────────────────────
  get hasErrors(): boolean { return (this.stageResult?.failedCount ?? 0) > 0; }
  get hasWarnings(): boolean { return (this.stageResult?.warningCount ?? 0) > 0; }

  nextFromValidate(): void {
    if (this.hasErrors && !this.importWarnings) return;
    this.currentStep = 'import';
  }

  // ── Step 6 — Import ──────────────────────────────────────────────────────────
  doCommit(): void {
    if (!this.stageResult) return;
    this.commitLoading = true;
    this.commitError = '';
    this.fuel.commitImport(this.stageResult.batchId, this.importWarnings).subscribe({
      next: (res) => {
        this.commitResult = { ...res, skipped: Math.max((this.stageResult?.totalRows || 0) - (res.imported || 0), 0) };
        this.commitLoading = false;
        this.currentStep = 'result';
      },
      error: (err) => { this.commitError = err.error?.error || 'Import failed. Please try again.'; this.commitLoading = false; }
    });
  }

  // ── Result ───────────────────────────────────────────────────────────────────
  goToTransactions(): void { this.router.navigate(['/fuel/transactions']); }
  goToExceptions(): void { this.router.navigate(['/fuel/exceptions']); }

  startOver(): void {
    this.currentStep = 'provider';
    this.selectedFile = null;
    this.previewResult = null;
    this.stageResult = null;
    this.commitResult = null;
    this.columnMap = {};
    this.previewError = '';
    this.stageError = '';
    this.commitError = '';
    this.importWarnings = false;
  }

  downloadTemplate(): void {
    const headers = this.normalizedFields.map(f => f.label).join(',');
    const blob = new Blob([headers + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fuel-import-template-${this.selectedProviderKey}.csv`;
    a.click();
  }

  providerLabel(template: ProviderTemplate): string {
    return (template as any).label || (template as any).name || template.key;
  }

  providerDescription(_template: ProviderTemplate): string {
    return 'Provider template';
  }
}
