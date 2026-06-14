import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AgreementService } from '../agreement.service';

/**
 * FN-1794 — agreement upload screen.
 * Drag/drop (or browse) a PDF, name the template, then create it. The backend
 * stores the file and runs AI field detection; on success we route to the
 * field-mapping review screen for the new draft template.
 *
 * FN-1801 — when entered from an equipment subject (a vehicle / equipment-owner),
 * `subjectType`/`subjectId`/`subjectLabel` ride along as query params so the rest
 * of the flow stays scoped to that subject and the send step links the signing
 * back to it. We surface a banner for context and preserve the params on navigate.
 */
@Component({
  selector: 'app-agreement-upload',
  templateUrl: './agreement-upload.component.html',
  styleUrls: ['./agreement-upload.component.css'],
})
export class AgreementUploadComponent implements OnInit {
  selectedFile: File | null = null;
  templateName = '';
  dragOver = false;
  uploading = false;
  error = '';

  /** FN-1801 — equipment-subject context carried through the flow (optional). */
  subjectLabel = '';

  /** 25 MB upload ceiling — scanned lease PDFs can be large. */
  private readonly MAX_BYTES = 25 * 1024 * 1024;

  constructor(
    private agreements: AgreementService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.subjectLabel = this.route.snapshot.queryParamMap.get('subjectLabel') || '';
  }

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
        // Preserve any equipment-subject context (FN-1801) into the review step.
        this.router.navigate(['/agreements', res.id, 'review'], {
          queryParamsHandling: 'preserve',
        });
      },
      error: (err) => {
        this.uploading = false;
        this.error = err?.error?.error || 'Upload failed. Please try again.';
      },
    });
  }
}
