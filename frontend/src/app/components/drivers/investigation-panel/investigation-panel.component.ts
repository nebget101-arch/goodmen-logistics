import { Component, Input, OnInit, OnChanges, SimpleChanges, EventEmitter, Output } from '@angular/core';
import {
  EmployerInvestigationService,
  EmployerResponse,
  InvestigationStatus,
  PastEmployerInvestigation
} from '../../../services/employer-investigation.service';

@Component({
  selector: 'app-investigation-panel',
  templateUrl: './investigation-panel.component.html',
  styleUrls: ['./investigation-panel.component.css']
})
export class InvestigationPanelComponent implements OnInit, OnChanges {
  @Input() driverId = '';
  @Output() historyUpdated = new EventEmitter<void>();

  investigationStatus: InvestigationStatus | null = null;
  loading = true;
  error = '';
  actionInProgress: string | null = null;

  // Record response modal
  showRecordResponseModal = false;
  selectedEmployerId = '';
  selectedEmployerName = '';

  readonly statusSteps: PastEmployerInvestigation['status'][] = [
    'not_started',
    'inquiry_sent',
    'follow_up_sent',
    'response_received',
    'complete'
  ];

  readonly statusLabels: Record<string, string> = {
    not_started: 'Not Started',
    inquiry_sent: 'Inquiry Sent',
    follow_up_sent: 'Follow-Up Sent',
    response_received: 'Response Received',
    no_response_documented: 'No Response',
    complete: 'Complete'
  };

  constructor(private investigationService: EmployerInvestigationService) {}

  ngOnInit(): void {
    if (this.driverId) {
      this.loadStatus();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['driverId'] && !changes['driverId'].firstChange) {
      this.loadStatus();
    }
  }

  loadStatus(): void {
    if (!this.driverId) return;
    this.loading = true;
    this.error = '';

    this.investigationService.getInvestigationStatus(this.driverId).subscribe({
      next: (status) => {
        this.investigationStatus = status
          ? {
              ...status,
              pastEmployers: status.pastEmployers ?? [],
              completedCount: status.completedCount ?? 0,
              totalCount: status.totalCount ?? 0
            }
          : null;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading investigation status:', err);
        this.error = 'Unable to load employer investigation status.';
        this.investigationStatus = null;
        this.loading = false;
      }
    });
  }

  get progressPercent(): number {
    if (!this.investigationStatus || this.investigationStatus.totalCount === 0) return 0;
    return Math.round(
      (this.investigationStatus.completedCount / this.investigationStatus.totalCount) * 100
    );
  }

  get hasNotStarted(): boolean {
    if (!this.investigationStatus) return false;
    return this.investigationStatus.pastEmployers.some(e => e.status === 'not_started');
  }

  initiateAll(): void {
    if (!this.driverId) return;
    this.actionInProgress = 'initiate-all';

    this.investigationService.initiateInvestigation(this.driverId).subscribe({
      next: (status) => {
        this.investigationStatus = status;
        this.actionInProgress = null;
        this.historyUpdated.emit();
      },
      error: (err) => {
        console.error('Error initiating investigations:', err);
        alert('Failed to initiate investigations. Please try again.');
        this.actionInProgress = null;
      }
    });
  }

  sendInquiry(employer: PastEmployerInvestigation): void {
    this.actionInProgress = employer.id;

    this.investigationService.sendInquiry(employer.id).subscribe({
      next: (updated) => {
        this.updateEmployer(updated);
        this.actionInProgress = null;
        this.historyUpdated.emit();
      },
      error: (err) => {
        console.error('Error sending inquiry:', err);
        alert('Failed to send inquiry. Please try again.');
        this.actionInProgress = null;
      }
    });
  }

  sendFollowUp(employer: PastEmployerInvestigation): void {
    this.actionInProgress = employer.id;

    this.investigationService.sendFollowUp(employer.id).subscribe({
      next: (updated) => {
        this.updateEmployer(updated);
        this.actionInProgress = null;
        this.historyUpdated.emit();
      },
      error: (err) => {
        console.error('Error sending follow-up:', err);
        alert('Failed to send follow-up. Please try again.');
        this.actionInProgress = null;
      }
    });
  }

  openRecordResponse(employer: PastEmployerInvestigation): void {
    this.selectedEmployerId = employer.id;
    this.selectedEmployerName = employer.employerName;
    this.showRecordResponseModal = true;
  }

  onResponseRecorded(updated: PastEmployerInvestigation): void {
    this.updateEmployer(updated);
    this.showRecordResponseModal = false;
    this.selectedEmployerId = '';
    this.historyUpdated.emit();
  }

  onRecordResponseClosed(): void {
    this.showRecordResponseModal = false;
    this.selectedEmployerId = '';
  }

  documentNoResponse(employer: PastEmployerInvestigation): void {
    const notes = prompt('Enter notes for documenting no response:');
    if (notes === null) return;

    this.actionInProgress = employer.id;

    this.investigationService.documentNoResponse(employer.id, notes).subscribe({
      next: (updated) => {
        this.updateEmployer(updated);
        this.actionInProgress = null;
        this.historyUpdated.emit();
      },
      error: (err) => {
        console.error('Error documenting no response:', err);
        alert('Failed to document no response. Please try again.');
        this.actionInProgress = null;
      }
    });
  }

  getDaysRemaining(deadline: string): number {
    if (!deadline) return 0;
    const deadlineDate = new Date(deadline);
    const now = new Date();
    const diffMs = deadlineDate.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  getDeadlineClass(deadline: string): string {
    const days = this.getDaysRemaining(deadline);
    if (days < 0) return 'deadline-overdue';
    if (days <= 3) return 'deadline-critical';
    if (days <= 7) return 'deadline-warning';
    return 'deadline-ok';
  }

  getDeadlineLabel(deadline: string): string {
    const days = this.getDaysRemaining(deadline);
    if (days < 0) return 'OVERDUE';
    if (days === 0) return 'Due today';
    if (days === 1) return '1 day remaining';
    return `${days} days remaining`;
  }

  getStepIndex(status: PastEmployerInvestigation['status']): number {
    if (status === 'no_response_documented') return 3;
    const idx = this.statusSteps.indexOf(status);
    return idx >= 0 ? idx : 0;
  }

  isStepComplete(employer: PastEmployerInvestigation, stepIndex: number): boolean {
    return this.getStepIndex(employer.status) > stepIndex;
  }

  isStepActive(employer: PastEmployerInvestigation, stepIndex: number): boolean {
    return this.getStepIndex(employer.status) === stepIndex;
  }

  isTerminalStatus(status: string): boolean {
    return status === 'response_received' || status === 'no_response_documented' || status === 'complete';
  }

  getLatestResponse(employer: PastEmployerInvestigation): EmployerResponse | null {
    return employer.responses?.length ? employer.responses[0] : null;
  }

  hasResponseDocument(employer: PastEmployerInvestigation): boolean {
    const resp = this.getLatestResponse(employer);
    return !!resp?.documentId;
  }

  isNewResponse(employer: PastEmployerInvestigation): boolean {
    if (!employer.responseReceivedAt) return false;
    const received = new Date(employer.responseReceivedAt);
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    return received > threeDaysAgo;
  }

  downloadingDocId: string | null = null;

  downloadResponse(employer: PastEmployerInvestigation): void {
    const resp = this.getLatestResponse(employer);
    if (!resp?.documentId) return;

    this.downloadingDocId = resp.documentId;
    this.investigationService.downloadResponseDocument(resp.documentId).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `response-${employer.employerName.replace(/\s+/g, '-')}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
        this.downloadingDocId = null;
      },
      error: (err) => {
        console.error('Error downloading response document:', err);
        alert('Failed to download response document.');
        this.downloadingDocId = null;
      }
    });
  }

  formatTimestamp(ts: string | null): string {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  private updateEmployer(updated: PastEmployerInvestigation): void {
    if (!this.investigationStatus) return;
    const idx = this.investigationStatus.pastEmployers.findIndex(e => e.id === updated.id);
    if (idx >= 0) {
      this.investigationStatus.pastEmployers[idx] = updated;
    }
    // Recalculate completed count
    this.investigationStatus.completedCount = this.investigationStatus.pastEmployers
      .filter(e => this.isTerminalStatus(e.status)).length;
  }
}
