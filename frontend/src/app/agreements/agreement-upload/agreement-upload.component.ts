import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AgreementService } from '../agreement.service';

/**
 * FN-1794 — agreement upload screen.
 * Drag/drop (or browse) a PDF, name the template, then create it. The backend
 * stores the file and runs AI field detection; on success we route to the
 * field-mapping review screen for the new draft template.
 */
@Component({
  selector: 'app-agreement-upload',
  templateUrl: './agreement-upload.component.html',
  styleUrls: ['./agreement-upload.component.css'],
})
export class AgreementUploadComponent {
  selectedFile: File | null = null;
  templateName = '';
  dragOver = false;
  uploading = false;
  error = '';

  /** 25 MB upload ceiling — scanned lease PDFs can be large. */
  private readonly MAX_BYTES = 25 * 1024 * 1024;

  constructor(private agreements: AgreementService, private router: Router) {}

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
    const isPdf = ext === 'pdf' || file.type === 'application/pdf';
    if (!isPdf) {
      this.error = 'Only PDF files are supported.';
      return;
    }
    if (file.size > this.MAX_BYTES) {
      this.error = 'File is too large (max 25 MB).';
      return;
    }
    this.selectedFile = file;
    this.error = '';
    // Pre-fill the template name from the file name (sans extension) if empty.
    if (!this.templateName.trim()) {
      this.templateName = file.name.replace(/\.pdf$/i, '');
    }
  }

  clearFile(): void {
    this.selectedFile = null;
    this.error = '';
  }

  get canSubmit(): boolean {
    return !!this.selectedFile && !!this.templateName.trim() && !this.uploading;
  }

  submit(): void {
    if (!this.canSubmit || !this.selectedFile) return;
    this.uploading = true;
    this.error = '';
    this.agreements.createTemplate(this.selectedFile, this.templateName.trim()).subscribe({
      next: (res) => {
        this.uploading = false;
        this.router.navigate(['/agreements', res.id, 'review']);
      },
      error: (err) => {
        this.uploading = false;
        this.error = err?.error?.error || 'Upload failed. Please try again.';
      },
    });
  }
}
