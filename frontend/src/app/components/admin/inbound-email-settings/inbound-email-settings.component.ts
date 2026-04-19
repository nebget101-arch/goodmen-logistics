import { Component, OnInit } from '@angular/core';
import {
  InboundEmailAddress,
  InboundEmailLog,
  InboundEmailLogStatus,
  InboundEmailService,
  InboundEmailWhitelistEntry
} from '../../../services/inbound-email.service';

@Component({
  selector: 'app-inbound-email-settings',
  templateUrl: './inbound-email-settings.component.html',
  styleUrls: ['./inbound-email-settings.component.css']
})
export class InboundEmailSettingsComponent implements OnInit {
  loadingAddress = false;
  loadingLogs = false;
  loadingWhitelist = false;
  sendingTest = false;

  error = '';
  message = '';

  address: InboundEmailAddress | null = null;
  logs: InboundEmailLog[] = [];
  whitelist: InboundEmailWhitelistEntry[] = [];

  selectedLog: InboundEmailLog | null = null;

  newSenderEmail = '';
  addingSender = false;
  whitelistError = '';
  removingSenderId: string | null = null;

  readonly statusLabels: Record<InboundEmailLogStatus, string> = {
    pending: 'Pending',
    processing: 'Processing',
    succeeded: 'Succeeded',
    failed: 'Failed',
    rejected_whitelist: 'Rejected — not whitelisted',
    rejected_rate_limit: 'Rejected — rate limit',
    rejected_virus: 'Rejected — virus scan'
  };

  constructor(private inboundEmail: InboundEmailService) {}

  ngOnInit(): void {
    this.refreshAll();
  }

  refreshAll(): void {
    this.loadAddress();
    this.loadLogs();
    this.loadWhitelist();
  }

  loadAddress(): void {
    this.loadingAddress = true;
    this.inboundEmail.getAddress().subscribe({
      next: (res) => {
        this.address = res?.data || null;
        this.loadingAddress = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load inbound email address.';
        this.loadingAddress = false;
      }
    });
  }

  loadLogs(): void {
    this.loadingLogs = true;
    this.inboundEmail.listLogs({ limit: 50 }).subscribe({
      next: (res) => {
        this.logs = Array.isArray(res?.data) ? res.data : [];
        this.loadingLogs = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load recent emails.';
        this.loadingLogs = false;
      }
    });
  }

  loadWhitelist(): void {
    this.loadingWhitelist = true;
    this.inboundEmail.listWhitelist().subscribe({
      next: (res) => {
        this.whitelist = Array.isArray(res?.data) ? res.data : [];
        this.loadingWhitelist = false;
      },
      error: (err) => {
        this.whitelistError = err?.error?.error || 'Failed to load sender whitelist.';
        this.loadingWhitelist = false;
      }
    });
  }

  async copyAddress(): Promise<void> {
    if (!this.address?.address) return;
    const text = this.address.address;
    this.error = '';
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
      this.flashMessage('Address copied to clipboard.');
    } catch {
      try {
        window.prompt('Copy this address:', text);
      } catch {
        /* no-op */
      }
    }
  }

  sendTestEmail(): void {
    if (!this.address?.address || this.sendingTest) return;
    this.sendingTest = true;
    this.error = '';
    this.inboundEmail.sendTestEmail().subscribe({
      next: (res) => {
        this.sendingTest = false;
        this.flashMessage(res?.message || 'Test email sent. Check the recent emails table shortly.');
        setTimeout(() => this.loadLogs(), 1500);
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to send test email.';
        this.sendingTest = false;
      }
    });
  }

  selectLog(log: InboundEmailLog): void {
    this.selectedLog = this.selectedLog?.id === log.id ? null : log;
  }

  addWhitelistSender(): void {
    const email = (this.newSenderEmail || '').trim().toLowerCase();
    this.whitelistError = '';
    if (!email) {
      this.whitelistError = 'Enter a sender email address.';
      return;
    }
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!looksLikeEmail) {
      this.whitelistError = 'Please enter a valid email address.';
      return;
    }
    if (this.whitelist.some((w) => w.sender_email.toLowerCase() === email)) {
      this.whitelistError = 'This sender is already whitelisted.';
      return;
    }
    this.addingSender = true;
    this.inboundEmail.addWhitelistEntry(email).subscribe({
      next: (res) => {
        if (res?.data) {
          this.whitelist = [res.data, ...this.whitelist];
        } else {
          this.loadWhitelist();
        }
        this.newSenderEmail = '';
        this.addingSender = false;
        this.flashMessage(`Added ${email} to whitelist.`);
      },
      error: (err) => {
        this.whitelistError = err?.error?.error || 'Failed to add sender to whitelist.';
        this.addingSender = false;
      }
    });
  }

  removeWhitelistSender(entry: InboundEmailWhitelistEntry): void {
    const confirmed = window.confirm(`Remove ${entry.sender_email} from the whitelist?`);
    if (!confirmed) return;
    this.removingSenderId = entry.id;
    this.whitelistError = '';
    this.inboundEmail.removeWhitelistEntry(entry.id).subscribe({
      next: () => {
        this.whitelist = this.whitelist.filter((w) => w.id !== entry.id);
        this.removingSenderId = null;
        this.flashMessage(`Removed ${entry.sender_email} from whitelist.`);
      },
      error: (err) => {
        this.whitelistError = err?.error?.error || 'Failed to remove sender.';
        this.removingSenderId = null;
      }
    });
  }

  statusLabel(status: InboundEmailLogStatus | string): string {
    return this.statusLabels[status as InboundEmailLogStatus] || status;
  }

  statusClass(status: InboundEmailLogStatus | string): string {
    switch (status) {
      case 'succeeded':
        return 'status-pill status-success';
      case 'pending':
      case 'processing':
        return 'status-pill status-pending';
      case 'failed':
        return 'status-pill status-error';
      case 'rejected_whitelist':
      case 'rejected_rate_limit':
      case 'rejected_virus':
        return 'status-pill status-rejected';
      default:
        return 'status-pill';
    }
  }

  formatDate(value?: string | null): string {
    if (!value) return '—';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString();
  }

  private flashMessage(text: string, ms = 4000): void {
    this.message = text;
    setTimeout(() => {
      if (this.message === text) this.message = '';
    }, ms);
  }
}
