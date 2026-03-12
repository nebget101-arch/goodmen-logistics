import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

type TrialRequestStatus =
  | 'new'
  | 'contacted'
  | 'approved'
  | 'rejected'
  | 'converted'
  | 'trial_created';

interface TrialRequestRecord {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  fleet_size?: string | null;
  current_system?: string | null;
  requested_plan: 'basic' | 'multi_mc' | 'end_to_end';
  wants_demo_assistance?: boolean;
  notes?: string | null;
  status: TrialRequestStatus;
  created_at: string;
  updated_at?: string;
}

@Component({
  selector: 'app-trial-requests-admin',
  templateUrl: './trial-requests-admin.component.html',
  styleUrls: ['./trial-requests-admin.component.css']
})
export class TrialRequestsAdminComponent implements OnInit {
  loading = false;
  refreshing = false;
  error = '';
  message = '';

  selectedStatus: TrialRequestStatus | 'all' = 'new';
  page = 1;
  pageSize = 25;
  records: TrialRequestRecord[] = [];

  selectedRecord: TrialRequestRecord | null = null;
  actionLoadingId: string | null = null;

  readonly statusOptions: Array<{ value: TrialRequestStatus | 'all'; label: string }> = [
    { value: 'all', label: 'All statuses' },
    { value: 'new', label: 'New' },
    { value: 'contacted', label: 'Contacted' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'converted', label: 'Converted' },
    { value: 'trial_created', label: 'Trial created' }
  ];

  readonly planLabels: Record<string, string> = {
    basic: 'Basic',
    multi_mc: 'Multi-MC',
    end_to_end: 'End-to-End'
  };

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadTrialRequests();
  }

  loadTrialRequests(isRefresh = false): void {
    this.error = '';
    this.message = '';
    this.loading = !isRefresh;
    this.refreshing = isRefresh;

    this.api
      .listTrialRequests({
        status: this.selectedStatus === 'all' ? undefined : this.selectedStatus,
        page: this.page,
        pageSize: this.pageSize
      })
      .subscribe({
        next: (res: any) => {
          this.records = Array.isArray(res?.data) ? res.data : [];
          this.loading = false;
          this.refreshing = false;

          if (this.selectedRecord) {
            const latest = this.records.find((r) => r.id === this.selectedRecord?.id) || null;
            this.selectedRecord = latest;
          }
        },
        error: (err: any) => {
          this.error = err?.error?.error || 'Failed to load trial requests';
          this.loading = false;
          this.refreshing = false;
        }
      });
  }

  onStatusFilterChange(value: TrialRequestStatus | 'all'): void {
    this.selectedStatus = value;
    this.page = 1;
    this.loadTrialRequests();
  }

  selectRecord(record: TrialRequestRecord): void {
    this.selectedRecord = this.selectedRecord?.id === record.id ? null : record;
  }

  approve(record: TrialRequestRecord): void {
    this.updateStatus(record, 'approved', 'Trial request approved.');
  }

  reject(record: TrialRequestRecord): void {
    this.updateStatus(record, 'rejected', 'Trial request rejected.');
  }

  markContacted(record: TrialRequestRecord): void {
    this.updateStatus(record, 'contacted', 'Marked as contacted.');
  }

  private updateStatus(
    record: TrialRequestRecord,
    status: TrialRequestStatus,
    successMessage: string
  ): void {
    this.error = '';
    this.message = '';
    this.actionLoadingId = record.id;

    this.api.updateTrialRequestStatus(record.id, status).subscribe({
      next: (res: any) => {
        const updated = (res?.data || {}) as TrialRequestRecord;
        this.records = this.records.map((r) => (r.id === record.id ? { ...r, ...updated } : r));
        if (this.selectedRecord?.id === record.id) {
          this.selectedRecord = { ...record, ...updated };
        }
        this.actionLoadingId = null;
        this.message = successMessage;
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Failed to update status';
        this.actionLoadingId = null;
      }
    });
  }

  canApprove(record: TrialRequestRecord): boolean {
    return ['new', 'contacted'].includes(record.status);
  }

  canReject(record: TrialRequestRecord): boolean {
    return ['new', 'contacted', 'approved'].includes(record.status);
  }

  canMarkContacted(record: TrialRequestRecord): boolean {
    return record.status === 'new';
  }

  statusClass(status: TrialRequestStatus): string {
    return `status-${status}`;
  }

  formatDate(value?: string | null): string {
    if (!value) return '—';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString();
  }
}
