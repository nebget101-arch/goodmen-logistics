import { Component, OnInit } from '@angular/core';
import { TollsService } from '../tolls.service';
import { TollAccount, TollMappingProfile, TollUploadResult, TollCommitResult, TOLL_NORMALIZED_FIELDS } from '../tolls.model';

type WizardStep = 'upload' | 'map' | 'preview' | 'commit' | 'result';

@Component({
  selector: 'app-tolls-import',
  templateUrl: './tolls-import.component.html',
  styleUrls: ['./tolls-import.component.css']
})
export class TollsImportComponent implements OnInit {
  steps: WizardStep[] = ['upload', 'map', 'preview', 'commit', 'result'];
  stepLabels: Record<WizardStep, string> = {
    upload: '1. Upload',
    map: '2. Map Columns',
    preview: '3. Preview',
    commit: '4. Import',
    result: '5. Results'
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
          this.allRows = res.sampleRows;
          // Initialize column map with empty values
          this.normalizedFields.forEach(f => { this.columnMap[f.key] = ''; });
          this.uploadLoading = false;
          this.currentStep = 'map';
        },
        error: (err) => {
          this.uploadError = err.error?.error || 'Upload failed';
          this.uploadLoading = false;
        }
      });
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
    this.currentStep = 'upload';
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
