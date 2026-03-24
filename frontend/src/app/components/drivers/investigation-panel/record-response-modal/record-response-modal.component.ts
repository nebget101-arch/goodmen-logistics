import { Component, Input, Output, EventEmitter } from '@angular/core';
import {
  EmployerInvestigationService,
  PastEmployerInvestigation,
  RecordResponsePayload
} from '../../../../services/employer-investigation.service';
import { ApiService } from '../../../../services/api.service';

@Component({
  selector: 'app-record-response-modal',
  templateUrl: './record-response-modal.component.html',
  styleUrls: ['./record-response-modal.component.css']
})
export class RecordResponseModalComponent {
  @Input() pastEmployerId = '';
  @Input() employerName = '';
  @Output() saved = new EventEmitter<PastEmployerInvestigation>();
  @Output() closed = new EventEmitter<void>();

  responseType = '';
  receivedVia = '';
  notes = '';
  selectedFile: File | null = null;
  uploadedDocumentId: string | null = null;
  uploading = false;
  saving = false;

  readonly responseTypes = [
    'Employment Verification',
    'Accident History',
    'Drug/Alcohol History',
    'Safety Performance'
  ];

  readonly receivedViaOptions = [
    'Fax',
    'Email',
    'Mail',
    'Phone',
    'Clearinghouse'
  ];

  constructor(
    private investigationService: EmployerInvestigationService,
    private apiService: ApiService
  ) {}

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
    }
  }

  uploadFile(): void {
    if (!this.selectedFile) return;
    this.uploading = true;

    // Use the existing DQF document upload pattern
    this.apiService.uploadDQFDocument(this.pastEmployerId, 'investigation_response', this.selectedFile).subscribe({
      next: (response: { document: { id: string } }) => {
        this.uploadedDocumentId = response.document.id;
        this.uploading = false;
      },
      error: (err: unknown) => {
        console.error('Error uploading document:', err);
        alert('Failed to upload document. Please try again.');
        this.uploading = false;
      }
    });
  }

  save(): void {
    if (!this.responseType || !this.receivedVia) {
      alert('Please select response type and received via.');
      return;
    }

    this.saving = true;

    const payload: RecordResponsePayload = {
      responseType: this.responseType,
      receivedVia: this.receivedVia,
      notes: this.notes
    };

    if (this.uploadedDocumentId) {
      payload.documentId = this.uploadedDocumentId;
    }

    this.investigationService.recordResponse(this.pastEmployerId, payload).subscribe({
      next: (updated) => {
        this.saving = false;
        this.saved.emit(updated);
      },
      error: (err) => {
        console.error('Error recording response:', err);
        alert('Failed to record response. Please try again.');
        this.saving = false;
      }
    });
  }

  close(): void {
    this.closed.emit();
  }
}
