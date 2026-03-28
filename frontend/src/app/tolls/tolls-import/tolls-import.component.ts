import { Component, OnInit } from '@angular/core';
import { TollsService } from '../tolls.service';
import { TollAccount, TollMappingProfile, TollUploadResult, TollCommitResult, TollAiNormalizeResult, TollAiColumnMapping, TOLL_NORMALIZED_FIELDS } from '../tolls.model';

type WizardStep = 'upload' | 'ai_analyze' | 'map' | 'preview' | 'commit' | 'result';

@Component({
  selector: 'app-tolls-import',
  templateUrl: './tolls-import.component.html',
  styleUrls: ['./tolls-import.component.css']
})
export class TollsImportComponent implements OnInit {
  steps: WizardStep[] = ['upload', 'ai_analyze', 'map', 'preview', 'commit', 'result'];
  stepLabels: Record<WizardStep, string> = {
    upload: '1. Upload',
    ai_analyze: '2. AI Analysis',
    map: '3. Map Columns',
    preview: '4. Preview',
    commit: '5. Import',
    result: '6. Results'
  };
  currentStep: WizardStep = 'upload';
  get stepIndex(): number { return this.steps.indexOf(this.currentStep); }

  // Upload
  selectedFile: File | null = null;
  dragOver = false;
  uploadLoading = false;
  uploadError = '';
  uploadResult: TollUploadResult | null = null;

  // Accounts
  accounts: TollAccount[] = [];
  selectedAccountId = '';

  // AI Analysis
  aiLoading = false;
  aiError = '';
  aiResult: TollAiNormalizeResult | null = null;
  aiConfidenceMap: Record<string, TollAiColumnMapping> = {};

  // Mapping
  normalizedFields = TOLL_NORMALIZED_FIELDS;
  columnMap: Record<string, string> = {};
  profiles: TollMappingProfile[] = [];
  selectedProfileId = '';
  saveProfileName = '';

  // Preview (rows from upload)
  allRows: Record<string, string>[] = [];

  // Commit
  commitLoading = false;
  commitError = '';
  commitResult: TollCommitResult | null = null;

  constructor(private tollsSvc: TollsService) {}

  ngOnInit(): void {
    this.tollsSvc.getAccounts().subscribe(accts => {
      this.accounts = (accts as unknown as { rows?: TollAccount[] })?.rows || accts || [];
    });
    this.loadProfiles();
  }

  // ─── Upload step ─────────────────────────────────────────────────────────────

  onDragOver(e: DragEvent): void { e.preventDefault(); this.dragOver = true; }
  onDragLeave(): void { this.dragOver = false; }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) this.handleFile(file);
  }

  onFileChange(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.handleFile(file);
  }

  handleFile(file: File): void {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls', 'txt'].includes(ext || '')) {
      this.uploadError = 'Only CSV and Excel files are accepted.';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.uploadError = 'File must be under 10 MB.';
      return;
    }
    this.selectedFile = file;
    this.uploadError = '';
  }

  doUpload(): void {
    if (!this.selectedFile) return;
    this.uploadLoading = true;
    this.uploadError = '';
    this.tollsSvc.uploadImportCSV(this.selectedFile, this.selectedAccountId || undefined)
      .subscribe({
        next: (res) => {
          this.uploadResult = res;
          this.allRows = (res as any).allRows || res.sampleRows;
          this.normalizedFields.forEach(f => { this.columnMap[f.key] = ''; });
          this.uploadLoading = false;
          // Automatically trigger AI analysis
          this.currentStep = 'ai_analyze';
          this.runAiNormalize();
        },
        error: (err) => {
          this.uploadError = err.error?.error || 'Upload failed';
          this.uploadLoading = false;
        }
      });
  }

  // ─── AI Analysis step ───────────────────────────────────────────────────────

  runAiNormalize(): void {
    if (!this.uploadResult) return;
    this.aiLoading = true;
    this.aiError = '';
    this.aiResult = null;

    this.tollsSvc.aiNormalize(
      this.uploadResult.batchId,
      this.uploadResult.headers,
      this.uploadResult.sampleRows
    ).subscribe({
      next: (res) => {
        this.aiResult = res;
        this.aiLoading = false;

        if (res.success && res.columnMapping) {
          this.aiConfidenceMap = res.columnMapping;
          // Pre-fill column map with high/medium confidence mappings
          for (const [normalizedKey, mapping] of Object.entries(res.columnMapping)) {
            if (mapping.rawHeader && mapping.confidence >= 0.5) {
              this.columnMap[normalizedKey] = mapping.rawHeader;
            }
          }
        }

        // If overall confidence is very low, skip directly to manual mapping
        if (!res.success || res.overallConfidence < 0.3) {
          this.aiError = 'AI could not confidently map columns. Please map manually.';
        }
      },
      error: (err) => {
        this.aiLoading = false;
        this.aiError = err.error?.error || 'AI analysis failed. You can map columns manually.';
      }
    });
  }

  getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.5) return 'medium';
    return 'low';
  }

  getConfidenceLabel(confidence: number): string {
    const pct = Math.round(confidence * 100);
    return `${pct}%`;
  }

  getAccountName(accountId: string | null): string {
    if (!accountId || !this.accounts.length) return '';
    const acct = this.accounts.find(a => a.id === accountId);
    return acct ? acct.display_name || acct.provider_name : '';
  }

  get aiMappedFields(): { key: string; label: string; rawHeader: string | null; confidence: number }[] {
    if (!this.aiResult?.columnMapping) return [];
    return this.normalizedFields
      .filter(f => this.aiResult!.columnMapping[f.key]?.rawHeader)
      .map(f => ({
        key: f.key,
        label: f.label,
        rawHeader: this.aiResult!.columnMapping[f.key].rawHeader,
        confidence: this.aiResult!.columnMapping[f.key].confidence
      }));
  }

  acceptAiMapping(): void {
    this.currentStep = 'map';
  }

  skipAiMapping(): void {
    // Clear AI-prefilled mappings
    this.normalizedFields.forEach(f => { this.columnMap[f.key] = ''; });
    this.aiConfidenceMap = {};
    this.currentStep = 'map';
  }

  // ─── Map step ────────────────────────────────────────────────────────────────

  get headerOptions(): { value: string; label: string }[] {
    return (this.uploadResult?.headers || []).map(h => ({ value: h, label: h }));
  }

  get requiredUnmapped(): string[] {
    return this.normalizedFields
      .filter(f => f.required && !this.columnMap[f.key])
      .map(f => f.label);
  }

  get canProceedFromMap(): boolean {
    return this.requiredUnmapped.length === 0;
  }

  getFieldConfidence(key: string): TollAiColumnMapping | null {
    return this.aiConfidenceMap[key] || null;
  }

  loadProfiles(): void {
    this.tollsSvc.getMappingProfiles().subscribe({
      next: (res) => { this.profiles = res.rows || []; },
      error: () => {}
    });
  }

  applyProfile(): void {
    const p = this.profiles.find(pr => pr.id === this.selectedProfileId);
    if (p) {
      const map = typeof p.column_map === 'string' ? JSON.parse(p.column_map as unknown as string) : p.column_map;
      this.columnMap = { ...this.columnMap, ...map };
    }
  }

  saveProfile(): void {
    if (!this.saveProfileName.trim()) return;
    this.tollsSvc.saveMappingProfile({
      profile_name: this.saveProfileName.trim(),
      column_map: this.columnMap
    }).subscribe({
      next: () => {
        this.saveProfileName = '';
        this.loadProfiles();
      },
      error: () => {}
    });
  }

  goToPreview(): void {
    this.currentStep = 'preview';
  }

  // ─── Preview step ────────────────────────────────────────────────────────────

  getMappedValue(row: Record<string, string>, normalizedKey: string): string {
    const rawKey = this.columnMap[normalizedKey];
    return rawKey ? (row[rawKey] || '') : '';
  }

  get mappedFields(): { key: string; label: string }[] {
    return this.normalizedFields.filter(f => !!this.columnMap[f.key]);
  }

  goToCommit(): void {
    this.currentStep = 'commit';
  }

  // ─── Commit step ─────────────────────────────────────────────────────────────

  doCommit(): void {
    if (!this.uploadResult) return;
    this.commitLoading = true;
    this.commitError = '';
    this.tollsSvc.commitImport(this.uploadResult.batchId, this.allRows, this.columnMap)
      .subscribe({
        next: (res) => {
          this.commitResult = res;
          this.commitLoading = false;
          this.currentStep = 'result';
        },
        error: (err) => {
          this.commitError = err.error?.error || 'Import failed';
          this.commitLoading = false;
        }
      });
  }

  // ─── Navigation ──────────────────────────────────────────────────────────────

  goBack(): void {
    const idx = this.stepIndex;
    if (idx > 0) this.currentStep = this.steps[idx - 1];
  }

  goToStep(step: WizardStep): void {
    const targetIdx = this.steps.indexOf(step);
    if (targetIdx <= this.stepIndex) this.currentStep = step;
  }

  startOver(): void {
    this.selectedFile = null;
    this.uploadResult = null;
    this.uploadError = '';
    this.columnMap = {};
    this.allRows = [];
    this.commitResult = null;
    this.commitError = '';
    this.selectedAccountId = '';
    this.aiResult = null;
    this.aiError = '';
    this.aiConfidenceMap = {};
    this.currentStep = 'upload';
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
