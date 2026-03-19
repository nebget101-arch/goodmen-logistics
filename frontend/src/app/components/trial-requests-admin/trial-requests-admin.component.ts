import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
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
  dot_number?: string | null;
  mc_number?: string | null;
  requested_plan: 'basic' | 'multi_mc' | 'end_to_end';
  wants_demo_assistance?: boolean;
  notes?: string | null;
  status: TrialRequestStatus;
  created_at: string;
  updated_at?: string;
}

/** FN-102: FMCSA lookup state tracked per trial-request row */
interface FmcsaState {
  status: 'idle' | 'loading' | 'active' | 'inactive' | 'not-found' | 'error';
  data?: {
    dotNumber?: string;
    legalName?: string;
    dbaName?: string;
    mcNumber?: string | null;
    authorityType?: string;
    phone?: string;
    city?: string;
    state?: string;
    zip?: string;
    safetyRating?: string;
    oosPercent?: number | null;
    totalDrivers?: number | null;
    totalTrucks?: number | null;
  } | null;
}

@Component({
  selector: 'app-trial-requests-admin',
  templateUrl: './trial-requests-admin.component.html',
  styleUrls: ['./trial-requests-admin.component.css']
})
export class TrialRequestsAdminComponent implements OnInit, OnDestroy {
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
  activationLink = '';
  activationExpiresAt = '';
  activationRequestId = '';
  tempPassword = '';
  tempPasswordRequestId = '';
  tempPasswordUsername = '';
  tempPasswordEmail = '';

  /** FN-102: FMCSA lookup state per record id */
  dotFmcsa = new Map<string, FmcsaState>();

  /** FN-102: Manual DOT edit state per record id */
  dotEditValue = new Map<string, string>();
  dotSavingId: string | null = null;

  private dotLookupSubs = new Map<string, Subscription>();

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

  ngOnDestroy(): void {
    this.dotLookupSubs.forEach(sub => sub.unsubscribe());
    this.dotLookupSubs.clear();
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

          // FN-102: kick off lazy DOT lookups for rows that have a dot_number
          this.scheduleFmcsaQueue(this.records);
        },
        error: (err: any) => {
          this.error = err?.error?.error || 'Failed to load trial requests';
          this.loading = false;
          this.refreshing = false;
        }
      });
  }

  // ─── FN-102: FMCSA lookup helpers ─────────────────────────────────────────

  /**
   * Queue staggered lookups for all rows that carry a DOT number and haven't
   * been fetched yet. Staggering avoids hammering the FMCSA API if the list
   * contains many DOT numbers.
   */
  private scheduleFmcsaQueue(records: TrialRequestRecord[]): void {
    const pending = records.filter(
      r => r.dot_number && !this.dotFmcsa.has(r.id)
    );
    pending.forEach((record, idx) => {
      // Mark as loading immediately so the badge renders right away.
      this.dotFmcsa.set(record.id, { status: 'loading', data: null });
      setTimeout(() => this.fetchFmcsa(record, false), idx * 180);
    });
  }

  /** Perform (or re-perform) an FMCSA lookup for one record. */
  fetchFmcsa(record: TrialRequestRecord, force = false): void {
    const dot = record.dot_number;
    if (!dot) {
      this.dotFmcsa.set(record.id, { status: 'idle', data: null });
      return;
    }

    // Cancel any in-flight sub for this record.
    this.dotLookupSubs.get(record.id)?.unsubscribe();
    this.dotFmcsa.set(record.id, { status: 'loading', data: null });

    const sub = this.api.fmcsaLookup(dot, force).subscribe({
      next: (result) => {
        if (!result.found) {
          this.dotFmcsa.set(record.id, { status: 'not-found', data: null });
          return;
        }
        this.dotFmcsa.set(record.id, {
          status: result.status === 'ACTIVE' ? 'active' : 'inactive',
          data: result
        });
      },
      error: (err: any) => {
        if (err?.status === 404) {
          this.dotFmcsa.set(record.id, { status: 'not-found', data: null });
        } else {
          this.dotFmcsa.set(record.id, { status: 'error', data: null });
        }
      }
    });
    this.dotLookupSubs.set(record.id, sub);
  }

  /** Admin re-verifies a DOT, bypassing the 1-hour backend cache. */
  reVerifyFmcsa(record: TrialRequestRecord): void {
    this.fetchFmcsa(record, true);
  }

  /** Returns the FmcsaState for a record, or a sensible default. */
  getFmcsa(record: TrialRequestRecord): FmcsaState {
    return this.dotFmcsa.get(record.id) ?? { status: 'idle', data: null };
  }

  /** Human-readable badge label for the DOT status. */
  dotBadgeLabel(record: TrialRequestRecord): string {
    if (!record.dot_number) return 'ℹ️ No DOT';
    const state = this.getFmcsa(record);
    switch (state.status) {
      case 'loading':   return '⏳ Checking…';
      case 'active':    return '✅ Active';
      case 'inactive':  return '⚠️ Inactive';
      case 'not-found': return '❌ Not Found';
      case 'error':     return '— Unavailable';
      default:          return record.dot_number;
    }
  }

  dotBadgeClass(record: TrialRequestRecord): string {
    if (!record.dot_number) return 'fmcsa-badge-nodot';
    const state = this.getFmcsa(record);
    switch (state.status) {
      case 'loading':   return 'fmcsa-badge-loading';
      case 'active':    return 'fmcsa-badge-active';
      case 'inactive':  return 'fmcsa-badge-inactive';
      case 'not-found': return 'fmcsa-badge-notfound';
      default:          return 'fmcsa-badge-error';
    }
  }

  /** Risk signal chips shown in the detail panel. */
  riskSignals(record: TrialRequestRecord): Array<{ label: string; severity: 'red' | 'amber' }> {
    const state = this.getFmcsa(record);
    if (!state.data) return [];
    const chips: Array<{ label: string; severity: 'red' | 'amber' }> = [];

    if (state.status === 'inactive') {
      chips.push({ label: 'Not Authorized to Operate', severity: 'red' });
    }
    const rating = (state.data.safetyRating || '').toLowerCase();
    if (rating === 'unsatisfactory' || rating === 'conditional') {
      chips.push({ label: `Safety Rating: ${state.data.safetyRating}`, severity: 'red' });
    }
    const oos = state.data.oosPercent;
    if (typeof oos === 'number') {
      if (oos > 34) {
        chips.push({ label: `OOS Rate ${oos.toFixed(1)}% — Very High`, severity: 'red' });
      } else if (oos > 20) {
        chips.push({ label: `OOS Rate ${oos.toFixed(1)}% — Above National Avg`, severity: 'amber' });
      }
    }
    return chips;
  }

  /** FMCSA SAFER link for a given DOT number. */
  saferUrl(dot: string): string {
    return `https://safer.fmcsa.dot.gov/query.asp?query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(dot)}`;
  }

  // ─── FN-102: Manual DOT/MC save ───────────────────────────────────────────

  getDotEditValue(record: TrialRequestRecord): string {
    return this.dotEditValue.get(record.id) ?? (record.dot_number || '');
  }

  onDotEditChange(record: TrialRequestRecord, value: string): void {
    this.dotEditValue.set(record.id, value.replace(/\D/g, '').slice(0, 8));
  }

  onDotEditBlur(record: TrialRequestRecord): void {
    const newDot = (this.dotEditValue.get(record.id) ?? '').trim();
    const currentDot = (record.dot_number ?? '').trim();
    if (newDot === currentDot) return; // no change
    this.saveDotMc(record, newDot || null, record.mc_number ?? null);
  }

  saveDotMc(
    record: TrialRequestRecord,
    dotNumber: string | null,
    mcNumber: string | null
  ): void {
    this.dotSavingId = record.id;
    this.error = '';
    this.api.patchTrialRequestDotMc(record.id, dotNumber, mcNumber).subscribe({
      next: (res: any) => {
        const updated = res?.data || {};
        this.records = this.records.map(r => r.id === record.id ? { ...r, ...updated } : r);
        if (this.selectedRecord?.id === record.id) {
          this.selectedRecord = { ...record, ...updated };
        }
        this.dotSavingId = null;
        this.dotEditValue.delete(record.id);
        // Trigger FMCSA lookup for the new DOT.
        if (dotNumber) {
          this.dotFmcsa.delete(record.id);
          const fresh = this.records.find(r => r.id === record.id);
          if (fresh) this.fetchFmcsa(fresh, false);
        }
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Failed to save DOT number';
        this.dotSavingId = null;
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

  getActivationLink(record: TrialRequestRecord, regenerate = false): void {
    this.error = '';
    this.message = '';
    this.actionLoadingId = record.id;

    this.api.getTrialRequestActivationLink(record.id, regenerate).subscribe({
      next: (res: any) => {
        const data = res?.data || {};
        this.activationLink = String(data.activationLink || '').trim();
        this.activationExpiresAt = String(data.activationExpiresAt || '').trim();
        this.activationRequestId = record.id;
        this.actionLoadingId = null;

        if (!this.activationLink) {
          this.message = 'Activation link is not available for this request.';
          return;
        }

        this.copyActivationLink(false)
          .then((copied) => {
            this.message = copied
              ? 'Signup link generated and copied. Share it with the customer.'
              : 'Signup link ready. Copy failed automatically — please use the Copy button.';
          })
          .catch(() => {
            this.message = 'Signup link ready. Copy failed automatically — please use the Copy button.';
          });
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Failed to get activation link';
        this.actionLoadingId = null;
      }
    });
  }

  async copyActivationLink(showSuccessMessage = true): Promise<boolean> {
    if (!this.activationLink) return false;
    const text = this.activationLink;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', 'true');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(input);
        if (!copied) throw new Error('Clipboard copy command failed');
      }

      if (showSuccessMessage) {
        this.message = 'Activation link copied.';
      }
      this.error = '';
      return true;
    } catch {
      this.openCopyPrompt(text);
      this.error = '';
      if (showSuccessMessage) {
        this.message = 'Clipboard access is blocked by your browser. A manual copy dialog was opened.';
      }
      return false;
    }
  }

  private openCopyPrompt(text: string): void {
    try {
      window.prompt('Copy this signup link:', text);
    } catch {
      // no-op: keep existing message if prompt is not available
    }
  }

  approve(record: TrialRequestRecord): void {
    this.updateStatus(record, 'approved', 'Trial request approved.');
  }

  resetTenantAdminPassword(record: TrialRequestRecord): void {
    const confirmed = window.confirm(
      'Reset this tenant admin password now? A new temporary password will be generated and shown once.'
    );
    if (!confirmed) return;

    this.error = '';
    this.message = '';
    this.actionLoadingId = record.id;

    this.api.resetTenantAdminPassword(record.id).subscribe({
      next: (res: any) => {
        const data = res?.data || {};
        this.tempPassword = String(data.temporaryPassword || '').trim();
        this.tempPasswordUsername = String(data.username || '').trim();
        this.tempPasswordEmail = String(data.email || '').trim();
        this.tempPasswordRequestId = record.id;
        this.actionLoadingId = null;

        if (!this.tempPassword) {
          this.message = 'Password reset completed, but no temporary password was returned.';
          return;
        }

        this.copyTemporaryPassword(false)
          .then((copied) => {
            this.message = copied
              ? 'Tenant admin password reset and temporary password copied.'
              : 'Tenant admin password reset. Copy failed automatically — please use the Copy button.';
          })
          .catch(() => {
            this.message = 'Tenant admin password reset. Copy failed automatically — please use the Copy button.';
          });
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Failed to reset tenant admin password';
        this.actionLoadingId = null;
      }
    });
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

        if (status === 'approved') {
          const activationLink = String(res?.emailDelivery?.activationLink || '').trim();
          if (activationLink) {
            this.activationLink = activationLink;
            this.activationExpiresAt = String(res?.emailDelivery?.activationExpiresAt || '').trim();
            this.activationRequestId = record.id;
          }
          const emailSent = Boolean(res?.emailDelivery?.requesterApprovedNotificationSent);
          this.message = emailSent
            ? `${successMessage} Approval email sent to requester.`
            : `${successMessage} Approval email failed; share the activation link manually.`;
        } else {
          this.message = successMessage;
        }

        this.actionLoadingId = null;
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

  canGetSignupLink(record: TrialRequestRecord): boolean {
    return record.status === 'approved';
  }

  canResetTenantAdminPassword(record: TrialRequestRecord): boolean {
    return record.status === 'trial_created';
  }

  async copyTemporaryPassword(showSuccessMessage = true): Promise<boolean> {
    if (!this.tempPassword) return false;
    const copied = await this.copyTextToClipboard(this.tempPassword);
    if (showSuccessMessage && copied) {
      this.message = 'Temporary password copied.';
    }
    return copied;
  }

  private async copyTextToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', 'true');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(input);
        if (!copied) throw new Error('Clipboard copy command failed');
      }

      this.error = '';
      return true;
    } catch {
      this.openCopyPrompt(text);
      this.error = '';
      return false;
    }
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
