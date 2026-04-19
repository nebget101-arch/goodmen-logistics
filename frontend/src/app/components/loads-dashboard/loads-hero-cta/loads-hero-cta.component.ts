// FN-743 — Loads Hero CTA
// Prominent entry-point panel replacing the old "New Load" dropdown.
// Emits typed events so the parent (loads-dashboard) handles modal logic.

import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-loads-hero-cta',
  templateUrl: './loads-hero-cta.component.html',
  styleUrls: ['./loads-hero-cta.component.scss'],
})
export class LoadsHeroCtaComponent {
  /** Fires when exactly 1 PDF is dropped or selected — triggers single AI flow. */
  @Output() singlePdfSelected = new EventEmitter<File>();
  /** Fires when 2–10 PDFs are dropped or selected — triggers bulk AI flow. */
  @Output() bulkPdfsSelected = new EventEmitter<File[]>();
  /** Fires when the user clicks "Create Manually". */
  @Output() manualCreateClick = new EventEmitter<void>();
  /** Fires when the user clicks "Clone Existing Load". */
  @Output() cloneLoadClick = new EventEmitter<void>();

  isDragOver = false;
  showForwardEmailModal = false;

  /**
   * Stubbed tenant inbound address.
   * Will be replaced by a real API call once FN-726 (email inbound story) lands.
   */
  readonly tenantInboundEmail = 'loads@<your-tenant>.fleetneuron.io';

  // ── Drag-and-drop ───────────────────────────────────────────────────────

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.stopPropagation();
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
    this._handleFiles(event.dataTransfer?.files ?? null);
  }

  /** Called from template via `(change)="onFileInput($event, fileInput)"`. */
  onFileInput(event: Event, inputEl: HTMLInputElement): void {
    this._handleFiles(inputEl.files);
    // Reset so the same file can trigger a new upload
    inputEl.value = '';
  }

  // ── CTA actions ─────────────────────────────────────────────────────────

  openForwardEmailModal(): void {
    this.showForwardEmailModal = true;
  }

  closeForwardEmailModal(): void {
    this.showForwardEmailModal = false;
  }

  onManualCreate(): void {
    this.manualCreateClick.emit();
  }

  onCloneLoad(): void {
    this.cloneLoadClick.emit();
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private _handleFiles(files: FileList | null): void {
    if (!files || files.length === 0) return;
    const pdfs = Array.from(files)
      .filter((f) => f.type === 'application/pdf')
      .slice(0, 10);
    if (pdfs.length === 0) return;
    if (pdfs.length === 1) {
      this.singlePdfSelected.emit(pdfs[0]);
    } else {
      this.bulkPdfsSelected.emit(pdfs);
    }
  }
}
