import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import {
  EmployerInvestigationService,
  HistoryFileEntry
} from '../../../services/employer-investigation.service';
import { ApiService } from '../../../services/api.service';

@Component({
  selector: 'app-investigation-history',
  templateUrl: './investigation-history.component.html',
  styleUrls: ['./investigation-history.component.css']
})
export class InvestigationHistoryComponent implements OnInit, OnChanges {
  @Input() driverId = '';

  entries: HistoryFileEntry[] = [];
  loading = true;
  error = '';

  readonly entryTypeLabels: Record<string, string> = {
    inquiry_sent: 'Inquiry Sent',
    follow_up_sent: 'Follow-Up Sent',
    response_received: 'Response Received',
    no_response_documented: 'No Response',
    investigation_initiated: 'Investigation Initiated',
    investigation_completed: 'Investigation Completed'
  };

  readonly entryTypeIcons: Record<string, string> = {
    inquiry_sent: 'send',
    follow_up_sent: 'forward_to_inbox',
    response_received: 'mark_email_read',
    no_response_documented: 'do_not_disturb',
    investigation_initiated: 'play_arrow',
    investigation_completed: 'check_circle'
  };

  constructor(
    private investigationService: EmployerInvestigationService,
    private apiService: ApiService
  ) {}

  ngOnInit(): void {
    if (this.driverId) {
      this.loadHistory();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['driverId'] && !changes['driverId'].firstChange) {
      this.loadHistory();
    }
  }

  loadHistory(): void {
    if (!this.driverId) return;
    this.loading = true;
    this.error = '';

    this.investigationService.getHistoryFile(this.driverId).subscribe({
      next: (entries) => {
        this.entries = entries;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading investigation history:', err);
        this.error = 'Unable to load investigation history file.';
        this.loading = false;
      }
    });
  }

  getEntryTypeClass(entryType: string): string {
    switch (entryType) {
      case 'inquiry_sent':
      case 'follow_up_sent':
        return 'ih-type-action';
      case 'response_received':
      case 'investigation_completed':
        return 'ih-type-success';
      case 'no_response_documented':
        return 'ih-type-warning';
      case 'investigation_initiated':
        return 'ih-type-info';
      default:
        return 'ih-type-default';
    }
  }

  downloadDocument(documentId: string): void {
    this.apiService.downloadDriverGeneratedDocumentBlob(documentId).subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'investigation-document.pdf';
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: () => {
        alert('Failed to download document.');
      }
    });
  }

  printHistory(): void {
    window.print();
  }
}
