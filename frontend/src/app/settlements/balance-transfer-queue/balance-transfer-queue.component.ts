import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

export interface BalanceTransfer {
  id: string;
  tenantId: string;
  sourceDriverId: string | null;
  sourceSettlementId: string | null;
  targetEquipmentOwnerId: string | null;
  amount: number;
  reason: string;
  status: 'pending_approval' | 'approved' | 'applied' | 'rejected';
  requestedAt: string;
  reviewedAt: string | null;
  reviewNotes: string | null;
}

@Component({
  selector: 'app-balance-transfer-queue',
  templateUrl: './balance-transfer-queue.component.html',
  styleUrls: ['./balance-transfer-queue.component.css']
})
export class BalanceTransferQueueComponent implements OnInit, OnDestroy {
  transfers: BalanceTransfer[] = [];
  loading = false;
  error = '';
  successMessage = '';

  statusFilter = '';
  readonly statusOptions = [
    { value: 'pending_approval', label: 'Pending approval' },
    { value: 'approved', label: 'Approved' },
    { value: 'applied', label: 'Applied' },
    { value: 'rejected', label: 'Rejected' }
  ];

  // Review modal state
  showReviewModal = false;
  reviewingTransfer: BalanceTransfer | null = null;
  reviewAction: 'approve' | 'reject' | null = null;
  reviewNotes = '';
  saving = false;

  private destroy$ = new Subject<void>();

  constructor(
    private apiService: ApiService,
    private operatingEntityContext: OperatingEntityContextService
  ) {}

  ngOnInit(): void {
    this.operatingEntityContext.context$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (state.isLoaded) this.loadTransfers();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadTransfers(): void {
    this.loading = true;
    this.error = '';
    const filters: any = {};
    if (this.statusFilter) filters.status = this.statusFilter;
    this.apiService.listBalanceTransfers(filters).subscribe({
      next: (rows: any) => {
        const list = Array.isArray(rows) ? rows : rows?.data ?? rows?.rows ?? [];
        this.transfers = list.map((r: any) => this.mapRow(r));
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to load balance transfers';
        this.loading = false;
      }
    });
  }

  private mapRow(r: any): BalanceTransfer {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      sourceDriverId: r.source_driver_id || null,
      sourceSettlementId: r.source_settlement_id || null,
      targetEquipmentOwnerId: r.target_equipment_owner_id || null,
      amount: Number(r.amount) || 0,
      reason: r.reason || '',
      status: r.status || 'pending_approval',
      requestedAt: this.toDateOnly(r.requested_at),
      reviewedAt: r.reviewed_at ? this.toDateOnly(r.reviewed_at) : null,
      reviewNotes: r.review_notes || null
    };
  }

  private toDateOnly(value: any): string {
    if (!value) return '';
    const str = String(value);
    const iso = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? str : d.toISOString().slice(0, 10);
  }

  openApprove(transfer: BalanceTransfer): void {
    this.reviewingTransfer = transfer;
    this.reviewAction = 'approve';
    this.reviewNotes = '';
    this.showReviewModal = true;
  }

  openReject(transfer: BalanceTransfer): void {
    this.reviewingTransfer = transfer;
    this.reviewAction = 'reject';
    this.reviewNotes = '';
    this.showReviewModal = true;
  }

  cancelReview(): void {
    this.showReviewModal = false;
    this.reviewingTransfer = null;
    this.reviewAction = null;
    this.reviewNotes = '';
  }

  confirmReview(): void {
    if (!this.reviewingTransfer || !this.reviewAction || this.saving) return;
    this.saving = true;
    this.error = '';
    this.successMessage = '';

    const obs = this.reviewAction === 'approve'
      ? this.apiService.approveBalanceTransfer(this.reviewingTransfer.id, this.reviewNotes)
      : this.apiService.rejectBalanceTransfer(this.reviewingTransfer.id, this.reviewNotes);

    obs.subscribe({
      next: () => {
        this.successMessage = `Transfer ${this.reviewAction === 'approve' ? 'approved' : 'rejected'}.`;
        this.saving = false;
        this.cancelReview();
        this.loadTransfers();
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Action failed';
        this.saving = false;
      }
    });
  }

  getStatusClass(status: string): string {
    const m: Record<string, string> = {
      pending_approval: 'badge-pending',
      approved: 'badge-approved',
      applied: 'badge-applied',
      rejected: 'badge-rejected'
    };
    return m[status] ?? 'badge-muted';
  }

  getStatusLabel(status: string): string {
    const m: Record<string, string> = {
      pending_approval: 'Pending approval',
      approved: 'Approved',
      applied: 'Applied',
      rejected: 'Rejected'
    };
    return m[status] ?? status;
  }

  getReasonLabel(reason: string): string {
    const m: Record<string, string> = {
      driver_quit: 'Driver quit',
      driver_terminated: 'Driver terminated',
      manual: 'Manual'
    };
    return m[reason] ?? reason;
  }
}
