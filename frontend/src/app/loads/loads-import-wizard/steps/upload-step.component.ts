// FN-1594 — Step 1: file upload (drag-drop + browse).
// 15 MB cap and CSV/XLSX type validation per FN-1594 acceptance criteria.

import { Component, EventEmitter, Input, Output } from '@angular/core';

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_EXT = ['csv', 'xlsx', 'xls'];

@Component({
  selector: 'app-loads-import-upload-step',
  templateUrl: './upload-step.component.html',
})
export class LoadsImportUploadStepComponent {
  @Input() file: File | null = null;
  @Input() error = '';

  @Output() fileSelected = new EventEmitter<File>();
  @Output() errorChange = new EventEmitter<string>();
  @Output() next = new EventEmitter<void>();

  dragOver = false;

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver = true;
  }

  onDragLeave(): void {
    this.dragOver = false;
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver = false;
    const f = ev.dataTransfer?.files?.[0];
    if (f) this.handleFile(f);
  }

  onFileChange(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) this.handleFile(f);
  }

  private handleFile(f: File): void {
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXT.includes(ext)) {
      this.errorChange.emit('Only CSV or Excel (.xlsx/.xls) files are supported.');
      return;
    }
    if (f.size > MAX_BYTES) {
      this.errorChange.emit('File is too large (max 15 MB).');
      return;
    }
    this.errorChange.emit('');
    this.fileSelected.emit(f);
  }

  fileSizeKb(f: File): string {
    return (f.size / 1024).toFixed(1);
  }
}
